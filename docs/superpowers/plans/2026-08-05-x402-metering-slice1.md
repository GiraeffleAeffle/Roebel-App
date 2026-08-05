# x402 Metered Data Access — Slice 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Meter machine-scale access to the public record (`/bulk/events`, `/export`, `/firehose`) behind x402 payments settled in USDC.e on Gnosis into the GK Safe, with per-author serving accounting from day one.

**Architecture:** Two new node services rendered from the manifest: a **gateway** (paid endpoints, 402 handshake, ledger) that shares the indexer's Postgres, and a **facilitator** (x402 `exact`-scheme verify + settle via EIP-3009 `transferWithAuthorization`). Caddy path-routes paid paths on the index host to the gateway; the free indexer API is untouched. Spec: `docs/superpowers/specs/2026-08-05-x402-metered-data-access-design.md`.

**Tech Stack:** TypeScript ESM, Node 22, `node:http`, `pg`, `viem@^2.47.6`, zod (protocol), esbuild single-file bundles, node:test via `tsx --test`.

## Global Constraints

- **pnpm only** — never npm/yarn. Workspace packages named `@netizen-labs/<dir>`.
- **A parallel session is active on Expo web work.** Every commit MUST use explicit pathspecs (`git commit -- <paths>`), never `git add .`/`-A`. Push after every commit.
- Per-package verification only: `pnpm --filter @netizen-labs/<pkg> test` and `pnpm --filter @netizen-labs/<pkg> typecheck`. Do NOT run repo-wide tsc (~431 pre-existing errors in apps/expo).
- Probe-confirmed settlement constants (do not re-derive): asset `0x2a22f9c3b484C3629090FeED35F17Ff8F88f76F0` (USDC.e, 6 decimals), EIP-712 domain name `Bridged USDC (Gnosis)` version `2`, chainId 100, network id `eip155:100`. payTo = GK Safe `0x3A08c86Efc5ff38CC35d850F1D4d564e497bFDEa`.
- When `packages/protocol/examples/roebel.netizen.json` changes, `packages/cli` tests must also run (standing repo rule).
- Secrets never enter the manifest or bundle — compose interpolates `${...}` from the box's `.env` (pattern: `render.ts` relay-sync service).
- Human-facing output (the `/pay` page, stats) never shows raw wallet addresses for *people* — authors appear as hex pubkeys/npubs only.
- Commit convention: `feat(gateway): …`, `feat(facilitator): …`, `feat(protocol): …`, `feat(cli): …`, `docs: …`.

---

### Task 1: `metering` manifest block (protocol) + Röbel example

**Files:**
- Modify: `packages/protocol/src/manifest.ts` (Services object, ~line 120–260)
- Modify: `packages/protocol/examples/roebel.netizen.json` (services block)
- Test: `packages/protocol/test/metering.test.ts` (create)

**Interfaces:**
- Produces: `services.metering` optional block with shape `{ payTo, network, asset, assetName, assetVersion, assetDecimals, prices: { bulk, export, firehoseDay }, split, unclaimedMonths? }`. Consumed by Task 9 (render) via `m.services.metering`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/protocol/test/metering.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { NetizenManifestSchema } from "../src/index.js";

const base = JSON.parse(
  readFileSync(fileURLToPath(new URL("../examples/roebel.netizen.json", import.meta.url)), "utf8"),
);

const METERING = {
  payTo: "0x3A08c86Efc5ff38CC35d850F1D4d564e497bFDEa",
  network: "eip155:100",
  asset: "0x2a22f9c3b484C3629090FeED35F17Ff8F88f76F0",
  assetName: "Bridged USDC (Gnosis)",
  assetVersion: "2",
  assetDecimals: 6,
  prices: { bulk: "500000", export: "5000000", firehoseDay: "1000000" },
  split: { authors: 50, treasury: 50 },
};

test("the example manifest declares metering and parses", () => {
  const parsed = NetizenManifestSchema.parse(base);
  assert.equal(parsed.services.metering?.payTo, METERING.payTo);
  assert.equal(parsed.services.metering?.prices.bulk, "500000");
});

test("metering.split must sum to 100", () => {
  const bad = structuredClone(base);
  bad.services.metering = { ...METERING, split: { authors: 60, treasury: 60 } };
  assert.throws(() => NetizenManifestSchema.parse(bad));
});

test("metering requires the indexer — the gateway reads its database", () => {
  const bad = structuredClone(base);
  delete bad.services.indexer;
  assert.throws(() => NetizenManifestSchema.parse(bad));
});

test("metering.network must match the declared chain", () => {
  const bad = structuredClone(base);
  bad.services.metering = { ...METERING, network: "eip155:8453" };
  assert.throws(() => NetizenManifestSchema.parse(bad));
});

test("prices are atomic-unit integer strings", () => {
  const bad = structuredClone(base);
  bad.services.metering = { ...METERING, prices: { ...METERING.prices, bulk: "0.5" } };
  assert.throws(() => NetizenManifestSchema.parse(bad));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @netizen-labs/protocol test`
Expected: FAIL — `metering` is unknown/undefined on the parsed manifest (first test), others may pass vacuously via throws; the first assertion must fail.

- [ ] **Step 3: Add the schema**

In `packages/protocol/src/manifest.ts`, inside the `Services` z.object — after the `publisher` field and before `buzz` — add:

```ts
  /**
   * Metered machine-scale access to the public record (x402).
   *
   * Human-scale reads stay free; /bulk, /export and /firehose on the index
   * host answer 402 until paid. Every settlement lands in `payTo` (the
   * treasury Safe) on this node's own chain; `split` fixes the author share
   * recorded per sale. Spec: docs/superpowers/specs/2026-08-05-x402-*.md
   */
  metering: z
    .object({
      payTo: address,
      /** CAIP-2 chain id, e.g. "eip155:100". Must match `chain.chainId`. */
      network: z.string().regex(/^eip155:\d+$/, "network must be a CAIP-2 eip155 id"),
      /** Settlement token — must implement EIP-3009 (probe before declaring). */
      asset: address,
      /** The token's EIP-712 domain, needed by payers to sign authorizations. */
      assetName: z.string().min(1),
      assetVersion: z.string().min(1),
      assetDecimals: z.number().int().min(0).max(36),
      /** Atomic-unit integer strings — a price with a decimal point is a bug. */
      prices: z.object({
        bulk: z.string().regex(/^\d+$/),
        export: z.string().regex(/^\d+$/),
        firehoseDay: z.string().regex(/^\d+$/),
      }),
      split: z
        .record(z.number())
        .refine(
          (s) => Object.values(s).reduce((a, b) => a + b, 0) === 100,
          "metering.split must sum to 100",
        ),
      /** Months until unclaimed author accruals roll to the treasury. */
      unclaimedMonths: z.number().int().positive().optional(),
    })
    .optional(),
```

Then, on the top-level `NetizenManifestSchema`, chain a `.superRefine` (after the closing `})` of the object, before the semicolon — `parseManifest`/`safeParseManifest` keep working because ZodEffects still exposes `.parse`/`.safeParse`):

```ts
export const NetizenManifestSchema = z
  .object({
    // ... existing fields unchanged ...
  })
  .superRefine((m, ctx) => {
    const met = m.services.metering;
    if (!met) return;
    if (!m.services.indexer) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["services", "metering"],
        message: "metering requires services.indexer — the gateway reads the index database",
      });
    }
    if (m.chain && met.network !== `eip155:${m.chain.chainId}`) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["services", "metering", "network"],
        message: `metering.network must be eip155:${m.chain.chainId} to match the declared chain`,
      });
    }
  });
