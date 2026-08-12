# Autar Engine Registry + Two-Speed Router — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the engine registry and the two-speed router from [the Autar design spec](../specs/2026-08-11-autar-agentic-workspace-design.md) §4, §5 and §9, so any agent can resolve a request to an engine under a hard classification ceiling and a hard latency budget, minimising cost, and log the decision.

**Architecture:** Engines are declared in the Netizen node manifest (`ai.engines`) and validated by zod, so no engine is ever hardcoded in agent code. A pure-function router resolves three axes in fixed order — data classification, then latency budget, then cost — and **refuses** rather than degrading when no engine qualifies. A deterministic shape matcher (the "fast path") maps known request shapes to a latency budget with **no model call at all**; unmatched requests fall through to the slow path for a planning turn. Every decision is appended to a telemetry log, which is the dataset that later promotes shapes into the fast path.

**Tech Stack:** TypeScript 5.6, zod 3.23, Node 22 built-in test runner via `tsx --test`, pnpm 9.15 workspaces, Turborepo.

## Global Constraints

- **Repo:** all build code lives in the Netizen-Labs monorepo at `/Users/maxbrych/Documents/privat/side_projects/netizen/netizen_labs-autar-router`. This plan file lives in the Röbel repo; **do not put build code here.**
- **Node `>=22`**, **pnpm `9.15.0`**, **TypeScript `^5.6.3`**, **zod `^3.23.8`** — match the existing workspace versions exactly.
- **Test runner:** Node's built-in runner. Every package's test script is `tsx --test test/*.test.ts`; tests import from `node:test` and `node:assert/strict`. Do not add jest, vitest or mocha.
- **Code, identifiers, filenames and comments in English.** German only for text a user reads. Nothing in this plan is user-facing.
- **Everything renders from the manifest.** An engine that is not declared in `ai.engines` does not exist. No engine endpoint, key or model id may be hardcoded in agent code.
- **Secrets by reference only.** API keys use the existing `secretRef` schema in `packages/protocol/src/manifest.ts`. An inline key in a manifest is a rejected diff.
- **Classification is a hard constraint, never a preference.** When no engine qualifies, the router throws. There is no "fall back to a hosted engine" path — that would be the §9 leak.
- **Commit with explicit pathspecs** (`git add <file> <file>`), never `git add .` or `-A`. Parallel sessions share this monorepo.
- **ESM with extensionless relative imports.** All packages are `"type": "module"`. Relative imports carry **no file extension** — `from "./bounds"`, never `from "./bounds.ts"` or `"./bounds.js"` — matching `packages/agent-watcher`. The tsconfigs do not set `allowImportingTsExtensions`, so a `.ts` suffix fails typecheck.

---

## File Structure

**New package `packages/router`** (`@netizen-labs/router`) — the routing decision engine. Pure functions plus a manifest loader; it performs no I/O to model providers, which is what makes it fully testable.

| File | Responsibility |
|---|---|
| `packages/router/package.json` | Package manifest, test + typecheck scripts |
| `packages/router/tsconfig.json` | Compiler config, mirrors `packages/agent-watcher/tsconfig.json` |
| `packages/router/src/types.ts` | `Classification`, `LatencyClass`, their rank orders, `Engine`, `RouteRequest`, `RouteDecision`, `RouteRefusedError` |
| `packages/router/src/registry.ts` | Build an engine registry from a validated manifest; look up by id; list candidates |
| `packages/router/src/shapes.ts` | The deterministic fast-path shape matcher |
| `packages/router/src/router.ts` | `resolve()` — the three-axis decision |
| `packages/router/src/telemetry.ts` | Append-only routing decision log |
| `packages/router/src/index.ts` | Public exports |
| `packages/router/test/*.test.ts` | One test file per source module |

**Modified `packages/protocol/src/manifest.ts`** — add the `ai.engines` array alongside the existing `ai.models` record. `models` is left untouched so existing manifests keep validating.

**Modified `packages/agent-watcher/src/watcher.ts`** — no signature change; a new adapter module supplies `think()`.

**New `packages/agent-watcher/src/routed-think.ts`** — adapts a `RouteDecision` into the watcher's existing `think()` seam.

---

### Task 1: Declare engines in the manifest schema

**Files:**
- Modify: `packages/protocol/src/manifest.ts` (the `Ai` schema, currently beginning at line 440)
- Test: `packages/protocol/test/engines.test.ts` (create)

**Interfaces:**
- Consumes: the existing `secretRef` schema already defined in `manifest.ts`.
- Produces: `EngineSchema` (zod object) and the `ai.engines` optional array on the manifest. Fields: `id: string`, `endpoint: string`, `api: "anthropic" | "openai"`, `model: string`, `apiKey?: secretRef`, `selfHosted: boolean`, `classificationCeiling: "public" | "internal" | "sensitive"`, `latencyClass: "flash" | "interactive" | "batch"`, `measuredTtftMs: number`, `pricePerMTokIn: number`, `pricePerMTokOut: number`, `contextLimit: number`.

- [ ] **Step 1: Write the failing test**

Create `packages/protocol/test/engines.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { NetizenManifestSchema } from "../src/manifest";

// The minimum manifest NetizenManifestSchema accepts: nsp, manifestVersion, id,
// name and services (services.host is required). Verified against the schema on
// 2026-08-11 — do not trim further, every field here is load-bearing.
const base = {
  nsp: "0",
  manifestVersion: "1.0.0",
  id: "test-node",
  name: "Test",
  services: { host: { provider: "hetzner", region: "eu-central" } },
};

function withAi(engines: unknown[]) {
  return {
    ...base,
    ai: { gateway: "litellm", models: { chat: "claude-opus-5" }, engines },
  };
}

const hostedFlash = {
  id: "haiku",
  endpoint: "https://api.anthropic.com",
  api: "anthropic",
  model: "claude-haiku-4-5",
  // secretRef is a STRING matching /^(\$[A-Z0-9_]+|vault:[\w./-]+)$/ — an object
  // here is rejected. Never an inline key value.
  apiKey: "$ANTHROPIC_API_KEY",
  selfHosted: false,
  classificationCeiling: "internal",
  latencyClass: "flash",
  measuredTtftMs: 550,
  pricePerMTokIn: 1.0,
  pricePerMTokOut: 5.0,
  contextLimit: 200000,
};

test("accepts a well-formed hosted engine", () => {
  const parsed = NetizenManifestSchema.safeParse(withAi([hostedFlash]));
  assert.equal(parsed.success, true);
});

test("rejects a hosted engine claiming a sensitive ceiling", () => {
  const parsed = NetizenManifestSchema.safeParse(
    withAi([{ ...hostedFlash, classificationCeiling: "sensitive" }]),
  );
  assert.equal(parsed.success, false);
  const message = parsed.success ? "" : parsed.error.issues.map((i) => i.message).join(" ");
  assert.match(message, /self-hosted/);
});

test("accepts a self-hosted engine with a sensitive ceiling", () => {
  const parsed = NetizenManifestSchema.safeParse(
    withAi([
      {
        id: "glm-local",
        endpoint: "https://ai.node.internal",
        api: "anthropic",
        model: "glm-5.2",
        selfHosted: true,
        classificationCeiling: "sensitive",
        latencyClass: "interactive",
        measuredTtftMs: 1800,
        pricePerMTokIn: 0,
        pricePerMTokOut: 0,
        contextLimit: 1000000,
      },
    ]),
  );
  assert.equal(parsed.success, true);
});

test("rejects duplicate engine ids", () => {
  const parsed = NetizenManifestSchema.safeParse(withAi([hostedFlash, { ...hostedFlash }]));
  assert.equal(parsed.success, false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /Users/maxbrych/Documents/privat/side_projects/netizen/netizen_labs-autar-router/packages/protocol
pnpm test
```

Expected: FAIL. The hosted-sensitive case passes validation because no such rule exists yet.

- [ ] **Step 3: Add the schema**

In `packages/protocol/src/manifest.ts`, immediately **above** `const Ai = z` (line 440), insert:

```ts
/**
 * A single model endpoint the router may dispatch to (Autar design §5.5).
 *
 * Declaring an engine here IS the authorisation to send data to it, so the
 * schema — not a code path — is where the §9 classification invariant lives:
 * a hosted endpoint can never carry `sensitive` data, because the data would
 * leave hardware we control. `measuredTtftMs` is a benchmark result, not an
 * aspiration; re-benchmarking a tier is a manifest change, not a code change.
 */
export const EngineSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/, "engine id must be a lowercase slug"),
    endpoint: z.string().url(),
    /** Wire protocol spoken at `endpoint`, not the vendor. Z.ai speaks anthropic. */
    api: z.enum(["anthropic", "openai"]),
    model: z.string().min(1),
    /** Omitted for a self-hosted endpoint that needs no credential. */
    apiKey: secretRef.optional(),
    selfHosted: z.boolean(),
    classificationCeiling: z.enum(["public", "internal", "sensitive"]),
    latencyClass: z.enum(["flash", "interactive", "batch"]),
    measuredTtftMs: z.number().int().positive(),
    pricePerMTokIn: z.number().nonnegative(),
    pricePerMTokOut: z.number().nonnegative(),
    contextLimit: z.number().int().positive(),
  })
  .superRefine((engine, ctx) => {
    if (engine.classificationCeiling === "sensitive" && !engine.selfHosted)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `engine "${engine.id}": only a self-hosted engine may carry a sensitive ceiling`,
      });
  });

export type Engine = z.infer<typeof EngineSchema>;
```

- [ ] **Step 4: Attach `engines` to the `Ai` schema**

In the same file, inside the `Ai` object literal, immediately after the `models: z.record(z.string()),` line, add:

```ts
    /**
     * The router's engine registry (Autar design §5.5). Separate from `models`
     * on purpose: `models` maps a role to a bare model name for the gateway,
     * while an engine carries the routing facts — ceiling, latency, price.
     * Adding this as a new field keeps every existing manifest valid.
     */
    engines: z.array(EngineSchema).optional(),
```

Then extend the existing `.superRefine((ai, ctx) => { ... })` at the end of `Ai` by adding, before its closing brace:

```ts
    const seen = new Set<string>();
    for (const e of ai.engines ?? []) {
      if (seen.has(e.id))
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `duplicate engine id: "${e.id}"` });
      seen.add(e.id);
    }
```

- [ ] **Step 5: Export the engine type from the package entry point**

`packages/router` imports `Engine` from `@netizen-labs/protocol`, whose entry point is
`packages/protocol/src/index.ts`. That file currently exports only the manifest and preset symbols,
so add `EngineSchema` and the `Engine` type to its first export block. **Note this file uses `.js`
extensions in its re-exports** (unlike relative imports elsewhere) — keep that as-is:

```ts
export {
  NetizenManifestSchema,
  EngineSchema,
  parseManifest,
  safeParseManifest,
  type NetizenManifest,
  type Engine,
} from "./manifest.js";
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
cd /Users/maxbrych/Documents/privat/side_projects/netizen/netizen_labs-autar-router/packages/protocol
pnpm test && pnpm typecheck
```

Expected: PASS, all four tests.

- [ ] **Step 7: Commit**