```

**Check first** (grep) that nothing uses `NetizenManifestSchema.shape` or `.extend(` — if something does, put the `.superRefine` on the `Services` object instead and only validate the chain match at render time.

- [ ] **Step 4: Add the block to the Röbel example**

In `packages/protocol/examples/roebel.netizen.json`, inside `"services"` (sibling of `"indexer"`), add:

```json
"metering": {
  "payTo": "0x3A08c86Efc5ff38CC35d850F1D4d564e497bFDEa",
  "network": "eip155:100",
  "asset": "0x2a22f9c3b484C3629090FeED35F17Ff8F88f76F0",
  "assetName": "Bridged USDC (Gnosis)",
  "assetVersion": "2",
  "assetDecimals": 6,
  "prices": { "bulk": "500000", "export": "5000000", "firehoseDay": "1000000" },
  "split": { "authors": 50, "treasury": 50 }
}
```

- [ ] **Step 5: Run tests to verify they pass — protocol AND cli (example changed)**

Run: `pnpm --filter @netizen-labs/protocol test && pnpm --filter @netizen-labs/protocol typecheck && pnpm --filter netizen test`
Expected: protocol PASS. If cli tests fail because the example now has metering but render doesn't know the field yet, that's acceptable ONLY if the failure is a snapshot-style mismatch — inspect; render must ignore unknown blocks silently (it reads specific fields, so it should pass). Fix any genuine break before committing.

- [ ] **Step 6: Commit**

```bash
git add packages/protocol/src/manifest.ts packages/protocol/test/metering.test.ts packages/protocol/examples/roebel.netizen.json
git commit -m "feat(protocol): metering manifest block — x402 paid machine-scale access" -- packages/protocol/src/manifest.ts packages/protocol/test/metering.test.ts packages/protocol/examples/roebel.netizen.json
git push
```

---

### Task 2: Facilitator package — types, EIP-3009 typed data, verify

**Files:**
- Create: `packages/facilitator/package.json`, `packages/facilitator/tsconfig.json`
- Create: `packages/facilitator/src/types.ts`, `packages/facilitator/src/eip3009.ts`, `packages/facilitator/src/verify.ts`, `packages/facilitator/src/index.ts`
- Test: `packages/facilitator/test/verify.test.ts`

**Interfaces:**
- Produces (consumed by Task 3 server and by the gateway in Tasks 4/8 — the gateway imports **types only**):

```ts
// types.ts
export interface PaymentRequirements {
  scheme: "exact";
  network: string;                 // "eip155:100"
  maxAmountRequired: string;       // atomic units
  resource: string;                // absolute URL of the paid endpoint
  description: string;
  mimeType: string;
  payTo: `0x${string}`;
  maxTimeoutSeconds: number;
  asset: `0x${string}`;
  extra: { name: string; version: string };   // the asset's EIP-712 domain
}
export interface Eip3009Authorization {
  from: `0x${string}`; to: `0x${string}`; value: string;
  validAfter: string; validBefore: string; nonce: `0x${string}`;  // 32-byte hex
}
export interface ExactEvmPayload { signature: `0x${string}`; authorization: Eip3009Authorization; }
export interface PaymentPayload { x402Version: 1; scheme: "exact"; network: string; payload: ExactEvmPayload; }
export interface VerifyResult { isValid: boolean; invalidReason?: string; payer?: `0x${string}`; }
export interface SettleResult { success: boolean; errorReason?: "settle_reverted" | "network_error"; transaction?: `0x${string}`; network: string; }
// eip3009.ts
export function chainIdOf(network: string): number;                       // "eip155:100" -> 100
export function transferAuthTypedData(req: PaymentRequirements, auth: Eip3009Authorization): { domain; types; primaryType; message };
export const EIP3009_ABI: Abi;   // transferWithAuthorization(v,r,s overload) + authorizationState + balanceOf
// verify.ts
export interface VerifyDeps {
  readContract: (args: { address: `0x${string}`; functionName: "authorizationState" | "balanceOf"; args: readonly unknown[] }) => Promise<unknown>;
  now?: () => number;  // unix seconds, injectable for tests
}
export async function verifyExact(payload: PaymentPayload, req: PaymentRequirements, deps: VerifyDeps): Promise<VerifyResult>;
```

- [ ] **Step 1: Scaffold the package**

`packages/facilitator/package.json`:

```json
{
  "name": "@netizen-labs/facilitator",
  "version": "0.1.0",
  "private": true,
  "description": "Self-run x402 facilitator — verifies and settles exact-scheme EIP-3009 payments on the node's own chain.",
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "bin": { "netizen-facilitator": "src/cli.ts" },
  "exports": { ".": "./src/index.ts" },
  "files": ["src"],
  "scripts": {
    "start": "tsx src/cli.ts",
    "build": "esbuild src/cli.ts --bundle --platform=node --target=node22 --format=cjs --outfile=dist/facilitator.cjs",
    "test": "tsx --test test/*.test.ts",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": { "viem": "^2.47.6" },
  "devDependencies": {
    "@types/node": "^22.7.4",
    "esbuild": "^0.27.7",
    "tsx": "^4.19.2",
    "typescript": "^5.6.3"
  }
}
```

`packages/facilitator/tsconfig.json`: copy `packages/indexer/tsconfig.json` verbatim.

Run: `pnpm install` (registers the workspace package).

- [ ] **Step 2: Write the failing test**

```ts
// packages/facilitator/test/verify.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { privateKeyToAccount } from "viem/accounts";
import { verifyExact } from "../src/verify.js";
import { transferAuthTypedData, chainIdOf } from "../src/eip3009.js";
import type { PaymentPayload, PaymentRequirements, Eip3009Authorization } from "../src/types.js";

const payer = privateKeyToAccount(("0x" + "11".repeat(32)) as `0x${string}`);

const REQ: PaymentRequirements = {
  scheme: "exact",
  network: "eip155:100",
  maxAmountRequired: "500000",
  resource: "https://index.roebel.app/bulk/events",
  description: "bulk query",
  mimeType: "application/json",
  payTo: "0x3A08c86Efc5ff38CC35d850F1D4d564e497bFDEa",
  maxTimeoutSeconds: 60,
  asset: "0x2a22f9c3b484C3629090FeED35F17Ff8F88f76F0",
  extra: { name: "Bridged USDC (Gnosis)", version: "2" },
};

const NOW = 1_800_000_000;

async function signedPayload(overrides: Partial<Eip3009Authorization> = {}): Promise<PaymentPayload> {
  const authorization: Eip3009Authorization = {
    from: payer.address,
    to: REQ.payTo,
    value: "500000",
    validAfter: "0",
    validBefore: String(NOW + 600),
    nonce: ("0x" + "ab".repeat(32)) as `0x${string}`,
    ...overrides,
  };
  const typed = transferAuthTypedData(REQ, authorization);
  const signature = await payer.signTypedData(typed as Parameters<typeof payer.signTypedData>[0]);
  return { x402Version: 1, scheme: "exact", network: "eip155:100", payload: { signature, authorization } };
}

/** Happy-path chain state: nonce unused, balance ample. */
const chain = (state: { used?: boolean; balance?: bigint } = {}) => ({
  readContract: async ({ functionName }: { functionName: string }) =>
    functionName === "authorizationState" ? (state.used ?? false) : (state.balance ?? 10_000_000n),
  now: () => NOW,
});

test("chainIdOf parses CAIP-2", () => {
  assert.equal(chainIdOf("eip155:100"), 100);
});

test("a well-signed, funded, unused authorization verifies", async () => {
  const result = await verifyExact(await signedPayload(), REQ, chain());
  assert.equal(result.isValid, true);
  assert.equal(result.payer?.toLowerCase(), payer.address.toLowerCase());
});

test("value below the price is rejected", async () => {
  const result = await verifyExact(await signedPayload({ value: "499999" }), REQ, chain());
  assert.deepEqual([result.isValid, result.invalidReason], [false, "insufficient_value"]);
});

test("authorization to the wrong recipient is rejected", async () => {
  const result = await verifyExact(
    await signedPayload({ to: "0x0000000000000000000000000000000000000001" }),
    REQ,
    chain(),
  );
  assert.deepEqual([result.isValid, result.invalidReason], [false, "payTo_mismatch"]);
});

test("an expired authorization is rejected", async () => {
  const result = await verifyExact(await signedPayload({ validBefore: String(NOW - 1) }), REQ, chain());
  assert.deepEqual([result.isValid, result.invalidReason], [false, "expired"]);
});

test("a tampered value breaks the signature", async () => {
  const payload = await signedPayload();
  payload.payload.authorization.value = "9999999";
  const result = await verifyExact(payload, REQ, chain());
  assert.deepEqual([result.isValid, result.invalidReason], [false, "insufficient_value"]);
  // and when the tampered value still covers the price:
  const payload2 = await signedPayload({ value: "600000" });
  payload2.payload.authorization.value = "700000";
  const result2 = await verifyExact(payload2, REQ, chain());
  assert.deepEqual([result2.isValid, result2.invalidReason], [false, "bad_signature"]);
});

test("a used nonce is rejected", async () => {
  const result = await verifyExact(await signedPayload(), REQ, chain({ used: true }));
  assert.deepEqual([result.isValid, result.invalidReason], [false, "nonce_used"]);
});

test("insufficient balance is rejected", async () => {
  const result = await verifyExact(await signedPayload(), REQ, chain({ balance: 1n }));
  assert.deepEqual([result.isValid, result.invalidReason], [false, "insufficient_funds"]);
});

test("network mismatch is rejected before any chain call", async () => {
  const payload = await signedPayload();
  payload.network = "eip155:8453";
  const result = await verifyExact(payload, REQ, {
    readContract: async () => { throw new Error("must not be called"); },
    now: () => NOW,
  });
  assert.deepEqual([result.isValid, result.invalidReason], [false, "scheme_or_network_mismatch"]);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @netizen-labs/facilitator test`
Expected: FAIL — modules `../src/verify.js` etc. do not exist.

- [ ] **Step 4: Implement types.ts, eip3009.ts, verify.ts, index.ts**

`src/types.ts`: exactly the interfaces from the **Interfaces** block above (with a doc comment noting the shapes follow x402's `exact` scheme so standard clients interoperate).

`src/eip3009.ts`:

```ts
import { parseAbi } from "viem";
import type { PaymentRequirements, Eip3009Authorization } from "./types.js";

/** "eip155:100" -> 100. Throws on anything that is not a CAIP-2 eip155 id. */
export function chainIdOf(network: string): number {
  const match = /^eip155:(\d+)$/.exec(network);
  if (!match) throw new Error(`not an eip155 network id: ${network}`);
  return Number(match[1]);
}

/** The v/r/s overload is the one every FiatTokenV2-family deployment carries. */
export const EIP3009_ABI = parseAbi([
  "function transferWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s)",
  "function authorizationState(address authorizer, bytes32 nonce) view returns (bool)",
  "function balanceOf(address account) view returns (uint256)",
]);

/**
 * The EIP-712 payload a payer signs. Domain values come from the payment
 * requirements (which come from the manifest) — never hardcoded, so any
 * EIP-3009 token on any chain works from the same code.
 */
export function transferAuthTypedData(req: PaymentRequirements, auth: Eip3009Authorization) {
  return {
    domain: {
      name: req.extra.name,
      version: req.extra.version,
      chainId: chainIdOf(req.network),
      verifyingContract: req.asset,
    },
    types: {
      TransferWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" },
      ],
    },
    primaryType: "TransferWithAuthorization" as const,
    message: {
      from: auth.from,
      to: auth.to,
      value: BigInt(auth.value),
      validAfter: BigInt(auth.validAfter),
      validBefore: BigInt(auth.validBefore),
      nonce: auth.nonce,
    },
  };
}
```

`src/verify.ts`:

```ts
import { recoverTypedDataAddress } from "viem";
import { transferAuthTypedData } from "./eip3009.js";
import type { PaymentPayload, PaymentRequirements, VerifyResult } from "./types.js";

export interface VerifyDeps {
  readContract: (args: {
    address: `0x${string}`;
    functionName: "authorizationState" | "balanceOf";
    args: readonly unknown[];
  }) => Promise<unknown>;
  /** Unix seconds. Injectable so tests are deterministic. */
  now?: () => number;
}

const invalid = (invalidReason: string): VerifyResult => ({ isValid: false, invalidReason });

/**
 * Fail-closed verification of an exact-scheme EIP-3009 payment.
 * Cheap checks first; the two RPC reads happen only for a payload that is
 * already internally consistent and correctly signed.
 */
export async function verifyExact(
  payload: PaymentPayload,
  req: PaymentRequirements,
  deps: VerifyDeps,
): Promise<VerifyResult> {
  const auth = payload.payload?.authorization;
  if (!auth || payload.scheme !== "exact" || payload.network !== req.network) {
    return invalid("scheme_or_network_mismatch");
  }
  if (auth.to.toLowerCase() !== req.payTo.toLowerCase()) return invalid("payTo_mismatch");
  if (BigInt(auth.value) < BigInt(req.maxAmountRequired)) return invalid("insufficient_value");

  const now = deps.now?.() ?? Math.floor(Date.now() / 1000);
  if (Number(auth.validAfter) > now) return invalid("not_yet_valid");
  // A few seconds of margin: the settle tx must still land inside the window.
  if (Number(auth.validBefore) < now + 6) return invalid("expired");

  let recovered: string;
  try {
    recovered = await recoverTypedDataAddress({
      ...transferAuthTypedData(req, auth),
      signature: payload.payload.signature,
    });
  } catch {
    return invalid("bad_signature");
  }
  if (recovered.toLowerCase() !== auth.from.toLowerCase()) return invalid("bad_signature");

  const used = await deps.readContract({
    address: req.asset, functionName: "authorizationState", args: [auth.from, auth.nonce],
  });
  if (used) return invalid("nonce_used");

  const balance = (await deps.readContract({
    address: req.asset, functionName: "balanceOf", args: [auth.from],
  })) as bigint;
  if (balance < BigInt(auth.value)) return invalid("insufficient_funds");

  return { isValid: true, payer: auth.from };
}
```

`src/index.ts`:

```ts
export type * from "./types.js";
export { chainIdOf, transferAuthTypedData, EIP3009_ABI } from "./eip3009.js";
export { verifyExact, type VerifyDeps } from "./verify.js";
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @netizen-labs/facilitator test && pnpm --filter @netizen-labs/facilitator typecheck`
Expected: PASS (9 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/facilitator/package.json packages/facilitator/tsconfig.json packages/facilitator/src packages/facilitator/test pnpm-lock.yaml
git commit -m "feat(facilitator): x402 exact-scheme verification for EIP-3009 tokens" -- packages/facilitator pnpm-lock.yaml
git push
```

---

### Task 3: Facilitator — settle, HTTP server, CLI, build

**Files:**
- Create: `packages/facilitator/src/settle.ts`, `packages/facilitator/src/server.ts`, `packages/facilitator/src/cli.ts`
- Modify: `packages/facilitator/src/index.ts`
- Test: `packages/facilitator/test/server.test.ts`

**Interfaces:**
- Consumes: `verifyExact`, `EIP3009_ABI`, types from Task 2.
- Produces the HTTP contract the gateway (Task 4) calls:
  - `POST /verify` body `{ paymentPayload: PaymentPayload, paymentRequirements: PaymentRequirements }` → `VerifyResult` JSON
  - `POST /settle` same body → `SettleResult` JSON
  - `GET /supported` → `{ kinds: [{ scheme: "exact", network: string }] }`
  - `createFacilitatorServer(deps: ServerDeps): http.Server` where `ServerDeps = { network: string; verify: (p, r) => Promise<VerifyResult>; settle: (p, r) => Promise<SettleResult> }`

- [ ] **Step 1: Write the failing test**

```ts
// packages/facilitator/test/server.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createFacilitatorServer } from "../src/server.js";

async function withServer(
  deps: Partial<Parameters<typeof createFacilitatorServer>[0]>,
  run: (base: string) => Promise<void>,
) {
  const server = createFacilitatorServer({
    network: "eip155:100",
    verify: async () => ({ isValid: true, payer: "0x0000000000000000000000000000000000000001" }),
    settle: async () => ({ success: true, transaction: "0xabc" as `0x${string}`, network: "eip155:100" }),
    ...deps,
  });
  await new Promise<void>((r) => server.listen(0, r));
  try {
    await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } finally {
    server.close();
  }
}

test("GET /supported names the scheme and network", async () => {
  await withServer({}, async (base) => {
    const res = await fetch(`${base}/supported`);
    assert.deepEqual(await res.json(), { kinds: [{ scheme: "exact", network: "eip155:100" }] });
  });
});

test("POST /verify routes body to the verifier", async () => {
  await withServer(
    { verify: async (p) => ({ isValid: false, invalidReason: `saw:${(p as { network: string }).network}` }) },
    async (base) => {
      const res = await fetch(`${base}/verify`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ paymentPayload: { network: "eip155:100" }, paymentRequirements: {} }),
      });
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), { isValid: false, invalidReason: "saw:eip155:100" });
    },
  );
});

test("POST /settle returns the settle result", async () => {
  await withServer({}, async (base) => {
    const res = await fetch(`${base}/settle`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ paymentPayload: {}, paymentRequirements: {} }),
    });
    assert.deepEqual(await res.json(), { success: true, transaction: "0xabc", network: "eip155:100" });
  });
});

test("malformed JSON is a 400, not a crash", async () => {
  await withServer({}, async (base) => {
    const res = await fetch(`${base}/verify`, { method: "POST", body: "{nope" });
    assert.equal(res.status, 400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @netizen-labs/facilitator test`
Expected: FAIL — `../src/server.js` does not exist.

- [ ] **Step 3: Implement settle.ts, server.ts, cli.ts**

`src/settle.ts`:

```ts
import { parseSignature } from "viem";
import { EIP3009_ABI } from "./eip3009.js";
import type { PaymentPayload, PaymentRequirements, SettleResult } from "./types.js";

export interface SettleDeps {
  /** viem walletClient.writeContract, pre-bound to chain + settler account. */
  writeContract: (args: {
    address: `0x${string}`; abi: typeof EIP3009_ABI;
    functionName: "transferWithAuthorization"; args: readonly unknown[];
  }) => Promise<`0x${string}`>;
  waitForReceipt: (hash: `0x${string}`) => Promise<{ status: "success" | "reverted" }>;
}

/**
 * Submit the payer-signed authorization from the settler EOA. The settler pays
 * only gas (xDAI); the value moves straight from payer to payTo, so a
 * compromised settler key can waste gas but cannot redirect funds.
 */
export async function settleExact(
  payload: PaymentPayload,
  req: PaymentRequirements,
  deps: SettleDeps,
): Promise<SettleResult> {
  const auth = payload.payload.authorization;
  // viem 2.x: parseSignature. `v` is absent on compact signatures — derive it
  // from yParity, which is always present.
  const sig = parseSignature(payload.payload.signature);
  const v = sig.v ?? BigInt((sig.yParity ?? 0) + 27);
  const { r, s } = sig;
  try {
    const hash = await deps.writeContract({
      address: req.asset,
      abi: EIP3009_ABI,
      functionName: "transferWithAuthorization",
      args: [auth.from, auth.to, BigInt(auth.value), BigInt(auth.validAfter), BigInt(auth.validBefore), auth.nonce, Number(v), r, s],
    });
    const receipt = await deps.waitForReceipt(hash);
    if (receipt.status !== "success") return { success: false, errorReason: "settle_reverted", transaction: hash, network: req.network };
    return { success: true, transaction: hash, network: req.network };
  } catch (error) {
    // Distinguish an on-chain revert (payment is bad — do not serve) from an
    // RPC failure (payment may be fine — the caller decides, spec §8).
    const message = (error as Error).message ?? "";
    if (/revert|reverted|execution/i.test(message)) {
      return { success: false, errorReason: "settle_reverted", network: req.network };
    }
    return { success: false, errorReason: "network_error", network: req.network };
  }
}
```

`src/server.ts`:

```ts
import { createServer, type Server } from "node:http";
import type { PaymentPayload, PaymentRequirements, SettleResult, VerifyResult } from "./types.js";

export interface ServerDeps {
  network: string;
  verify: (p: PaymentPayload, r: PaymentRequirements) => Promise<VerifyResult>;
  settle: (p: PaymentPayload, r: PaymentRequirements) => Promise<SettleResult>;
}

/** Internal-only service: reachable as `facilitator:8402` on the compose
 *  network, never routed by Caddy. No auth by design — the boundary is the
 *  docker network, exactly like postgres. */
export function createFacilitatorServer(deps: ServerDeps): Server {
  return createServer(async (req, res) => {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    try {
      if (req.method === "GET" && req.url === "/supported") {
        return send(200, { kinds: [{ scheme: "exact", network: deps.network }] });
      }
      if (req.method === "POST" && (req.url === "/verify" || req.url === "/settle")) {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);
        let body: { paymentPayload: PaymentPayload; paymentRequirements: PaymentRequirements };
        try {
          body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        } catch {
          return send(400, { error: "malformed JSON body" });
        }
        const handler = req.url === "/verify" ? deps.verify : deps.settle;
        return send(200, await handler(body.paymentPayload, body.paymentRequirements));
      }
      send(404, { error: "not found", endpoints: ["/verify", "/settle", "/supported"] });
    } catch (error) {
      console.error("[facilitator] request failed:", error);
      send(500, { error: "internal" });
    }
  });
}
```

`src/cli.ts`:

```ts
#!/usr/bin/env node
import { createPublicClient, createWalletClient, defineChain, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { chainIdOf, EIP3009_ABI } from "./eip3009.js";
import { verifyExact } from "./verify.js";
import { settleExact } from "./settle.js";
import { createFacilitatorServer } from "./server.js";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`missing required env var: ${name}`);
    process.exit(2);
  }
  return value;
}

const network = required("NETWORK");            // e.g. eip155:100
const rpcUrl = required("RPC_URL");
const settlerPriv = required("SETTLER_PRIV");   // gas-only key; cannot redirect funds
const port = Number(process.env.PORT ?? 8402);

const chain = defineChain({
  id: chainIdOf(network),
  name: network,
  nativeCurrency: { name: "native", symbol: "NATIVE", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
});
const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
const settler = privateKeyToAccount(settlerPriv as `0x${string}`);
const walletClient = createWalletClient({ chain, transport: http(rpcUrl), account: settler });

createFacilitatorServer({
  network,
  verify: (p, r) =>
    verifyExact(p, r, {
      readContract: ({ address, functionName, args }) =>
        publicClient.readContract({ address, abi: EIP3009_ABI, functionName, args } as Parameters<typeof publicClient.readContract>[0]),
    }),
  settle: (p, r) =>
    settleExact(p, r, {
      writeContract: (args) => walletClient.writeContract({ ...args, chain, account: settler }),
      waitForReceipt: async (hash) => {
        const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 45_000 });
        return { status: receipt.status === "success" ? "success" : "reverted" };
      },
    }),
}).listen(port, () => {
  console.log(`facilitator for ${network} listening on :${port}; settler ${settler.address}`);
});
```

Append to `src/index.ts`:

```ts
export { settleExact, type SettleDeps } from "./settle.js";
export { createFacilitatorServer, type ServerDeps } from "./server.js";
```

- [ ] **Step 4: Run tests + typecheck + build**

Run: `pnpm --filter @netizen-labs/facilitator test && pnpm --filter @netizen-labs/facilitator typecheck && pnpm --filter @netizen-labs/facilitator build`
Expected: PASS; `dist/facilitator.cjs` exists.

- [ ] **Step 5: Commit**

```bash
git add packages/facilitator/src packages/facilitator/test
git commit -m "feat(facilitator): settle + HTTP verify/settle service" -- packages/facilitator/src packages/facilitator/test
git push
```

---

### Task 4: Gateway package — config + x402 handshake module

**Files:**
- Create: `packages/gateway/package.json`, `packages/gateway/tsconfig.json`
- Create: `packages/gateway/src/config.ts`, `packages/gateway/src/x402.ts`, `packages/gateway/src/index.ts`
- Test: `packages/gateway/test/x402.test.ts`

**Interfaces:**
- Consumes: types from `@netizen-labs/facilitator` (types only — the runtime talks HTTP).
- Produces (consumed by Tasks 5–8):

```ts
// config.ts
export interface MeteringConfig {
  nodeId: string; publicBase: string;           // e.g. https://index.roebel.app
  payTo: `0x${string}`; network: string; asset: `0x${string}`;
  assetName: string; assetVersion: string; assetDecimals: number;
  prices: { bulk: string; export: string; firehoseDay: string };
  splitAuthors: number;                          // integer percent
  facilitatorUrl: string; excludedFile?: string; port: number;
}
export function configFromEnv(env: NodeJS.ProcessEnv): MeteringConfig;  // throws on missing
export function formatAtomic(amount: string, decimals: number): string; // "500000",6 -> "0.50"
// x402.ts
export function requirementsFor(cfg: MeteringConfig, path: string, price: string, description: string): PaymentRequirements;
export function body402(cfg: MeteringConfig, path: string, price: string, description: string, error?: string): object;
export function parsePayment(header: string): PaymentPayload | null;    // base64 JSON, null on garbage
export function encodePaymentResponse(result: SettleResult): string;    // base64 JSON for X-PAYMENT-RESPONSE
export class FacilitatorClient {
  constructor(baseUrl: string, fetchImpl?: typeof fetch);
  verify(p: PaymentPayload, r: PaymentRequirements): Promise<VerifyResult>;
  settle(p: PaymentPayload, r: PaymentRequirements): Promise<SettleResult>;
}
```

- [ ] **Step 1: Scaffold**

`packages/gateway/package.json` — same shape as facilitator's with:

```json
{
  "name": "@netizen-labs/gateway",
  "version": "0.1.0",
  "private": true,
  "description": "Metered machine-scale access to the public record — x402-paid bulk, export and firehose endpoints wrapping the indexer.",
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "bin": { "netizen-gateway": "src/cli.ts" },
  "exports": { ".": "./src/index.ts" },
  "files": ["src"],
  "scripts": {
    "start": "tsx src/cli.ts",
    "build": "esbuild src/cli.ts --bundle --platform=node --target=node22 --format=cjs --outfile=dist/gateway.cjs",
    "test": "tsx --test test/*.test.ts",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@netizen-labs/facilitator": "workspace:*",
    "@netizen-labs/indexer": "workspace:*",
    "pg": "^8.13.1"
  },
  "devDependencies": {
    "@types/node": "^22.7.4",
    "@types/pg": "^8.11.10",
    "esbuild": "^0.27.7",
    "tsx": "^4.19.2",
    "typescript": "^5.6.3"
  }
}
```

`tsconfig.json`: copy from indexer. Run `pnpm install`.

- [ ] **Step 2: Write the failing test**

```ts
// packages/gateway/test/x402.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { configFromEnv, formatAtomic } from "../src/config.js";
import { FacilitatorClient, body402, encodePaymentResponse, parsePayment, requirementsFor } from "../src/x402.js";
import type { PaymentPayload } from "@netizen-labs/facilitator";

const ENV = {
  NODE_ID: "roebel",
  PUBLIC_BASE: "https://index.roebel.app",
  DATABASE_URL: "postgres://x",
  FACILITATOR_URL: "http://facilitator:8402",
  PAY_TO: "0x3A08c86Efc5ff38CC35d850F1D4d564e497bFDEa",
  NETWORK: "eip155:100",
  ASSET: "0x2a22f9c3b484C3629090FeED35F17Ff8F88f76F0",
  ASSET_NAME: "Bridged USDC (Gnosis)",
  ASSET_VERSION: "2",
  ASSET_DECIMALS: "6",
  PRICE_BULK: "500000",
  PRICE_EXPORT: "5000000",
  PRICE_FIREHOSE_DAY: "1000000",
  SPLIT_AUTHORS: "50",
} as NodeJS.ProcessEnv;

test("config parses the rendered environment", () => {
  const cfg = configFromEnv(ENV);
  assert.equal(cfg.prices.bulk, "500000");
  assert.equal(cfg.splitAuthors, 50);
  assert.equal(cfg.port, 8402);
});

test("config refuses a missing variable", () => {
  const { PAY_TO: _omit, ...rest } = ENV;
  assert.throws(() => configFromEnv(rest as NodeJS.ProcessEnv), /PAY_TO/);
});

test("formatAtomic renders human prices", () => {
  assert.equal(formatAtomic("500000", 6), "0.50");
  assert.equal(formatAtomic("5000000", 6), "5.00");
  assert.equal(formatAtomic("1000001", 6), "1.000001");
});

test("requirementsFor builds a full x402 exact requirement", () => {
  const req = requirementsFor(configFromEnv(ENV), "/bulk/events", "500000", "bulk query");
  assert.equal(req.scheme, "exact");
  assert.equal(req.resource, "https://index.roebel.app/bulk/events");
  assert.equal(req.maxAmountRequired, "500000");
  assert.deepEqual(req.extra, { name: "Bridged USDC (Gnosis)", version: "2" });
});

test("body402 carries accepts plus a human link", () => {
  const body = body402(configFromEnv(ENV), "/export", "5000000", "full export") as {
    x402Version: number; accepts: unknown[]; payLink: string; error: string;
  };
  assert.equal(body.x402Version, 1);
  assert.equal(body.accepts.length, 1);
  assert.equal(body.payLink, "https://index.roebel.app/pay");
});

test("parsePayment round-trips and rejects garbage", () => {
  const payload: PaymentPayload = {
    x402Version: 1, scheme: "exact", network: "eip155:100",
    payload: {
      signature: "0xsig" as `0x${string}`,
      authorization: {
        from: "0x0000000000000000000000000000000000000001",
        to: "0x0000000000000000000000000000000000000002",
        value: "1", validAfter: "0", validBefore: "9", nonce: ("0x" + "00".repeat(32)) as `0x${string}`,
      },
    },
  };
  const header = Buffer.from(JSON.stringify(payload)).toString("base64");
  assert.deepEqual(parsePayment(header), payload);
  assert.equal(parsePayment("not-base64-json!!"), null);
  assert.equal(parsePayment(Buffer.from("{}").toString("base64")), null);
});

test("encodePaymentResponse is base64 JSON", () => {
  const encoded = encodePaymentResponse({ success: true, transaction: "0xabc" as `0x${string}`, network: "eip155:100" });
  assert.deepEqual(JSON.parse(Buffer.from(encoded, "base64").toString("utf8")).transaction, "0xabc");
});

test("FacilitatorClient posts to /verify and /settle", async () => {
  const calls: string[] = [];
  const client = new FacilitatorClient("http://fac:1", (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push(String(url));
    assert.equal(init?.method, "POST");
    return new Response(JSON.stringify({ isValid: true }), { status: 200 });
  }) as typeof fetch);
  await client.verify({} as PaymentPayload, {} as never);
  assert.deepEqual(calls, ["http://fac:1/verify"]);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @netizen-labs/gateway test`
Expected: FAIL — modules missing.

- [ ] **Step 4: Implement config.ts and x402.ts**

`src/config.ts`:

```ts
export interface MeteringConfig {
  nodeId: string;
  publicBase: string;
  payTo: `0x${string}`;
  network: string;
  asset: `0x${string}`;
  assetName: string;
  assetVersion: string;
  assetDecimals: number;
  prices: { bulk: string; export: string; firehoseDay: string };
  splitAuthors: number;
  facilitatorUrl: string;
  excludedFile?: string;
  port: number;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`missing required env var: ${name}`);
  return value;
}

export function configFromEnv(env: NodeJS.ProcessEnv): MeteringConfig {
  return {
    nodeId: required(env, "NODE_ID"),
    publicBase: required(env, "PUBLIC_BASE").replace(/\/$/, ""),
    payTo: required(env, "PAY_TO") as `0x${string}`,
    network: required(env, "NETWORK"),
    asset: required(env, "ASSET") as `0x${string}`,
    assetName: required(env, "ASSET_NAME"),
    assetVersion: required(env, "ASSET_VERSION"),
    assetDecimals: Number(required(env, "ASSET_DECIMALS")),
    prices: {
      bulk: required(env, "PRICE_BULK"),
      export: required(env, "PRICE_EXPORT"),
      firehoseDay: required(env, "PRICE_FIREHOSE_DAY"),
    },
    splitAuthors: Number(required(env, "SPLIT_AUTHORS")),
    facilitatorUrl: required(env, "FACILITATOR_URL"),
    excludedFile: env.EXCLUDED_FILE || undefined,
    port: Number(env.PORT ?? 8402),
  };
}

/** "500000",6 -> "0.50" — trailing zeros trimmed to two places minimum. */
export function formatAtomic(amount: string, decimals: number): string {
  const negative = amount.startsWith("-");
  const digits = (negative ? amount.slice(1) : amount).padStart(decimals + 1, "0");
  const whole = digits.slice(0, -decimals) || "0";
  const frac = decimals ? digits.slice(-decimals) : "";
  const trimmed = frac.replace(/0+$/, "");
  const shown = trimmed.length < 2 ? frac.slice(0, 2) : trimmed;
  return `${negative ? "-" : ""}${whole}${shown ? "." + shown : ""}`;
}
```

`src/x402.ts`:

```ts
import type { PaymentPayload, PaymentRequirements, SettleResult, VerifyResult } from "@netizen-labs/facilitator";
import type { MeteringConfig } from "./config.js";

export function requirementsFor(
  cfg: MeteringConfig, path: string, price: string, description: string,
): PaymentRequirements {
  return {
    scheme: "exact",
    network: cfg.network,
    maxAmountRequired: price,
    resource: `${cfg.publicBase}${path}`,
    description,
    mimeType: "application/json",
    payTo: cfg.payTo,
    maxTimeoutSeconds: 60,
    asset: cfg.asset,
    extra: { name: cfg.assetName, version: cfg.assetVersion },
  };
}

export function body402(
  cfg: MeteringConfig, path: string, price: string, description: string, error = "payment required",
) {
  return {
    x402Version: 1,
    error,
    accepts: [requirementsFor(cfg, path, price, description)],
    /** Not part of x402 — a human landing here needs a way in too (spec P2). */
    payLink: `${cfg.publicBase}/pay`,
  };
}

export function parsePayment(header: string): PaymentPayload | null {
  try {
    const parsed = JSON.parse(Buffer.from(header, "base64").toString("utf8")) as PaymentPayload;
    if (parsed?.scheme !== "exact" || !parsed.payload?.authorization?.from) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function encodePaymentResponse(result: SettleResult): string {
  return Buffer.from(JSON.stringify(result)).toString("base64");
}

export class FacilitatorClient {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async post<T>(path: string, paymentPayload: PaymentPayload, paymentRequirements: PaymentRequirements): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ paymentPayload, paymentRequirements }),
    });
    if (!res.ok) throw new Error(`facilitator ${path} -> ${res.status}`);
    return (await res.json()) as T;
  }

  verify(p: PaymentPayload, r: PaymentRequirements): Promise<VerifyResult> {
    return this.post("/verify", p, r);
  }
  settle(p: PaymentPayload, r: PaymentRequirements): Promise<SettleResult> {
    return this.post("/settle", p, r);
  }
}
```

`src/index.ts`:

```ts
export { configFromEnv, formatAtomic, type MeteringConfig } from "./config.js";
export { FacilitatorClient, body402, encodePaymentResponse, parsePayment, requirementsFor } from "./x402.js";
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @netizen-labs/gateway test && pnpm --filter @netizen-labs/gateway typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/gateway/package.json packages/gateway/tsconfig.json packages/gateway/src packages/gateway/test pnpm-lock.yaml
git commit -m "feat(gateway): config + x402 handshake (402 body, X-PAYMENT parse, facilitator client)" -- packages/gateway pnpm-lock.yaml
git push
```

---

### Task 5: Gateway — ledger schema, recording, accrual view

**Files:**
- Create: `packages/gateway/src/ledger.ts`
- Modify: `packages/gateway/src/index.ts`
- Test: `packages/gateway/test/ledger.test.ts`

**Interfaces:**
- Produces (consumed by Tasks 6–8):

```ts
export const LEDGER_SCHEMA_SQL: string;   // idempotent, run at boot like indexer's SCHEMA_SQL
export interface LedgerEntry {
  endpoint: string; payer: string; amount: string; asset: string;
  network: string; splitAuthors: number; tx: string | null; nonce: string | null; reconcile: boolean;
}
export function insertLedgerSql(e: LedgerEntry): { text: string; values: unknown[] };  // RETURNING id
export function countByAuthor(rows: Array<{ pubkey: string }>): Map<string, number>;
export function insertServingSql(ledgerId: number, counts: Map<string, number>): { text: string; values: unknown[] } | null;
export const STATS_TOTALS_SQL: string;     // one row: requests, revenue
export const STATS_ENDPOINTS_SQL: string;  // per endpoint
export const TOP_ACCRUALS_SQL: string;     // author, accrued_atomic (LIMIT 100)
```

- [ ] **Step 1: Write the failing test**

```ts
// packages/gateway/test/ledger.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LEDGER_SCHEMA_SQL, countByAuthor, insertLedgerSql, insertServingSql,
} from "../src/ledger.js";

test("schema creates ledger, serving log, passes and the accrual view", () => {
  for (const object of ["access_ledger", "serving_log", "firehose_passes", "metering_accruals"]) {
    assert.ok(LEDGER_SCHEMA_SQL.includes(object), `schema must define ${object}`);
  }
});

test("insertLedgerSql binds every column and returns the id", () => {
  const built = insertLedgerSql({
    endpoint: "/bulk/events", payer: "0xpayer", amount: "500000",
    asset: "0xasset", network: "eip155:100", splitAuthors: 50,
    tx: "0xtx", nonce: "0xnonce", reconcile: false,
  });
  assert.match(built.text, /RETURNING id/);
  assert.equal(built.values.length, 9);
  assert.equal(built.values[2], "500000");
});

test("countByAuthor aggregates served rows per pubkey", () => {
  const counts = countByAuthor([{ pubkey: "a" }, { pubkey: "b" }, { pubkey: "a" }]);
  assert.equal(counts.get("a"), 2);
  assert.equal(counts.get("b"), 1);
});

test("insertServingSql expands to one row per author, null on empty", () => {
  const built = insertServingSql(7, new Map([["a", 2], ["b", 1]]));
  assert.ok(built);
  assert.equal((built.text.match(/\(\$/g) ?? []).length, 2, "two value tuples");
  assert.deepEqual(built.values, [7, "a", 2, 7, "b", 1]);
  assert.equal(insertServingSql(7, new Map()), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @netizen-labs/gateway test`
Expected: FAIL — `../src/ledger.js` missing.

- [ ] **Step 3: Implement ledger.ts**

```ts
// packages/gateway/src/ledger.ts
/**
 * The meter's memory. Every paid request writes one access_ledger row and, per
 * served author, a serving_log row. The accrual view turns those into "what
 * does this npub's data have earned" — computed, never stored, so a split
 * change never rewrites history (split_authors is snapshotted per sale).
 */
export const LEDGER_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS access_ledger (
  id            BIGSERIAL PRIMARY KEY,
  ts            TIMESTAMPTZ NOT NULL DEFAULT now(),
  endpoint      TEXT NOT NULL,
  payer         TEXT NOT NULL,
  amount        NUMERIC(78,0) NOT NULL,
  asset         TEXT NOT NULL,
  network       TEXT NOT NULL,
  split_authors INTEGER NOT NULL,
  tx            TEXT,
  nonce         TEXT,
  -- true when we served after a network_error settle: the authorization was
  -- valid but the tx did not confirm — re-submit or write off, by hand.
  reconcile     BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS serving_log (
  ledger_id BIGINT NOT NULL REFERENCES access_ledger(id),
  author    TEXT NOT NULL,
  events    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_serving_log_ledger ON serving_log (ledger_id);
CREATE INDEX IF NOT EXISTS idx_serving_log_author ON serving_log (author);

CREATE TABLE IF NOT EXISTS firehose_passes (
  token      TEXT PRIMARY KEY,
  ledger_id  BIGINT NOT NULL REFERENCES access_ledger(id),
  expires_at TIMESTAMPTZ NOT NULL
);

-- Pro-rata author accrual: each sale's author share, divided by events served.
CREATE OR REPLACE VIEW metering_accruals AS
SELECT s.author,
       SUM(l.amount * l.split_authors / 100.0 * s.events::numeric / t.total_events) AS accrued_atomic
FROM serving_log s
JOIN access_ledger l ON l.id = s.ledger_id
JOIN (SELECT ledger_id, SUM(events) AS total_events FROM serving_log GROUP BY ledger_id) t
  ON t.ledger_id = s.ledger_id
GROUP BY s.author;
`;

export interface LedgerEntry {
  endpoint: string;
  payer: string;
  amount: string;
  asset: string;
  network: string;
  splitAuthors: number;
  tx: string | null;
  nonce: string | null;
  reconcile: boolean;
}

export function insertLedgerSql(e: LedgerEntry): { text: string; values: unknown[] } {
  return {
    text: `INSERT INTO access_ledger (endpoint, payer, amount, asset, network, split_authors, tx, nonce, reconcile)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`.replace(/\s+/g, " "),
    values: [e.endpoint, e.payer, e.amount, e.asset, e.network, e.splitAuthors, e.tx, e.nonce, e.reconcile],
  };
}

export function countByAuthor(rows: Array<{ pubkey: string }>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.pubkey, (counts.get(row.pubkey) ?? 0) + 1);
  return counts;
}

export function insertServingSql(
  ledgerId: number, counts: Map<string, number>,
): { text: string; values: unknown[] } | null {
  if (counts.size === 0) return null;
  const values: unknown[] = [];
  const tuples: string[] = [];
  for (const [author, events] of counts) {
    tuples.push(`($${values.length + 1},$${values.length + 2},$${values.length + 3})`);
    values.push(ledgerId, author, events);
  }
  return { text: `INSERT INTO serving_log (ledger_id, author, events) VALUES ${tuples.join(",")}`, values };
}

export const STATS_TOTALS_SQL =
  `SELECT COUNT(*)::int AS requests, COALESCE(SUM(amount),0)::text AS revenue_atomic FROM access_ledger`;

export const STATS_ENDPOINTS_SQL =
  `SELECT endpoint, COUNT(*)::int AS requests, COALESCE(SUM(amount),0)::text AS revenue_atomic
   FROM access_ledger GROUP BY endpoint ORDER BY endpoint`.replace(/\s+/g, " ");

export const TOP_ACCRUALS_SQL =
  `SELECT author, ROUND(accrued_atomic)::text AS accrued_atomic
   FROM metering_accruals ORDER BY accrued_atomic DESC LIMIT 100`.replace(/\s+/g, " ");
```

Append to `src/index.ts`:

```ts
export {
  LEDGER_SCHEMA_SQL, STATS_ENDPOINTS_SQL, STATS_TOTALS_SQL, TOP_ACCRUALS_SQL,
  countByAuthor, insertLedgerSql, insertServingSql, type LedgerEntry,
} from "./ledger.js";
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @netizen-labs/gateway test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/gateway/src/ledger.ts packages/gateway/src/index.ts packages/gateway/test/ledger.test.ts
git commit -m "feat(gateway): access ledger, serving log and pro-rata accrual view" -- packages/gateway/src packages/gateway/test
git push
```

---

### Task 6: Gateway — bulk query, cursor, exclusion list

**Files:**
- Create: `packages/gateway/src/bulk.ts`, `packages/gateway/src/exclusions.ts`
- Modify: `packages/gateway/src/index.ts`
- Test: `packages/gateway/test/bulk.test.ts`

**Interfaces:**
- Consumes: `EventQuery` type from `@netizen-labs/indexer`.
- Produces (consumed by Task 8):

```ts
export const BULK_MAX_LIMIT = 10000;
export interface BulkCursor { until: number; afterId: string }
export function encodeCursor(c: BulkCursor): string;                 // base64url JSON
export function decodeCursor(s: string | null): BulkCursor | null;   // null on garbage
export function buildBulkQuery(q: EventQuery, cursor: BulkCursor | null, excluded: ReadonlySet<string>): { text: string; values: unknown[] };
export function nextCursor(rows: Array<{ created_at: number; id: string }>, limit: number): string | null;
export function loadExclusions(path: string): Set<string>;           // hex pubkeys; '#' comments; missing file -> empty set
```

- [ ] **Step 1: Write the failing test**

```ts
// packages/gateway/test/bulk.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BULK_MAX_LIMIT, buildBulkQuery, decodeCursor, encodeCursor, nextCursor,
} from "../src/bulk.js";
import { loadExclusions } from "../src/exclusions.js";

test("cursor round-trips and rejects garbage", () => {
  const cursor = { until: 1_754_000_000, afterId: "ab".repeat(32) };
  assert.deepEqual(decodeCursor(encodeCursor(cursor)), cursor);
  assert.equal(decodeCursor("!!!"), null);
  assert.equal(decodeCursor(null), null);
});

test("bulk query clamps the limit to BULK_MAX_LIMIT", () => {
  const built = buildBulkQuery({ limit: 999_999 }, null, new Set());
  assert.equal(built.values.at(-1), BULK_MAX_LIMIT);
});

test("a cursor becomes a keyset clause, not OFFSET", () => {
  const built = buildBulkQuery({}, { until: 100, afterId: "aa" }, new Set());
  assert.match(built.text, /created_at < \$/);
  assert.match(built.text, /id > \$/);
  assert.ok(!/OFFSET/i.test(built.text));
});

test("excluded authors are filtered out of the SQL", () => {
  const built = buildBulkQuery({}, null, new Set(["deadbeef"]));
  assert.match(built.text, /pubkey != ALL/);
  assert.ok(built.values.some((v) => Array.isArray(v) && v.includes("deadbeef")));
});

test("filters from EventQuery still apply (kinds + since)", () => {
  const built = buildBulkQuery({ kinds: [1, 30023], since: 5 }, null, new Set());
  assert.match(built.text, /kind = ANY/);
  assert.match(built.text, /created_at >= \$/);
});

test("nextCursor points past the last row, and ends cleanly", () => {
  const rows = [{ created_at: 9, id: "aa" }, { created_at: 8, id: "bb" }];
  const encoded = nextCursor(rows, 2);
  assert.deepEqual(decodeCursor(encoded), { until: 8, afterId: "bb" });
  assert.equal(nextCursor(rows, 3), null, "a short page means no more rows");
});

test("loadExclusions reads pubkeys, skips comments, tolerates a missing file", () => {
  const dir = mkdtempSync(join(tmpdir(), "gw-"));
  const file = join(dir, "metering-excluded.txt");
  writeFileSync(file, "# opted out\n" + "ab".repeat(32) + "\n\n# comment\n" + "CD".repeat(32) + "\n");
  const set = loadExclusions(file);
  assert.equal(set.size, 2);
  assert.ok(set.has("ab".repeat(32)));
  assert.ok(set.has("cd".repeat(32)), "pubkeys are lowercased");
  assert.equal(loadExclusions(join(dir, "missing.txt")).size, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @netizen-labs/gateway test`
Expected: FAIL — modules missing.

- [ ] **Step 3: Implement bulk.ts and exclusions.ts**

`src/bulk.ts`:

```ts
import type { EventQuery } from "@netizen-labs/indexer";

/**
 * The paid twin of the indexer's /events: same filter grammar, 50× the limit,
 * keyset pagination. Deliberately its own SQL builder — the indexer's is
 * hard-capped at MAX_LIMIT=200 as a free-tier guarantee, and weakening that
 * cap for reuse would be exactly the wrong trade.
 */
export const BULK_MAX_LIMIT = 10000;
const DEFAULT_BULK_LIMIT = 1000;

export interface BulkCursor {
  until: number;
  afterId: string;
}

export function encodeCursor(c: BulkCursor): string {
  return Buffer.from(JSON.stringify(c)).toString("base64url");
}

export function decodeCursor(s: string | null): BulkCursor | null {
  if (!s) return null;
  try {
    const parsed = JSON.parse(Buffer.from(s, "base64url").toString("utf8")) as BulkCursor;
    if (typeof parsed.until !== "number" || typeof parsed.afterId !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function buildBulkQuery(
  query: EventQuery,
  cursor: BulkCursor | null,
  excluded: ReadonlySet<string>,
): { text: string; values: unknown[] } {
  const where: string[] = [];
  const values: unknown[] = [];
  const bind = (v: unknown) => `$${values.push(v)}`;

  if (query.q?.trim()) {
    where.push(`to_tsvector('simple', content) @@ plainto_tsquery('simple', ${bind(query.q.trim())})`);
  }
  if (query.kinds?.length) where.push(`kind = ANY(${bind(query.kinds)}::int[])`);
  if (query.authors?.length) {
    where.push(`pubkey = ANY(${bind(query.authors.map((a) => a.toLowerCase()))}::text[])`);
  }
  if (typeof query.since === "number") where.push(`created_at >= ${bind(query.since)}`);
  if (typeof query.until === "number") where.push(`created_at <= ${bind(query.until)}`);
  if (query.node) where.push(`node_id = ${bind(query.node)}`);
  if (excluded.size) {
    // The monetization opt-out: excluded authors never appear in a paid response.
    where.push(`pubkey != ALL(${bind([...excluded])}::text[])`);
  }
  if (cursor) {
    where.push(`(created_at < ${bind(cursor.until)} OR (created_at = $${values.length} AND id > ${bind(cursor.afterId)}))`);
  }

  const limit = Math.min(Math.max(1, query.limit ?? DEFAULT_BULK_LIMIT), BULK_MAX_LIMIT);

  return {
    text: `SELECT id, pubkey, kind, created_at, content, tags, sig, node_id, source
           FROM nostr_events
           ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
           ORDER BY created_at DESC, id ASC
           LIMIT ${bind(limit)}`.replace(/\s+/g, " "),
    values,
  };
}

/** A full page means "probably more" — hand back where to resume. */
export function nextCursor(rows: Array<{ created_at: number; id: string }>, limit: number): string | null {
  if (rows.length < limit) return null;
  const last = rows[rows.length - 1];
  return encodeCursor({ until: last.created_at, afterId: last.id });
}
```

**Note on the keyset clause:** `created_at = $n` must reference the SAME placeholder as the `until` bind. In the implementation above `bind(cursor.until)` pushes the value and the follow-up `$${values.length}` refers to it — verify the emitted SQL in the test (the test regex checks both fragments; also eyeball one emitted string during review).

`src/exclusions.ts`:

```ts
import { readFileSync } from "node:fs";

/**
 * The "do not monetize me" list — one hex pubkey per line, '#' comments.
 * Lives beside the relay's write allow-list (same directory-mount rules).
 * A missing file is an empty list, never an error: the free record does not
 * depend on the paid tier's configuration.
 */
export function loadExclusions(path: string): Set<string> {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return new Set();
  }
  const set = new Set<string>();
  for (const line of raw.split("\n")) {
    const value = line.trim().toLowerCase();
    if (!value || value.startsWith("#")) continue;
    if (/^[0-9a-f]{64}$/.test(value)) set.add(value);
  }
  return set;
}
```

Append to `src/index.ts`:

```ts
export { BULK_MAX_LIMIT, buildBulkQuery, decodeCursor, encodeCursor, nextCursor, type BulkCursor } from "./bulk.js";
export { loadExclusions } from "./exclusions.js";
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @netizen-labs/gateway test && pnpm --filter @netizen-labs/gateway typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/gateway/src/bulk.ts packages/gateway/src/exclusions.ts packages/gateway/src/index.ts packages/gateway/test/bulk.test.ts
git commit -m "feat(gateway): bulk keyset query + monetization exclusion list" -- packages/gateway/src packages/gateway/test
git push
```

---

### Task 7: Gateway — export stream + firehose passes

**Files:**
- Create: `packages/gateway/src/exportStream.ts`, `packages/gateway/src/firehose.ts`
- Modify: `packages/gateway/src/index.ts`
- Test: `packages/gateway/test/streams.test.ts`

**Interfaces:**
- Produces (consumed by Task 8):

```ts
// exportStream.ts
export function buildExportBatchQuery(kinds: number[] | undefined, cursor: BulkCursor | null, excluded: ReadonlySet<string>, batchSize?: number): { text: string; values: unknown[] };  // batchSize default 5000
export async function streamExport(deps: {
  query: (sql: string, values: unknown[]) => Promise<Record<string, unknown>[]>;
  write: (line: string) => void;             // one NDJSON line, no trailing \n needed from caller
  kinds?: number[]; excluded: ReadonlySet<string>;
}): Promise<Map<string, number>>;            // author counts for the serving log
// firehose.ts
export function mintPassSql(token: string, ledgerId: number, hoursValid: number): { text: string; values: unknown[] };
export function passLookupSql(token: string): { text: string; values: unknown[] };  // SELECT ledger_id, expires_at
export function firehoseBatchQuery(sinceIndexedAt: string, excluded: ReadonlySet<string>): { text: string; values: unknown[] };
```

- [ ] **Step 1: Write the failing test**

```ts
// packages/gateway/test/streams.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildExportBatchQuery, streamExport } from "../src/exportStream.js";
import { firehoseBatchQuery, mintPassSql, passLookupSql } from "../src/firehose.js";

test("export batches use keyset pagination and honour exclusions", () => {
  const built = buildExportBatchQuery([1], { until: 10, afterId: "aa" }, new Set(["ff".repeat(32)]));
  assert.match(built.text, /kind = ANY/);
  assert.match(built.text, /pubkey != ALL/);
  assert.match(built.text, /created_at < \$/);
});

test("streamExport walks every batch, writes NDJSON, returns author counts", async () => {
  const pages: Record<string, unknown>[][] = [
    [
      { id: "a1", pubkey: "p1", kind: 1, created_at: 9, content: "x", tags: [], sig: "s", node_id: "n", source: "r" },
      { id: "a2", pubkey: "p2", kind: 1, created_at: 8, content: "y", tags: [], sig: "s", node_id: "n", source: "r" },
    ],
    [],
  ];
  // The fake returns a FULL batch only if the page has batchSize rows — emulate
  // by passing batchSize implicitly: page 1 shorter than 5000 ends the loop.
  const lines: string[] = [];
  const counts = await streamExport({
    query: async () => pages.shift() ?? [],
    write: (line) => lines.push(line),
    excluded: new Set(),
  });
  assert.equal(lines.length, 2);
  assert.equal(JSON.parse(lines[0]).id, "a1");
  assert.deepEqual([counts.get("p1"), counts.get("p2")], [1, 1]);
});

test("pass SQL: mint inserts token with expiry, lookup selects it", () => {
  const mint = mintPassSql("tok", 3, 24);
  assert.match(mint.text, /INSERT INTO firehose_passes/);
  assert.deepEqual(mint.values, ["tok", 3, 24]);
  const lookup = passLookupSql("tok");
  assert.match(lookup.text, /expires_at > now\(\)/);
});

test("firehose batch filters on indexed_at watermark and exclusions", () => {
  const built = firehoseBatchQuery("2026-08-05T00:00:00Z", new Set(["aa".repeat(32)]));
  assert.match(built.text, /indexed_at > \$/);
  assert.match(built.text, /pubkey != ALL/);
  assert.match(built.text, /ORDER BY indexed_at ASC/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @netizen-labs/gateway test`
Expected: FAIL — modules missing.

- [ ] **Step 3: Implement exportStream.ts and firehose.ts**

`src/exportStream.ts`:

```ts
import { countByAuthor } from "./ledger.js";
import { type BulkCursor } from "./bulk.js";

const EXPORT_BATCH = 5000;

/** One export batch: everything, oldest-truncated only by the keyset walk. */
export function buildExportBatchQuery(
  kinds: number[] | undefined,
  cursor: BulkCursor | null,
  excluded: ReadonlySet<string>,
  batchSize = EXPORT_BATCH,
): { text: string; values: unknown[] } {
  const where: string[] = [];
  const values: unknown[] = [];
  const bind = (v: unknown) => `$${values.push(v)}`;
  if (kinds?.length) where.push(`kind = ANY(${bind(kinds)}::int[])`);
  if (excluded.size) where.push(`pubkey != ALL(${bind([...excluded])}::text[])`);
  if (cursor) {
    where.push(`(created_at < ${bind(cursor.until)} OR (created_at = $${values.length} AND id > ${bind(cursor.afterId)}))`);
  }
  return {
    text: `SELECT id, pubkey, kind, created_at, content, tags, sig, node_id, source
           FROM nostr_events
           ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
           ORDER BY created_at DESC, id ASC
           LIMIT ${bind(batchSize)}`.replace(/\s+/g, " "),
    values,
  };
}

/**
 * Stream the full record as NDJSON in keyset batches. Returns per-author
 * counts so the caller can write the serving log after the stream ends.
 */
export async function streamExport(deps: {
  query: (sql: string, values: unknown[]) => Promise<Record<string, unknown>[]>;
  write: (line: string) => void;
  kinds?: number[];
  excluded: ReadonlySet<string>;
}): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  let cursor: BulkCursor | null = null;
  for (;;) {
    const built = buildExportBatchQuery(deps.kinds, cursor, deps.excluded);
    const rows = await deps.query(built.text, built.values);
    for (const row of rows) {
      deps.write(JSON.stringify(row));
      const author = String(row.pubkey);
      counts.set(author, (counts.get(author) ?? 0) + 1);
    }
    if (rows.length < EXPORT_BATCH) return counts;
    const last = rows[rows.length - 1];
    cursor = { until: Number(last.created_at), afterId: String(last.id) };
  }
}

export { countByAuthor };
```

`src/firehose.ts`:

```ts
/**
 * Firehose passes: one payment mints a token; the SSE socket checks it on
 * connect. Tokens are capability-style random strings — no account behind
 * them, exactly as frictionless as the payment that bought them.
 */
export function mintPassSql(token: string, ledgerId: number, hoursValid: number): { text: string; values: unknown[] } {
  return {
    text: `INSERT INTO firehose_passes (token, ledger_id, expires_at)
           VALUES ($1, $2, now() + make_interval(hours => $3))`.replace(/\s+/g, " "),
    values: [token, ledgerId, hoursValid],
  };
}

export function passLookupSql(token: string): { text: string; values: unknown[] } {
  return {
    text: `SELECT ledger_id, expires_at FROM firehose_passes WHERE token = $1 AND expires_at > now()`,
    values: [token],
  };
}

/** New rows since the watermark, in arrival order — indexed_at, not created_at,
 *  because a peer can sync in old events and the firehose promise is "everything
 *  NEW TO THIS INDEX", not "everything recently authored". */
export function firehoseBatchQuery(
  sinceIndexedAt: string,
  excluded: ReadonlySet<string>,
): { text: string; values: unknown[] } {
  const values: unknown[] = [sinceIndexedAt];
  let exclusionClause = "";
  if (excluded.size) {
    values.push([...excluded]);
    exclusionClause = ` AND pubkey != ALL($2::text[])`;
  }
  return {
    text: `SELECT id, pubkey, kind, created_at, content, tags, sig, node_id, source, indexed_at
           FROM nostr_events WHERE indexed_at > $1${exclusionClause}
           ORDER BY indexed_at ASC LIMIT 500`.replace(/\s+/g, " "),
    values,
  };
}
```

Append to `src/index.ts`:

```ts
export { buildExportBatchQuery, streamExport } from "./exportStream.js";
export { firehoseBatchQuery, mintPassSql, passLookupSql } from "./firehose.js";
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @netizen-labs/gateway test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/gateway/src/exportStream.ts packages/gateway/src/firehose.ts packages/gateway/src/index.ts packages/gateway/test/streams.test.ts
git commit -m "feat(gateway): NDJSON export stream + firehose pass machinery" -- packages/gateway/src packages/gateway/test
git push
```

---

### Task 8: Gateway — server assembly, /pay page, /metering/stats, CLI, build

**Files:**
- Create: `packages/gateway/src/server.ts`, `packages/gateway/src/pay.ts`, `packages/gateway/src/cli.ts`
- Modify: `packages/gateway/src/index.ts`
- Test: `packages/gateway/test/server.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: `createGatewayServer(deps: GatewayDeps): http.Server` where

```ts
export interface GatewayDeps {
  cfg: MeteringConfig;
  query: (sql: string, values: unknown[]) => Promise<Record<string, unknown>[]>;
  facilitator: Pick<FacilitatorClient, "verify" | "settle">;
  excluded: () => ReadonlySet<string>;       // re-read by the cli on an interval
  mintToken?: () => string;                  // injectable for tests; default crypto randomBytes(16) hex
}
```

Routes: `GET /bulk/events`, `GET /export`, `GET /firehose`, `GET /pay`, `GET /metering/stats`, `GET /health`; 404 otherwise.

- [ ] **Step 1: Write the failing test**

```ts
// packages/gateway/test/server.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createGatewayServer, type GatewayDeps } from "../src/server.js";
import { configFromEnv } from "../src/config.js";
import type { PaymentPayload } from "@netizen-labs/facilitator";

const cfg = configFromEnv({
  NODE_ID: "roebel", PUBLIC_BASE: "https://index.roebel.app", DATABASE_URL: "x",
  FACILITATOR_URL: "http://fac", PAY_TO: "0x3A08c86Efc5ff38CC35d850F1D4d564e497bFDEa",
  NETWORK: "eip155:100", ASSET: "0x2a22f9c3b484C3629090FeED35F17Ff8F88f76F0",
  ASSET_NAME: "Bridged USDC (Gnosis)", ASSET_VERSION: "2", ASSET_DECIMALS: "6",
  PRICE_BULK: "500000", PRICE_EXPORT: "5000000", PRICE_FIREHOSE_DAY: "1000000",
  SPLIT_AUTHORS: "50",
} as NodeJS.ProcessEnv);

const PAYMENT: PaymentPayload = {
  x402Version: 1, scheme: "exact", network: "eip155:100",
  payload: {
    signature: "0x00" as `0x${string}`,
    authorization: {
      from: "0x0000000000000000000000000000000000000001",
      to: cfg.payTo, value: "500000", validAfter: "0", validBefore: "9999999999",
      nonce: ("0x" + "00".repeat(32)) as `0x${string}`,
    },
  },
};
const HEADER = Buffer.from(JSON.stringify(PAYMENT)).toString("base64");

function deps(overrides: Partial<GatewayDeps> = {}): GatewayDeps & { sql: string[] } {
  const sql: string[] = [];
  return {
    sql,
    cfg,
    query: async (text: string) => {
      sql.push(text);
      if (/INSERT INTO access_ledger/.test(text)) return [{ id: 1 }];
      if (/FROM nostr_events/.test(text)) {
        return [{ id: "e1", pubkey: "p1", kind: 1, created_at: 9, content: "c", tags: [], sig: "s", node_id: "n", source: "r" }];
      }
      if (/COUNT\(\*\)::int AS requests, COALESCE/.test(text)) return [{ requests: 0, revenue_atomic: "0" }];
      return [];
    },
    facilitator: {
      verify: async () => ({ isValid: true, payer: "0x0000000000000000000000000000000000000001" }),
      settle: async () => ({ success: true, transaction: "0xdead" as `0x${string}`, network: "eip155:100" }),
    },
    excluded: () => new Set<string>(),
    mintToken: () => "PASSTOKEN",
    ...overrides,
  };
}

async function withServer(d: GatewayDeps, run: (base: string) => Promise<void>) {
  const server = createGatewayServer(d);
  await new Promise<void>((r) => server.listen(0, r));
  try {
    await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } finally {
    server.close();
  }
}

test("an unpaid bulk request gets a self-describing 402", async () => {
  await withServer(deps(), async (base) => {
    const res = await fetch(`${base}/bulk/events?kinds=1`);
    assert.equal(res.status, 402);
    assert.equal(res.headers.get("cache-control"), "no-store");
    const body = await res.json();
    assert.equal(body.x402Version, 1);
    assert.equal(body.accepts[0].maxAmountRequired, "500000");
    assert.equal(body.payLink, "https://index.roebel.app/pay");
  });
});

test("a paid bulk request serves events, records ledger + serving, sets X-PAYMENT-RESPONSE", async () => {
  const d = deps();
  await withServer(d, async (base) => {
    const res = await fetch(`${base}/bulk/events?kinds=1`, { headers: { "X-PAYMENT": HEADER } });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.events.length, 1);
    assert.ok(res.headers.get("x-payment-response"));
    assert.ok(d.sql.some((s) => /INSERT INTO access_ledger/.test(s)));
    assert.ok(d.sql.some((s) => /INSERT INTO serving_log/.test(s)));
  });
});

test("a failed verification is a 402 with the reason", async () => {
  const d = deps({
    facilitator: {
      verify: async () => ({ isValid: false, invalidReason: "nonce_used" }),
      settle: async () => { throw new Error("must not settle"); },
    },
  });
  await withServer(d, async (base) => {
    const res = await fetch(`${base}/bulk/events`, { headers: { "X-PAYMENT": HEADER } });
    assert.equal(res.status, 402);
    assert.match((await res.json()).error, /nonce_used/);
  });
});

test("a settle revert is a 402; a network error serves with reconcile", async () => {
  const reverted = deps({
    facilitator: {
      verify: async () => ({ isValid: true, payer: "0x01" as `0x${string}` }),
      settle: async () => ({ success: false, errorReason: "settle_reverted", network: "eip155:100" }),
    },
  });
  await withServer(reverted, async (base) => {
    const res = await fetch(`${base}/bulk/events`, { headers: { "X-PAYMENT": HEADER } });
    assert.equal(res.status, 402);
  });
  const flaky = deps({
    facilitator: {
      verify: async () => ({ isValid: true, payer: "0x01" as `0x${string}` }),
      settle: async () => ({ success: false, errorReason: "network_error", network: "eip155:100" }),
    },
  });
  await withServer(flaky, async (base) => {
    const res = await fetch(`${base}/bulk/events`, { headers: { "X-PAYMENT": HEADER } });
    assert.equal(res.status, 200, "spec §8: bounded risk — serve and reconcile");
    assert.ok(flaky.sql.some((s) => /INSERT INTO access_ledger/.test(s)));
  });
});

test("a paid firehose request mints a pass", async () => {
  const d = deps();
  await withServer(d, async (base) => {
    const res = await fetch(`${base}/firehose`, { headers: { "X-PAYMENT": HEADER } });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.pass, "PASSTOKEN");
    assert.match(body.connect, /\/firehose\?pass=PASSTOKEN/);
    assert.ok(d.sql.some((s) => /INSERT INTO firehose_passes/.test(s)));
  });
});

test("/pay is human-readable and shows formatted prices", async () => {
  await withServer(deps(), async (base) => {
    const res = await fetch(`${base}/pay`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /0\.50/);
    assert.match(html, /USDC\.e|Bridged USDC/);
    assert.match(html, /X-PAYMENT/);
  });
});

test("/metering/stats returns totals and split", async () => {
  await withServer(deps(), async (base) => {
    const res = await fetch(`${base}/metering/stats`);
    const body = await res.json();
    assert.equal(body.split.authors, 50);
    assert.equal(body.totals.requests, 0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @netizen-labs/gateway test`
Expected: FAIL — `../src/server.js` missing.

- [ ] **Step 3: Implement server.ts, pay.ts, cli.ts**

`src/pay.ts` — export `payPageHtml(cfg: MeteringConfig): string` returning a page styled like the indexer root (dark `#111`, accent `#7ABBF2`, mono font), containing: what is free (link `/events`, `/stats`), the three paid endpoints with `formatAtomic` prices and the asset name, a 4-step "how agents pay" (GET → 402 `accepts` → sign EIP-3009 `TransferWithAuthorization` typed data → retry with base64 `X-PAYMENT`), a note that revenue splits `cfg.splitAuthors`% to the data's authors / rest to the community treasury with a link to `/metering/stats`, and a `curl` example. No raw wallet addresses of people anywhere (the treasury `payTo` MAY appear — it is an institution).

`src/server.ts` (structure; the paywall helper is the heart):

```ts
import { createServer, type Server } from "node:http";
import { randomBytes } from "node:crypto";
import { queryFromUrl } from "@netizen-labs/indexer";
import type { PaymentRequirements, SettleResult } from "@netizen-labs/facilitator";
import type { MeteringConfig } from "./config.js";
import { body402, encodePaymentResponse, parsePayment, requirementsFor, type FacilitatorClient } from "./x402.js";
import { buildBulkQuery, decodeCursor, nextCursor, BULK_MAX_LIMIT } from "./bulk.js";
import { streamExport } from "./exportStream.js";
import { firehoseBatchQuery, mintPassSql, passLookupSql } from "./firehose.js";
import {
  STATS_ENDPOINTS_SQL, STATS_TOTALS_SQL, TOP_ACCRUALS_SQL,
  countByAuthor, insertLedgerSql, insertServingSql,
} from "./ledger.js";
import { payPageHtml } from "./pay.js";

export interface GatewayDeps {
  cfg: MeteringConfig;
  query: (sql: string, values: unknown[]) => Promise<Record<string, unknown>[]>;
  facilitator: Pick<FacilitatorClient, "verify" | "settle">;
  excluded: () => ReadonlySet<string>;
  mintToken?: () => string;
}

interface Paid { payer: string; settle: SettleResult; requirements: PaymentRequirements; nonce: string }

export function createGatewayServer(deps: GatewayDeps): Server {
  const { cfg } = deps;
  const mint = deps.mintToken ?? (() => randomBytes(16).toString("hex"));

  return createServer(async (req, res) => {
    const json = (status: number, body: unknown, headers: Record<string, string> = {}) => {
      res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-store",
        ...headers,
      });
      res.end(JSON.stringify(body));
    };

    /**
     * The x402 handshake. Returns payment context, or null after answering
     * the request itself (402). Fail-closed on verification; a settle
     * network_error serves anyway and marks the ledger row for
     * reconciliation (spec §8 — bounded, cent-scale risk).
     */
    const paywall = async (path: string, price: string, description: string): Promise<Paid | null> => {
      const requirements = requirementsFor(cfg, path, price, description);
      const header = req.headers["x-payment"];
      if (typeof header !== "string") {
        json(402, body402(cfg, path, price, description));
        return null;
      }
      const payment = parsePayment(header);
      if (!payment) {
        json(402, body402(cfg, path, price, description, "malformed X-PAYMENT header"));
        return null;
      }
      const verdict = await deps.facilitator.verify(payment, requirements);
      if (!verdict.isValid) {
        json(402, body402(cfg, path, price, description, `payment invalid: ${verdict.invalidReason}`));
        return null;
      }
      const settle = await deps.facilitator.settle(payment, requirements);
      if (!settle.success && settle.errorReason !== "network_error") {
        json(402, body402(cfg, path, price, description, "settlement reverted — payment not accepted"));
        return null;
      }
      if (!settle.success) console.error(`[gateway] RECONCILE: settle network_error for ${path}, payer ${verdict.payer}`);
      return { payer: verdict.payer ?? payment.payload.authorization.from, settle, requirements, nonce: payment.payload.authorization.nonce };
    };

    const recordSale = async (endpoint: string, paid: Paid, price: string, counts: Map<string, number>): Promise<number> => {
      const ledger = insertLedgerSql({
        endpoint, payer: paid.payer, amount: price, asset: cfg.asset, network: cfg.network,
        splitAuthors: cfg.splitAuthors, tx: paid.settle.transaction ?? null, nonce: paid.nonce,
        reconcile: !paid.settle.success,
      });
      const [row] = await deps.query(ledger.text, ledger.values);
      const id = Number(row.id);
      const serving = insertServingSql(id, counts);
      if (serving) await deps.query(serving.text, serving.values);
      return id;
    };

    try {
      const url = new URL(req.url ?? "/", "http://localhost");

      if (url.pathname === "/health") return json(200, { ok: true, node: cfg.nodeId });

      if (url.pathname === "/bulk/events") {
        const paid = await paywall("/bulk/events", cfg.prices.bulk, `bulk event query, up to ${BULK_MAX_LIMIT} events`);
        if (!paid) return;
        const query = queryFromUrl(url);
        const cursor = decodeCursor(url.searchParams.get("cursor"));
        const built = buildBulkQuery(query, cursor, deps.excluded());
        const rows = (await deps.query(built.text, built.values)) as Array<Record<string, unknown> & { pubkey: string; created_at: number; id: string }>;
        await recordSale("/bulk/events", paid, cfg.prices.bulk, countByAuthor(rows));
        const limit = Math.min(Math.max(1, query.limit ?? 1000), BULK_MAX_LIMIT);
        return json(200, { node: cfg.nodeId, count: rows.length, nextCursor: nextCursor(rows, limit), events: rows },
          { "X-PAYMENT-RESPONSE": encodePaymentResponse(paid.settle) });
      }

      if (url.pathname === "/export") {
        const paid = await paywall("/export", cfg.prices.export, "full-history NDJSON export");
        if (!paid) return;
        const kinds = url.searchParams.get("kinds")?.split(",").map(Number).filter(Number.isFinite);
        res.writeHead(200, {
          "Content-Type": "application/x-ndjson; charset=utf-8",
          "Access-Control-Allow-Origin": "*",
          "X-PAYMENT-RESPONSE": encodePaymentResponse(paid.settle),
        });
        const counts = await streamExport({
          query: deps.query,
          write: (line) => res.write(line + "\n"),
          kinds, excluded: deps.excluded(),
        });
        res.end();
        await recordSale("/export", paid, cfg.prices.export, counts);
        return;
      }

      if (url.pathname === "/firehose") {
        const pass = url.searchParams.get("pass");
        if (!pass) {
          const paid = await paywall("/firehose", cfg.prices.firehoseDay, "24h firehose pass (SSE)");
          if (!paid) return;
          const ledgerId = await recordSale("/firehose", paid, cfg.prices.firehoseDay, new Map());
          const token = mint();
          const minted = mintPassSql(token, ledgerId, 24);
          await deps.query(minted.text, minted.values);
          return json(200, { pass: token, connect: `${cfg.publicBase}/firehose?pass=${token}` },
            { "X-PAYMENT-RESPONSE": encodePaymentResponse(paid.settle) });
        }
        const lookup = passLookupSql(pass);
        const found = await deps.query(lookup.text, lookup.values);
        if (!found.length) return json(401, { error: "invalid or expired pass — buy a new one at /firehose" });
        const ledgerId = Number(found[0].ledger_id);
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-store",
          "Access-Control-Allow-Origin": "*",
          Connection: "keep-alive",
        });
        let watermark = new Date().toISOString();
        let open = true;
        req.on("close", () => { open = false; });
        while (open) {
          const batch = firehoseBatchQuery(watermark, deps.excluded());
          const rows = (await deps.query(batch.text, batch.values)) as Array<Record<string, unknown> & { pubkey: string; indexed_at: string }>;
          if (rows.length) {
            for (const row of rows) {
              const { indexed_at: _drop, ...event } = row;
              res.write(`data: ${JSON.stringify(event)}\n\n`);
            }
            watermark = String(rows[rows.length - 1].indexed_at);
            const serving = insertServingSql(ledgerId, countByAuthor(rows));
            if (serving) await deps.query(serving.text, serving.values);
          } else {
            res.write(": keepalive\n\n");
          }
          await new Promise((r) => setTimeout(r, 5000));
        }
        return;
      }

      if (url.pathname === "/pay") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=300" });
        res.end(payPageHtml(cfg));
        return;
      }

      if (url.pathname === "/metering/stats") {
        const [totals] = await deps.query(STATS_TOTALS_SQL, []);
        const endpoints = await deps.query(STATS_ENDPOINTS_SQL, []);
        const accruals = await deps.query(TOP_ACCRUALS_SQL, []);
        return json(200, {
          node: cfg.nodeId,
          asset: { address: cfg.asset, name: cfg.assetName, decimals: cfg.assetDecimals, network: cfg.network },
          split: { authors: cfg.splitAuthors, treasury: 100 - cfg.splitAuthors },
          totals: { requests: Number(totals?.requests ?? 0), revenueAtomic: String(totals?.revenue_atomic ?? "0") },
          byEndpoint: endpoints,
          // Authors are hex pubkeys — display-name resolution is slice 2.
          topAccruals: accruals,
        }, { "Cache-Control": "public, max-age=60" });
      }

      json(404, { error: "not found", endpoints: ["/bulk/events", "/export", "/firehose", "/pay", "/metering/stats"] });
    } catch (error) {
      console.error("[gateway] request failed:", error);
      json(500, { error: "request failed" });
    }
  });
}
```

`src/cli.ts`:

```ts
#!/usr/bin/env node
import pg from "pg";
import { configFromEnv } from "./config.js";
import { FacilitatorClient } from "./x402.js";
import { loadExclusions } from "./exclusions.js";
import { LEDGER_SCHEMA_SQL } from "./ledger.js";
import { createGatewayServer } from "./server.js";

async function main(): Promise<void> {
  const cfg = configFromEnv(process.env);
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 8 });
  await pool.query(LEDGER_SCHEMA_SQL);

  let excluded = cfg.excludedFile ? loadExclusions(cfg.excludedFile) : new Set<string>();
  if (cfg.excludedFile) {
    setInterval(() => {
      excluded = loadExclusions(cfg.excludedFile!);
    }, 60_000);
  }

  createGatewayServer({
    cfg,
    query: async (sql, values) => (await pool.query(sql, values)).rows,
    facilitator: new FacilitatorClient(cfg.facilitatorUrl),
    excluded: () => excluded,
  }).listen(cfg.port, () => {
    console.log(`gateway for "${cfg.nodeId}" listening on :${cfg.port}; facilitator ${cfg.facilitatorUrl}`);
    console.log(`  prices bulk=${cfg.prices.bulk} export=${cfg.prices.export} firehoseDay=${cfg.prices.firehoseDay} (atomic, ${cfg.assetName})`);
  });
}

void main().catch((error) => {
  console.error("gateway failed to start:", error);
  process.exit(1);
});
```

Append to `src/index.ts`:

```ts
export { createGatewayServer, type GatewayDeps } from "./server.js";
export { payPageHtml } from "./pay.js";
```

- [ ] **Step 4: Run tests + typecheck + build**

Run: `pnpm --filter @netizen-labs/gateway test && pnpm --filter @netizen-labs/gateway typecheck && pnpm --filter @netizen-labs/gateway build`
Expected: PASS; `dist/gateway.cjs` exists.

- [ ] **Step 5: Commit**

```bash
git add packages/gateway/src packages/gateway/test
git commit -m "feat(gateway): paid endpoint server — 402 paywall, bulk/export/firehose, /pay, stats" -- packages/gateway/src packages/gateway/test
git push
```

---

### Task 9: Render — compose services, Caddy routing, secrets, policy file, artifact copy

**Files:**
- Modify: `packages/cli/src/render.ts` (renderCaddyfile ~line 394; renderComposeYml after the indexer block ~line 614; renderBundle ~line 2133; the secrets checklist renderer — locate `renderSecretsChecklist`)
- Modify: `packages/cli/src/cli.ts` (artifact copies, ~line 24–26)
- Test: `packages/cli/test/metering.test.ts` (create)

**Interfaces:**
- Consumes: `m.services.metering` (Task 1), `dist/gateway.cjs` + `dist/facilitator.cjs` (Tasks 3/8).
- Produces: compose services named exactly `gateway:` and `facilitator:` (the artifact-copy markers), Caddy `handle` routing, bundle file `strfry-policy/metering-excluded.txt`, SECRETS.md entry `METERING_SETTLER_PRIV`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/cli/test/metering.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderBundle, renderCaddyfile, renderComposeYml } from "../src/render.js";
import { parseManifest } from "@netizen-labs/protocol";

const base = parseManifest(JSON.parse(
  readFileSync(fileURLToPath(new URL("../../protocol/examples/roebel.netizen.json", import.meta.url)), "utf8"),
));

// The example declares metering; the "without" case is constructed by removal.
const without = structuredClone(base) as typeof base;
delete (without.services as Record<string, unknown>).metering;

test("compose gains gateway and facilitator services when metering is declared", () => {
  const compose = renderComposeYml(base);
  assert.match(compose, /^ {2}gateway:/m);
  assert.match(compose, /^ {2}facilitator:/m);
  assert.match(compose, /METERING_SETTLER_PRIV/);
  assert.match(compose, /FACILITATOR_URL: "http:\/\/facilitator:8402"/);
  assert.match(compose, /PAY_TO: "0x3A08c86Efc5ff38CC35d850F1D4d564e497bFDEa"/);
  const off = renderComposeYml(without);
  assert.ok(!/^ {2}gateway:/m.test(off));
  assert.ok(!/^ {2}facilitator:/m.test(off));
});

test("the index host path-routes paid endpoints to the gateway, rest to the indexer", () => {
  const caddy = renderCaddyfile(base);
  assert.match(caddy, /handle \/bulk\/\* \{\s*reverse_proxy gateway:8402/);
  assert.match(caddy, /handle \/pay\* \{\s*reverse_proxy gateway:8402/);
  // the catch-all must exist AND come after the paid handles
  const block = caddy.slice(caddy.indexOf("index.roebel.app"));
  assert.ok(block.indexOf("handle {") > block.indexOf("handle /bulk/*"), "catch-all after paid routes");
  // without metering the old single-line route survives
  assert.match(renderCaddyfile(without), /index\.roebel\.app \{\s*reverse_proxy indexer:8080\s*\}/);
});

test("the bundle ships the monetization opt-out file", () => {
  const bundle = renderBundle(base);
  const file = bundle.files["strfry-policy/metering-excluded.txt"];
  assert.ok(file, "metering-excluded.txt must be in the bundle");
  assert.match(file, /^#/m, "starts with an explanatory comment");
  assert.equal(bundle.files["strfry-policy/metering-excluded.txt"] === undefined, false);
  const off = renderBundle(without);
  assert.equal(off.files["strfry-policy/metering-excluded.txt"], undefined);
});

test("SECRETS.md lists the settler key when metering is declared", () => {
  const bundle = renderBundle(base);
  assert.match(bundle.files["SECRETS.md"], /METERING_SETTLER_PRIV/);
  const off = renderBundle(without);
  assert.ok(!/METERING_SETTLER_PRIV/.test(off.files["SECRETS.md"]));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter netizen test`
Expected: metering.test.ts FAILS (no gateway service, no handle blocks); all existing tests still pass.

- [ ] **Step 3: Implement in render.ts**

**Caddy** — replace the current index route line (`render.ts:442-443`) with:

```ts
  // The index is public by design ... (keep the existing comment)
  const indexUrl = m.services.indexer?.publicRead;
  if (indexUrl && m.services.metering) {
    // Metering wraps the free API rather than replacing it: paid paths go to
    // the gateway, everything else stays exactly the free indexer. `handle`
    // blocks are order-sensitive — the catch-all MUST come last (same lesson
    // as the Collabora block above).
    blocks.push(`${hostname(indexUrl)} {
  handle /bulk/* {
    reverse_proxy gateway:8402
  }
  handle /export* {
    reverse_proxy gateway:8402
  }
  handle /firehose* {
    reverse_proxy gateway:8402
  }
  handle /pay* {
    reverse_proxy gateway:8402
  }
  handle /metering/* {
    reverse_proxy gateway:8402
  }
  handle {
    reverse_proxy indexer:8080
  }
}`);
  } else if (indexUrl) {
    blocks.push(`${hostname(indexUrl)} {\n  reverse_proxy indexer:8080\n}`);
  }
```

**Compose** — in `renderComposeYml`, directly after the indexer service block (after its closing backtick + `);` around line 614), add:

```ts
    // Metered machine-scale access (x402): the facilitator verifies + settles
    // EIP-3009 payments on this node's own chain; the gateway serves the paid
    // endpoints and shares the indexer's database (the ledger lives beside the
    // index it meters). Secrets: only the settler's gas key — it cannot
    // redirect funds, the payer's signature fixes payTo.
    if (m.services.metering && m.services.indexer && m.services.backend && m.chain) {
      const met = m.services.metering;
      const rpc = typeof m.chain.rpc === "string" && m.chain.rpc.startsWith("$")
        ? `\${${m.chain.rpc.slice(1)}}`
        : String(m.chain.rpc);
      svc.push(
        `  facilitator:
    image: node:22-alpine
    restart: unless-stopped
    command: ["node", "/app/facilitator.cjs"]
    volumes:
      - "./facilitator/facilitator.cjs:/app/facilitator.cjs:ro"
    environment:
      NETWORK: "${met.network}"
      RPC_URL: "${rpc}"
      # Gas-only key. It submits payer-signed authorizations; value moves
      # payer->treasury regardless of who submits.
      SETTLER_PRIV: "\${METERING_SETTLER_PRIV}"
      PORT: "8402"
    expose: ["8402"]`,
        `  gateway:
    image: node:22-alpine
    restart: unless-stopped
    command: ["node", "/app/gateway.cjs"]
    volumes:
      - "./gateway/gateway.cjs:/app/gateway.cjs:ro"
      - "./strfry-policy:/etc/strfry:ro"
    environment:
      NODE_ID: "${m.id}"
      PUBLIC_BASE: "${m.services.indexer.publicRead ?? ""}"
      DATABASE_URL: "postgres://indexer:\${POSTGRES_PASSWORD}@postgres:5432/indexer"
      FACILITATOR_URL: "http://facilitator:8402"
      PAY_TO: "${met.payTo}"
      NETWORK: "${met.network}"
      ASSET: "${met.asset}"
      ASSET_NAME: ${JSON.stringify(met.assetName)}
      ASSET_VERSION: "${met.assetVersion}"
      ASSET_DECIMALS: "${met.assetDecimals}"
      PRICE_BULK: "${met.prices.bulk}"
      PRICE_EXPORT: "${met.prices.export}"
      PRICE_FIREHOSE_DAY: "${met.prices.firehoseDay}"
      SPLIT_AUTHORS: "${met.split.authors ?? 0}"
      EXCLUDED_FILE: "/etc/strfry/metering-excluded.txt"
      PORT: "8402"
    expose: ["8402"]
    depends_on: [postgres, facilitator]`,
      );
    }
```

**Bundle file** — in `renderBundle`, inside the `if (m.services.chat?.nostr)` branch, add beside the other strfry-policy files:

```ts
    if (m.services.metering) {
      files["strfry-policy/metering-excluded.txt"] = renderMeteringExcluded(m);
    }
```

with, near the other policy renderers:

```ts
/** The monetization opt-out list: one hex pubkey per line. An author here is
 *  dropped from every PAID response; their events stay on the free record. */
export function renderMeteringExcluded(m: NetizenManifest): string {
  return header(m, "Metering exclusion list — authors who opted out of monetization") +
    "# One 64-hex Nostr pubkey per line. '#' comments. Re-read every 60s.\n" +
    "# An excluded author's events never appear in /bulk, /export or /firehose\n" +
    "# and never accrue earnings. The free public record is unaffected.\n";
}
```

(Check how `header(...)` renders in the other policy files — if it emits non-`#`-prefixed lines that would break line-parsing, hand-write a plain `#` header instead. `loadExclusions` skips any non-hex line either way.)

**SECRETS.md** — locate `renderSecretsChecklist` and add, following its existing conditional pattern:

```ts
  if (m.services.metering) {
    lines.push("- `METERING_SETTLER_PRIV` — facilitator settler EOA private key (pays gas only; fund with a few xDAI). Generate fresh; never reuse another service's key.");
  }
```

(Adapt to the function's actual list-building idiom — read it first.)

**Artifact copies** — in `packages/cli/src/cli.ts` after line 26:

```ts
  copyBuiltArtifact(bundle, outDir, "gateway:", "../../gateway/dist/gateway.cjs", "gateway/gateway.cjs", "paid data endpoints will NOT serve");
  copyBuiltArtifact(bundle, outDir, "facilitator:", "../../facilitator/dist/facilitator.cjs", "facilitator/facilitator.cjs", "x402 payments will NOT verify or settle");
```

- [ ] **Step 4: Run the cli test suite**

Run: `pnpm --filter netizen test && pnpm --filter netizen typecheck`
Expected: ALL tests pass — the new metering.test.ts AND every pre-existing render/federation/doctor test (the example manifest changed in Task 1; any snapshot the metering block breaks must be updated deliberately, never blindly).

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/render.ts packages/cli/src/cli.ts packages/cli/test/metering.test.ts
git commit -m "feat(cli): render metering services — gateway + facilitator, Caddy path routing, opt-out file, settler secret" -- packages/cli/src/render.ts packages/cli/src/cli.ts packages/cli/test/metering.test.ts
git push
```

---

### Task 10: Docs — roadmap, state doc, spec status

**Files:**
- Modify: `docs/ROADMAP_AND_DEFERRED.md` (§7 gated reads ~line 142, §11 x402 ~line 392)
- Modify: `docs/STATE_OF_NOSTR.md` (add a metering section; update the "world-readable" note ~line 32)
- Modify: `docs/superpowers/specs/2026-08-05-x402-metered-data-access-design.md` (status header)

**Interfaces:** none — prose only.

- [ ] **Step 1: Update ROADMAP_AND_DEFERRED.md**

- §11 "x402 facilitator on Gnosis": mark the facilitator + gateway as **shipped (slice 1)**, link the spec and this plan; note the probe result (USDC.e has EIP-3009 behind `implementation()` proxy — the EURe/Permit2 path was not needed); keep as **deferred with triggers**: Coinbase-facilitator Base accept + Bazaar discovery listing (trigger: GK Safe deployed on Base — Max's task), Stripe API keys (slice 3), payout job + `/metering/stats` display names (slice 2).
- §7 "Gated reads (NIP-42)": add — decision 2026-08-05: the civic record STAYS public; NIP-42 survives only as a possible paid *transport* (trigger: a real customer asks for raw Nostr protocol access). Link the spec's "Rejected: private-by-default" section.

- [ ] **Step 2: Update STATE_OF_NOSTR.md**

Add a short "Metered access (x402)" section: what is free (unchanged), the three paid endpoints on the index host, where the money goes (GK Safe, author split recorded per sale), the opt-out file, and pointers to the spec + `packages/gateway` / `packages/facilitator`. Update the line that says the relay is world-readable with no NIP-42 to note this remains TRUE and deliberate — metering wraps the index HTTP API only.

- [ ] **Step 3: Update the spec status line**

Change `**Status:** DRAFT — design approved…` to `**Status:** APPROVED — slice 1 implemented (see docs/superpowers/plans/2026-08-05-x402-metering-slice1.md)`.

- [ ] **Step 4: Commit**

```bash
git add docs/ROADMAP_AND_DEFERRED.md docs/STATE_OF_NOSTR.md docs/superpowers/specs/2026-08-05-x402-metered-data-access-design.md
git commit -m "docs: metered data access shipped (slice 1) — roadmap + state of nostr updated" -- docs/ROADMAP_AND_DEFERRED.md docs/STATE_OF_NOSTR.md docs/superpowers/specs/2026-08-05-x402-metered-data-access-design.md
git push
```

---

### Task 11: Final verification

- [ ] **Step 1: Full test sweep of every touched package**

Run:
```bash
pnpm --filter @netizen-labs/protocol test && \
pnpm --filter @netizen-labs/facilitator test && \
pnpm --filter @netizen-labs/gateway test && \
pnpm --filter netizen test
```
Expected: all PASS.

- [ ] **Step 2: Typecheck every touched package**

Run:
```bash
pnpm --filter @netizen-labs/protocol typecheck && \
pnpm --filter @netizen-labs/facilitator typecheck && \
pnpm --filter @netizen-labs/gateway typecheck && \
pnpm --filter netizen typecheck
```
Expected: clean.

- [ ] **Step 3: Builds produce deployable artifacts**

Run: `pnpm --filter @netizen-labs/facilitator build && pnpm --filter @netizen-labs/gateway build && ls -la packages/facilitator/dist packages/gateway/dist`
Expected: `facilitator.cjs` and `gateway.cjs` exist.

- [ ] **Step 4: Render the Röbel bundle end-to-end**

Run: `cd packages/cli && pnpm exec tsx src/cli.ts render ../protocol/examples/roebel.netizen.json --out /tmp/metering-bundle-check 2>&1 | tail -20` (adapt to the CLI's actual render invocation — check `src/cli.ts` usage/help first) and inspect `/tmp/metering-bundle-check/docker-compose.yml` + `Caddyfile` contain the gateway/facilitator wiring and `SECRETS.md` the settler key.
Expected: bundle renders without error; paid routing present.

- [ ] **Step 5: Confirm the free tier is untouched**

Run: `git diff main -- packages/indexer/src` (should show NO changes to `api.ts`, `query.ts`, `schema.ts` — the gateway wraps, it does not modify).
Expected: empty diff for indexer src.

- [ ] **Step 6: Report**

Summarize for review: test counts, what was NOT done (deploy to the live node, funding the settler EOA, setting `METERING_SETTLER_PRIV` on the box — operator steps), and the slice-2 gates (payout job, Base accept behind Max's multichain GK, display names on stats).

## Not in this slice (do not build)

- Payout cron / Safe transaction proposing (slice 2)
- `/metering/stats` display-name resolution (slice 2)
- Coinbase facilitator accept, Bazaar listing (slice 2, gated on GK-on-Base)
- Stripe API keys (slice 3)
- NIP-42 paid relay socket, paid writes, Solana (roadmap)
- Any change to `packages/indexer/src` or the relay/write-policy behavior
- App UI for claim/opt-out (the opt-out FILE is the slice-1 interface; the app surface ships with slice 2's claim flow)
- Per-IP rate limiting of the free tier. The existing per-query cap (`MAX_LIMIT = 200`) IS the slice-1 free-tier limit; per-IP rpm needs a Caddy rate-limit plugin or proxying free traffic through the gateway. Deferred with trigger: observed free-tier abuse. (The spec's "60 req/min" default is aspirational until then.)