```bash
cd /Users/maxbrych/Documents/privat/side_projects/netizen/netizen_labs-autar-router
git add packages/protocol/src/manifest.ts packages/protocol/src/index.ts packages/protocol/test/engines.test.ts
git commit -m "feat(protocol): ai.engines — the router's engine registry

Engines are declared in the manifest so no endpoint, key or model id is ever
hardcoded in agent code. The §9 classification invariant lives in the schema
rather than a code path: a hosted endpoint can never carry a sensitive ceiling,
because the data would leave hardware we control.

Added alongside ai.models rather than replacing it, so every existing manifest
keeps validating."
```

---

### Task 2: Router package skeleton and the two rank orders

**Files:**
- Create: `packages/router/package.json`
- Create: `packages/router/tsconfig.json`
- Create: `packages/router/src/types.ts`
- Test: `packages/router/test/types.test.ts`

**Interfaces:**
- Consumes: `Engine` type from `@netizen-labs/protocol`.
- Produces: `Classification`, `LatencyClass`, `classificationRank(c: Classification): number`, `latencyRank(l: LatencyClass): number`, `RouteRequest`, `RouteDecision`, `RouteRefusedError`.

- [ ] **Step 1: Create the package manifest**

Create `packages/router/package.json`:

```json
{
  "name": "@netizen-labs/router",
  "version": "0.1.0",
  "private": true,
  "description": "Autar model router — resolves classification, latency budget and cost to one engine.",
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "files": ["src"],
  "scripts": {
    "test": "tsx --test test/*.test.ts",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": { "@netizen-labs/protocol": "workspace:*" },
  "devDependencies": {
    "@types/node": "^22.7.4",
    "tsx": "^4.19.2",
    "typescript": "^5.6.3"
  }
}
```

Create `packages/router/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM"],
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "types": ["node"]
  },
  "include": ["src", "test"]
}
```

This is a byte-for-byte copy of `packages/agent-watcher/tsconfig.json`. Note the absence of
`allowImportingTsExtensions` — that is why relative imports must be extensionless.

- [ ] **Step 2: Write the failing test**

Create `packages/router/test/types.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { classificationRank, latencyRank, RouteRefusedError } from "../src/types";

test("classification ranks ascend from public to sensitive", () => {
  assert.ok(classificationRank("public") < classificationRank("internal"));
  assert.ok(classificationRank("internal") < classificationRank("sensitive"));
});

test("latency ranks ascend from flash to batch", () => {
  assert.ok(latencyRank("flash") < latencyRank("interactive"));
  assert.ok(latencyRank("interactive") < latencyRank("batch"));
});

test("RouteRefusedError carries a reason and is an Error", () => {
  const err = new RouteRefusedError("no engine qualified");
  assert.ok(err instanceof Error);
  assert.equal(err.name, "RouteRefusedError");
  assert.equal(err.message, "no engine qualified");
});
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
cd /Users/maxbrych/Documents/privat/side_projects/netizen/netizen_labs-autar-router
pnpm install
cd packages/router && pnpm test
```

Expected: FAIL — `../src/types` does not exist.

- [ ] **Step 4: Write the implementation**

Create `packages/router/src/types.ts`:

```ts
import type { Engine } from "@netizen-labs/protocol";

export type { Engine };

/** How sensitive a payload is. An engine may carry its class or anything below it. */
export type Classification = "public" | "internal" | "sensitive";

/** How long the *surface* may wait — set by where the request arrives, not by the task. */
export type LatencyClass = "flash" | "interactive" | "batch";

const CLASSIFICATION_ORDER: readonly Classification[] = ["public", "internal", "sensitive"];
const LATENCY_ORDER: readonly LatencyClass[] = ["flash", "interactive", "batch"];

/** Higher rank means more sensitive. */
export function classificationRank(c: Classification): number {
  return CLASSIFICATION_ORDER.indexOf(c);
}

/** Higher rank means slower. A flash engine also satisfies an interactive budget. */
export function latencyRank(l: LatencyClass): number {
  return LATENCY_ORDER.indexOf(l);
}

export interface RouteRequest {
  /** Matched fast-path shape, or null when the request must go the slow path. */
  shape: string | null;
  classification: Classification;
  latencyBudget: LatencyClass;
}

export interface RouteDecision {
  engineId: string;
  path: "fast" | "slow";
  /** Human-readable justification, written to telemetry and shown in audit. */
  reason: string;
  /** Blended list price of the chosen engine, for telemetry and budget checks. */
  costScore: number;
}

/**
 * No engine satisfied the request.
 *
 * This is the correct outcome, not a failure to handle: relaxing the
 * classification or the latency budget to find a match would be the §9 leak the
 * whole design exists to prevent.
 */
export class RouteRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RouteRefusedError";
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd /Users/maxbrych/Documents/privat/side_projects/netizen/netizen_labs-autar-router/packages/router
pnpm test && pnpm typecheck
```

Expected: PASS, three tests.

- [ ] **Step 6: Commit**

```bash
cd /Users/maxbrych/Documents/privat/side_projects/netizen/netizen_labs-autar-router
git add packages/router/package.json packages/router/tsconfig.json packages/router/src/types.ts packages/router/test/types.test.ts pnpm-lock.yaml
git commit -m "feat(router): package skeleton, classification and latency rank orders

RouteRefusedError is deliberately an outcome rather than a failure: relaxing the
classification or latency budget to find a match would be exactly the leak the
design exists to prevent."
```

---

### Task 3: Build the registry from a manifest

**Files:**
- Create: `packages/router/src/registry.ts`
- Test: `packages/router/test/registry.test.ts`

**Interfaces:**
- Consumes: `Engine`, `Classification`, `LatencyClass`, `classificationRank`, `latencyRank` from `./types.ts`.
- Produces: `buildRegistry(engines: Engine[]): EngineRegistry`, where `EngineRegistry` has `get(id: string): Engine | undefined`, `all(): readonly Engine[]`, and `candidates(classification: Classification, latencyBudget: LatencyClass): readonly Engine[]`.

- [ ] **Step 1: Write the failing test**

Create `packages/router/test/registry.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRegistry } from "../src/registry";
import type { Engine } from "../src/types";

const haiku: Engine = {
  id: "haiku",
  endpoint: "https://api.anthropic.com",
  api: "anthropic",
  model: "claude-haiku-4-5",
  selfHosted: false,
  classificationCeiling: "internal",
  latencyClass: "flash",
  measuredTtftMs: 550,
  pricePerMTokIn: 1.0,
  pricePerMTokOut: 5.0,
  contextLimit: 200000,
};

const glmLocal: Engine = {
  id: "glm-local",
  endpoint: "https://ai.node.internal",
  api: "anthropic",
  model: "glm-5.2",
  selfHosted: true,
  classificationCeiling: "sensitive",
  latencyClass: "interactive",
  measuredTtftMs: 1800,
  pricePerMTokIn: 0,
  pricePerMTokOut: 0,
  contextLimit: 1000000,
};

test("get returns a declared engine and undefined otherwise", () => {
  const reg = buildRegistry([haiku, glmLocal]);
  assert.equal(reg.get("haiku")?.model, "claude-haiku-4-5");
  assert.equal(reg.get("nope"), undefined);
});

test("candidates exclude engines below the required classification", () => {
  const reg = buildRegistry([haiku, glmLocal]);
  const ids = reg.candidates("sensitive", "batch").map((e) => e.id);
  assert.deepEqual(ids, ["glm-local"]);
});

test("candidates exclude engines slower than the latency budget", () => {
  const reg = buildRegistry([haiku, glmLocal]);
  const ids = reg.candidates("internal", "flash").map((e) => e.id);
  assert.deepEqual(ids, ["haiku"]);
});

test("a faster engine satisfies a slower budget", () => {
  const reg = buildRegistry([haiku]);
  assert.equal(reg.candidates("internal", "batch").length, 1);
});

test("candidates is empty when nothing qualifies", () => {
  const reg = buildRegistry([haiku]);
  assert.deepEqual(reg.candidates("sensitive", "flash"), []);
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /Users/maxbrych/Documents/privat/side_projects/netizen/netizen_labs-autar-router/packages/router
pnpm test
```

Expected: FAIL — `../src/registry` does not exist.

- [ ] **Step 3: Write the implementation**

Create `packages/router/src/registry.ts`:

```ts
import {
  classificationRank,
  latencyRank,
  type Classification,
  type Engine,
  type LatencyClass,
} from "./types";

export interface EngineRegistry {
  get(id: string): Engine | undefined;
  all(): readonly Engine[];
  /**
   * Every engine allowed to serve this request, before cost is considered.
   *
   * An engine qualifies when its ceiling is at least as high as the payload's
   * class (so it may legally hold the data) and it is at least as fast as the
   * budget (a flash engine also satisfies a batch budget).
   */
  candidates(classification: Classification, latencyBudget: LatencyClass): readonly Engine[];
}

export function buildRegistry(engines: readonly Engine[]): EngineRegistry {
  const byId = new Map(engines.map((e) => [e.id, e]));
  return {
    get: (id) => byId.get(id),
    all: () => engines,
    candidates: (classification, latencyBudget) =>
      engines.filter(
        (e) =>
          classificationRank(e.classificationCeiling) >= classificationRank(classification) &&
          latencyRank(e.latencyClass) <= latencyRank(latencyBudget),
      ),
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd /Users/maxbrych/Documents/privat/side_projects/netizen/netizen_labs-autar-router/packages/router
pnpm test && pnpm typecheck
```

Expected: PASS, five tests.

- [ ] **Step 5: Commit**

```bash
cd /Users/maxbrych/Documents/privat/side_projects/netizen/netizen_labs-autar-router
git add packages/router/src/registry.ts packages/router/test/registry.test.ts
git commit -m "feat(router): engine registry with classification and latency filtering

An engine qualifies when its ceiling is at least the payload's class and it is
at least as fast as the budget. Both filters run before cost is considered,
which is what makes classification and latency hard constraints rather than
weights."
```

---

### Task 4: The three-axis resolver

**Files:**
- Create: `packages/router/src/router.ts`
- Test: `packages/router/test/router.test.ts`

**Interfaces:**
- Consumes: `buildRegistry`, `EngineRegistry` from `./registry.ts`; `RouteRequest`, `RouteDecision`, `RouteRefusedError`, `Engine` from `./types.ts`.
- Produces: `costScore(engine: Engine): number` and `resolve(registry: EngineRegistry, request: RouteRequest): RouteDecision`.

- [ ] **Step 1: Write the failing test**

Create `packages/router/test/router.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRegistry } from "../src/registry";
import { costScore, resolve } from "../src/router";
import { RouteRefusedError, type Engine } from "../src/types";

function engine(over: Partial<Engine> & Pick<Engine, "id">): Engine {
  return {
    endpoint: "https://api.example.com",
    api: "anthropic",
    model: "m",
    selfHosted: false,
    classificationCeiling: "internal",
    latencyClass: "interactive",
    measuredTtftMs: 900,
    pricePerMTokIn: 1,
    pricePerMTokOut: 1,
    contextLimit: 100000,
    ...over,
  };
}

test("costScore blends input and output list price", () => {
  assert.equal(costScore(engine({ id: "a", pricePerMTokIn: 1.4, pricePerMTokOut: 4.4 })), 5.8);
});

test("picks the cheapest qualifying engine", () => {
  const reg = buildRegistry([
    engine({ id: "dear", pricePerMTokIn: 5, pricePerMTokOut: 25 }),
    engine({ id: "cheap", pricePerMTokIn: 1, pricePerMTokOut: 5 }),
  ]);
  const decision = resolve(reg, { shape: "summarize", classification: "internal", latencyBudget: "batch" });
  assert.equal(decision.engineId, "cheap");
  assert.equal(decision.path, "fast");
});

test("a matched shape is the fast path, an unmatched one is slow", () => {
  const reg = buildRegistry([engine({ id: "only" })]);
  const slow = resolve(reg, { shape: null, classification: "internal", latencyBudget: "batch" });
  assert.equal(slow.path, "slow");
});

test("refuses rather than downgrading when nothing qualifies", () => {
  const reg = buildRegistry([engine({ id: "hosted", classificationCeiling: "internal" })]);
  assert.throws(
    () => resolve(reg, { shape: null, classification: "sensitive", latencyBudget: "batch" }),
    (err: unknown) => err instanceof RouteRefusedError && /sensitive/.test((err as Error).message),
  );
});

test("never returns a hosted engine for sensitive data", () => {
  const reg = buildRegistry([
    engine({ id: "hosted-cheap", pricePerMTokIn: 0, pricePerMTokOut: 0 }),
    engine({ id: "local", selfHosted: true, classificationCeiling: "sensitive", pricePerMTokIn: 9, pricePerMTokOut: 9 }),
  ]);
  const decision = resolve(reg, { shape: "summarize", classification: "sensitive", latencyBudget: "batch" });
  assert.equal(decision.engineId, "local");
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /Users/maxbrych/Documents/privat/side_projects/netizen/netizen_labs-autar-router/packages/router
pnpm test
```

Expected: FAIL — `../src/router` does not exist.

- [ ] **Step 3: Write the implementation**

Create `packages/router/src/router.ts`:

```ts
import type { EngineRegistry } from "./registry";
import { RouteRefusedError, type Engine, type RouteDecision, type RouteRequest } from "./types";

/**
 * Blended list price, input plus output per MTok.
 *
 * A first approximation on purpose: the honest weighting depends on the
 * input:output ratio of the actual workload, and that ratio is one of the
 * things telemetry exists to measure. Refine it from logged data, not from a
 * guess made before any data existed.
 */
export function costScore(engine: Engine): number {
  return engine.pricePerMTokIn + engine.pricePerMTokOut;
}

/**
 * Resolve one request to one engine (Autar design §5.1).
 *
 * Three axes in fixed order: data classification, then latency budget, then
 * cost. The first two are hard filters applied by the registry; only among what
 * survives both is cost minimised. When nothing survives, this throws — see
 * RouteRefusedError for why that is the correct behaviour.
 */
export function resolve(registry: EngineRegistry, request: RouteRequest): RouteDecision {
  const candidates = registry.candidates(request.classification, request.latencyBudget);

  if (candidates.length === 0)
    throw new RouteRefusedError(
      `no engine satisfies classification "${request.classification}" within latency budget "${request.latencyBudget}"`,
    );

  const chosen = candidates.reduce((best, e) => (costScore(e) < costScore(best) ? e : best));

  return {
    engineId: chosen.id,
    path: request.shape === null ? "slow" : "fast",
    reason:
      `${chosen.id}: cheapest of ${candidates.length} engine(s) meeting ` +
      `classification "${request.classification}" and latency "${request.latencyBudget}"`,
    costScore: costScore(chosen),
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd /Users/maxbrych/Documents/privat/side_projects/netizen/netizen_labs-autar-router/packages/router
pnpm test && pnpm typecheck
```

Expected: PASS, five tests.

- [ ] **Step 5: Commit**

```bash
cd /Users/maxbrych/Documents/privat/side_projects/netizen/netizen_labs-autar-router
git add packages/router/src/router.ts packages/router/test/router.test.ts
git commit -m "feat(router): three-axis resolve — classification, latency, then cost

Classification and latency are hard filters applied before cost is considered,
so a cheaper engine can never win by being cheap. When nothing survives both
filters the router throws rather than degrading: a fallback to a hosted engine
would be precisely the leak the classification ceiling prevents."
```

---

### Task 5: The fast-path shape matcher

**Files:**
- Create: `packages/router/src/shapes.ts`
- Test: `packages/router/test/shapes.test.ts`

**Interfaces:**
- Consumes: `LatencyClass` from `./types.ts`.
- Produces: `KNOWN_SHAPES: readonly ShapeRule[]` where `ShapeRule = { shape: string; pattern: RegExp; latencyBudget: LatencyClass }`, and `matchShape(text: string): ShapeRule | null`.

- [ ] **Step 1: Write the failing test**

Create `packages/router/test/shapes.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { matchShape } from "../src/shapes";

test("recognises a summarisation request as a batch shape", () => {
  const m = matchShape("summarize yesterday's meeting");
  assert.equal(m?.shape, "summarize");
  assert.equal(m?.latencyBudget, "batch");
});

test("recognises the German wording too", () => {
  assert.equal(matchShape("fasse das Protokoll zusammen")?.shape, "summarize");
});

test("recognises a translation request", () => {
  assert.equal(matchShape("translate this into English")?.shape, "translate");
});

test("returns null for an open-ended request", () => {
  assert.equal(matchShape("what should our strategy be for next quarter?"), null);
});

test("matching is case-insensitive", () => {
  assert.equal(matchShape("SUMMARIZE the call")?.shape, "summarize");
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /Users/maxbrych/Documents/privat/side_projects/netizen/netizen_labs-autar-router/packages/router
pnpm test
```

Expected: FAIL — `../src/shapes` does not exist.

- [ ] **Step 3: Write the implementation**

Create `packages/router/src/shapes.ts`:

```ts
import type { LatencyClass } from "./types";

export interface ShapeRule {
  shape: string;
  pattern: RegExp;
  latencyBudget: LatencyClass;
}

/**
 * The fast path (Autar design §4.2).
 *
 * Matching here dispatches a request WITHOUT any model call, which is both the
 * largest cost saving and the largest latency saving available — a routing
 * decision that costs no model call also costs no round trip. Rules are
 * deliberately narrow: a false match sends real work to the wrong budget, while
 * a miss merely falls through to the slow path and gets logged. Bilingual
 * because the operator surface is German while the codebase is English.
 *
 * This list GROWS FROM TELEMETRY. Shapes that repeatedly reach the slow path
 * and get routed the same way are the candidates to promote here.
 */
export const KNOWN_SHAPES: readonly ShapeRule[] = [
  { shape: "summarize", pattern: /\b(summari[sz]e|summary|zusammenfass|fasse\b.*\bzusammen)/i, latencyBudget: "batch" },
  { shape: "transcribe-cleanup", pattern: /\b(clean up|tidy)\b.*\btranscript|transkript\b.*\bbereinig/i, latencyBudget: "batch" },
  { shape: "translate", pattern: /\b(translate|übersetze)\b/i, latencyBudget: "batch" },
  { shape: "classify", pattern: /\b(classify|categori[sz]e|kategorisiere)\b/i, latencyBudget: "batch" },
  { shape: "extract", pattern: /\bextract\b|\bextrahiere\b/i, latencyBudget: "batch" },
];

/** The first matching rule, or null when the request must take the slow path. */
export function matchShape(text: string): ShapeRule | null {
  return KNOWN_SHAPES.find((rule) => rule.pattern.test(text)) ?? null;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd /Users/maxbrych/Documents/privat/side_projects/netizen/netizen_labs-autar-router/packages/router
pnpm test && pnpm typecheck
```

Expected: PASS, five tests.

- [ ] **Step 5: Commit**

```bash
cd /Users/maxbrych/Documents/privat/side_projects/netizen/netizen_labs-autar-router
git add packages/router/src/shapes.ts packages/router/test/shapes.test.ts
git commit -m "feat(router): deterministic fast-path shape matcher

A matched shape dispatches with no model call at all, which is simultaneously
the biggest cost saving and the biggest latency saving available. Rules are
narrow on purpose: a false match sends real work to the wrong budget, while a
miss only falls through to the slow path and gets logged. The list is meant to
grow from telemetry, not from guessing."
```

---

### Task 6: Routing telemetry

**Files:**
- Create: `packages/router/src/telemetry.ts`
- Create: `packages/router/src/index.ts`
- Test: `packages/router/test/telemetry.test.ts`

**Interfaces:**
- Consumes: `RouteDecision`, `RouteRequest` from `./types.ts`.
- Produces: `RoutingRecord`, `createTelemetry(sink?: (r: RoutingRecord) => void): Telemetry` where `Telemetry` has `record(request: RouteRequest, decision: RouteDecision, at: number): RoutingRecord`, `recordRefusal(request: RouteRequest, reason: string, at: number): RoutingRecord`, and `entries(): readonly RoutingRecord[]`. Also the package's public exports in `index.ts`.

- [ ] **Step 1: Write the failing test**

Create `packages/router/test/telemetry.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createTelemetry } from "../src/telemetry";
import type { RouteDecision, RouteRequest } from "../src/types";

const request: RouteRequest = { shape: "summarize", classification: "internal", latencyBudget: "batch" };
const decision: RouteDecision = { engineId: "cheap", path: "fast", reason: "because", costScore: 6 };

test("records a decision with its request context", () => {
  const t = createTelemetry();
  const rec = t.record(request, decision, 1000);
  assert.equal(rec.engineId, "cheap");
  assert.equal(rec.shape, "summarize");
  assert.equal(rec.path, "fast");
  assert.equal(rec.refused, false);
  assert.equal(rec.at, 1000);
  assert.equal(t.entries().length, 1);
});

test("records a refusal with no engine", () => {
  const t = createTelemetry();
  const rec = t.recordRefusal(request, "no engine qualified", 2000);
  assert.equal(rec.refused, true);
  assert.equal(rec.engineId, null);
  assert.equal(rec.reason, "no engine qualified");
});

test("forwards every record to the sink", () => {
  const seen: string[] = [];
  const t = createTelemetry((r) => seen.push(r.reason));
  t.record(request, decision, 1);
  t.recordRefusal(request, "nope", 2);
  assert.deepEqual(seen, ["because", "nope"]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /Users/maxbrych/Documents/privat/side_projects/netizen/netizen_labs-autar-router/packages/router
pnpm test
```

Expected: FAIL — `../src/telemetry` does not exist.

- [ ] **Step 3: Write the implementation**

Create `packages/router/src/telemetry.ts`:

```ts
import type { RouteDecision, RouteRequest } from "./types";

/**
 * One routing decision, as logged.
 *
 * This is the dataset that makes the router smarter (design §4.2, STRATEGY
 * §12d): shapes that keep reaching the slow path and getting routed the same
 * way are the candidates to promote into the fast path. Refusals are recorded
 * with equal weight — a refusal usually means the engine registry is missing a
 * self-hosted tier, which is a manifest gap worth seeing.
 */
export interface RoutingRecord {
  at: number;
  shape: string | null;
  classification: RouteRequest["classification"];
  latencyBudget: RouteRequest["latencyBudget"];
  path: RouteDecision["path"] | null;
  engineId: string | null;
  costScore: number | null;
  refused: boolean;
  reason: string;
}

export interface Telemetry {
  record(request: RouteRequest, decision: RouteDecision, at: number): RoutingRecord;
  recordRefusal(request: RouteRequest, reason: string, at: number): RoutingRecord;
  entries(): readonly RoutingRecord[];
}

/**
 * In-memory telemetry with an optional sink.
 *
 * The sink is where a caller forwards records to durable storage — a Nostr
 * event on the private relay, per the audit rule in design §8. Keeping the
 * default in-memory means the router stays a pure, testable dependency.
 */
export function createTelemetry(sink?: (record: RoutingRecord) => void): Telemetry {
  const records: RoutingRecord[] = [];

  function push(record: RoutingRecord): RoutingRecord {
    records.push(record);
    sink?.(record);
    return record;
  }

  return {
    record: (request, decision, at) =>
      push({
        at,
        shape: request.shape,
        classification: request.classification,
        latencyBudget: request.latencyBudget,
        path: decision.path,
        engineId: decision.engineId,
        costScore: decision.costScore,
        refused: false,
        reason: decision.reason,
      }),
    recordRefusal: (request, reason, at) =>
      push({
        at,
        shape: request.shape,
        classification: request.classification,
        latencyBudget: request.latencyBudget,
        path: null,
        engineId: null,
        costScore: null,
        refused: true,
        reason,
      }),
    entries: () => records,
  };
}
```

Create `packages/router/src/index.ts`:

```ts
export {
  classificationRank,
  latencyRank,
  RouteRefusedError,
  type Classification,
  type Engine,
  type LatencyClass,
  type RouteDecision,
  type RouteRequest,
} from "./types";
export { buildRegistry, type EngineRegistry } from "./registry";
export { costScore, resolve } from "./router";
export { KNOWN_SHAPES, matchShape, type ShapeRule } from "./shapes";
export { createTelemetry, type RoutingRecord, type Telemetry } from "./telemetry";
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd /Users/maxbrych/Documents/privat/side_projects/netizen/netizen_labs-autar-router/packages/router
pnpm test && pnpm typecheck
```

Expected: PASS, three tests in this file and eighteen across the package.

- [ ] **Step 5: Commit**

```bash
cd /Users/maxbrych/Documents/privat/side_projects/netizen/netizen_labs-autar-router
git add packages/router/src/telemetry.ts packages/router/src/index.ts packages/router/test/telemetry.test.ts
git commit -m "feat(router): routing telemetry and public exports

Every decision and every refusal is logged. Refusals matter as much as
decisions: one usually means the registry lacks a self-hosted tier, which is a
manifest gap worth seeing rather than an error to swallow. The optional sink is
where a caller forwards records to the audit log on the private relay."
```

---

### Task 7: Wire the router into the agent-watcher's `think()` seam

**Files:**
- Create: `packages/agent-watcher/src/routed-think.ts`
- Modify: `packages/agent-watcher/package.json` (add the router dependency)
- Test: `packages/agent-watcher/test/routed-think.test.ts`

**Interfaces:**
- Consumes: `buildRegistry`, `matchShape`, `resolve`, `createTelemetry`, `RouteRefusedError`, `Engine`, `Telemetry`, `Classification` from `@netizen-labs/router`.
- Produces: `makeRoutedThink(options: RoutedThinkOptions): (question: string, event: unknown) => Promise<string | null>`, matching the existing `WatcherDeps["think"]` signature in `packages/agent-watcher/src/watcher.ts`. `RoutedThinkOptions = { engines: Engine[]; classification: Classification; latencyBudget: LatencyClass; telemetry?: Telemetry; now?: () => number; call: (engineId: string, question: string) => Promise<string> }`.

- [ ] **Step 1: Add the dependency**

In `packages/agent-watcher/package.json`, change the `dependencies` block to:

```json
  "dependencies": {
    "@netizen-labs/nostr": "workspace:*",
    "@netizen-labs/router": "workspace:*"
  },
```

Then run:

```bash
cd /Users/maxbrych/Documents/privat/side_projects/netizen/netizen_labs-autar-router
pnpm install
```

- [ ] **Step 2: Write the failing test**

Create `packages/agent-watcher/test/routed-think.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Engine } from "@netizen-labs/router";
import { createTelemetry } from "@netizen-labs/router";
import { makeRoutedThink } from "../src/routed-think";

const hosted: Engine = {
  id: "hosted",
  endpoint: "https://api.example.com",
  api: "anthropic",
  model: "m",
  selfHosted: false,
  classificationCeiling: "internal",
  latencyClass: "flash",
  measuredTtftMs: 500,
  pricePerMTokIn: 1,
  pricePerMTokOut: 5,
  contextLimit: 100000,
};

test("routes the question and returns the engine's answer", async () => {
  const calls: string[] = [];
  const think = makeRoutedThink({
    engines: [hosted],
    classification: "internal",
    latencyBudget: "batch",
    call: async (engineId, question) => {
      calls.push(`${engineId}:${question}`);
      return "answered";
    },
  });
  assert.equal(await think("summarize the call", {}), "answered");
  assert.deepEqual(calls, ["hosted:summarize the call"]);
});

test("declines by returning null when no engine qualifies", async () => {
  const telemetry = createTelemetry();
  const think = makeRoutedThink({
    engines: [hosted],
    classification: "sensitive",
    latencyBudget: "batch",
    telemetry,
    now: () => 42,
    call: async () => {
      throw new Error("must not be called");
    },
  });
  assert.equal(await think("summarize the call", {}), null);
  assert.equal(telemetry.entries().length, 1);
  assert.equal(telemetry.entries()[0].refused, true);
  assert.equal(telemetry.entries()[0].at, 42);
});

test("logs the matched shape so the fast path is visible in telemetry", async () => {
  const telemetry = createTelemetry();
  const think = makeRoutedThink({
    engines: [hosted],
    classification: "internal",
    latencyBudget: "batch",
    telemetry,
    now: () => 7,
    call: async () => "ok",
  });
  await think("summarize the call", {});
  assert.equal(telemetry.entries()[0].shape, "summarize");
  assert.equal(telemetry.entries()[0].path, "fast");
});

test("an open-ended question is logged as the slow path", async () => {
  const telemetry = createTelemetry();
  const think = makeRoutedThink({
    engines: [hosted],
    classification: "internal",
    latencyBudget: "batch",
    telemetry,
    now: () => 8,
    call: async () => "ok",
  });
  await think("what should our strategy be?", {});
  assert.equal(telemetry.entries()[0].shape, null);
  assert.equal(telemetry.entries()[0].path, "slow");
});
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
cd /Users/maxbrych/Documents/privat/side_projects/netizen/netizen_labs-autar-router/packages/agent-watcher
pnpm test
```

Expected: FAIL — `../src/routed-think` does not exist.

- [ ] **Step 4: Write the implementation**

Create `packages/agent-watcher/src/routed-think.ts`:

```ts
import {
  buildRegistry,
  createTelemetry,
  matchShape,
  resolve,
  RouteRefusedError,
  type Classification,
  type Engine,
  type LatencyClass,
  type Telemetry,
} from "@netizen-labs/router";

export interface RoutedThinkOptions {
  /** The manifest's declared engines. Nothing outside this list is reachable. */
  engines: Engine[];
  /** Class of the data in this channel, from the workspace track (design §1.1a). */
  classification: Classification;
  /** Budget of the surface this question arrived on, not of the question. */
  latencyBudget: LatencyClass;
  telemetry?: Telemetry;
  now?: () => number;
  /** Performs the actual model call. Injected so routing stays pure and testable. */
  call: (engineId: string, question: string) => Promise<string>;
}

/**
 * Build a `think()` for the agent watcher that routes before it answers.
 *
 * The watcher already owns the mention→reply loop; this supplies its brain.
 * Returning `null` declines to answer, which is the watcher's existing contract
 * — so a refusal to route degrades to silence rather than to a wrong engine.
 */
export function makeRoutedThink(options: RoutedThinkOptions) {
  const registry = buildRegistry(options.engines);
  const telemetry = options.telemetry ?? createTelemetry();
  const now = options.now ?? (() => Date.now());

  return async function think(question: string, _event: unknown): Promise<string | null> {
    const matched = matchShape(question);
    const request = {
      shape: matched?.shape ?? null,
      classification: options.classification,
      latencyBudget: matched?.latencyBudget ?? options.latencyBudget,
    };

    let decision;
    try {
      decision = resolve(registry, request);
    } catch (error) {
      if (error instanceof RouteRefusedError) {
        telemetry.recordRefusal(request, error.message, now());
        return null;
      }
      throw error;
    }

    telemetry.record(request, decision, now());
    return options.call(decision.engineId, question);
  };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd /Users/maxbrych/Documents/privat/side_projects/netizen/netizen_labs-autar-router/packages/agent-watcher
pnpm test && pnpm typecheck
```

Expected: PASS, four new tests plus the existing watcher, profile and bounds tests.

- [ ] **Step 6: Confirm no regression in the affected packages**

**Do not run `pnpm test` at the workspace root and expect green.** The baseline recorded
2026-08-11 has pre-existing failures in `atlas`, `indexer`, `signer` and `ortis` that have nothing
to do with this plan. Verify only the packages this plan touches:

```bash
cd /Users/maxbrych/Documents/privat/side_projects/netizen/netizen_labs-autar-router
for p in protocol router agent-watcher; do
  printf "%-16s " "$p"
  (cd packages/$p && pnpm test >/dev/null 2>&1 && echo "test PASS" || echo "test FAIL")
done
for p in protocol router agent-watcher; do
  printf "%-16s " "$p"
  (cd packages/$p && pnpm typecheck >/dev/null 2>&1 && echo "typecheck PASS" || echo "typecheck FAIL")
done
```

Expected: PASS on all six lines. `protocol`, `agent-watcher` and `nostr` were verified PASS at
baseline before this plan began, so any failure among them is a genuine regression from this work.

- [ ] **Step 7: Commit**

```bash
cd /Users/maxbrych/Documents/privat/side_projects/netizen/netizen_labs-autar-router
git add packages/agent-watcher/src/routed-think.ts packages/agent-watcher/test/routed-think.test.ts packages/agent-watcher/package.json pnpm-lock.yaml
git commit -m "feat(agent-watcher): route before answering

The watcher already owned the mention-to-reply loop with a pluggable think()
seam; this supplies its brain. A refused route returns null, which is the
watcher's existing 'decline to answer' contract — so an unroutable question
degrades to silence rather than to a wrong engine.

The model call itself is injected, which keeps routing pure and lets the whole
decision path be tested without a network."
```

---

## Verification

After Task 7, confirm the slice works end to end using the scoped loop in Task 7 Step 6.

**Recorded baseline (2026-08-11, worktree `feat/autar-engine-registry-router` off `a34f52f`):**
`protocol` PASS · `agent-watcher` PASS · `nostr` PASS (test and typecheck).
Pre-existing failures unrelated to this plan: `atlas`, `indexer`, `signer`, `ortis`. **Do not attempt
to fix those** — `signer` and `ortis` are another session's live work.

**Do not report completion without pasting the actual output** — the standing verification rule.

## What this plan deliberately leaves out

- **The slow path's planning turn.** `resolve()` labels a request `slow`; it does not yet run a Claude planning turn to produce a multi-step plan. That belongs with the orchestrator's delegation logic.
- **The real model call.** `call()` is injected. Wiring it to LiteLLM and the Anthropic-compatible Z.ai endpoint is the engine-registry rendering task in the CLI.
- **Rendering engines into the deployed stack.** `netizen render` must emit LiteLLM configuration from `ai.engines`. Separate task, separate plan — it touches `packages/cli/src/render.ts`, which is large.
- **Budgets and approval cards** (design §8), the **conformance suite** (§1.2) and the **upstream watcher** (§1.2a). Each is its own plan; the watcher depends on both this plan and the conformance suite.
