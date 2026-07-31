# NSP-12 Slice 1 — Decision-Record Grammar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Encode the NSP-12 Public Decision Record grammar — lifecycle stages, transition legality, event-shape schemas, the manifest block, and the publisher's kind registry + transition builder — per [the NSP-12 spec](../specs/2026-07-31-nsp12-public-decision-record-design.md) §2–§3 and §7.

**Architecture:** `@netizen-labs/protocol` gains a `decisions.ts` module owning the stage machine and zod event schemas (single source of truth for NSP-12 numbers and rules); `manifest.ts` gains the optional top-level `record` block; `@netizen-labs/publisher` aliases the kind constants into its registry (`mappers.ts`) and adds one signer-agnostic pure builder, `transitionToSpec`. No producers for meeting/impact/cycle/meinungsbild events — those belong to later slices (editor-agent, workspace, coordinator).

**Tech Stack:** TypeScript ESM, zod 3, node:test via `tsx --test`, pnpm workspaces.

## Global Constraints

- **Repo:** `~/Documents/privat/side_projects/DAO_test` (Röbel monorepo) ONLY. The netizen_labs repo has its own diverged `packages/protocol` owned by a parallel session right now — do NOT touch it; porting the block there is a follow-up outside this plan.
- **Parallel sessions are active in this repo.** Every commit MUST use explicit pathspecs (`git commit -- <files>`), never a bare `git commit` or `git add .`. Before staging any file, check `git status --porcelain <file>`; if a file you did not create/edit in your task shows modified, stop and flag it instead of committing it.
- **Package manager:** pnpm only.
- **Imports:** relative imports inside these packages use the `.js` suffix (`from "./decisions.js"`), matching existing files. These packages are not imported by the Expo app.
- **Tests:** node:test + `node:assert/strict`, run per package with `pnpm test` (which is `tsx --test test/*.test.ts`). Typecheck per package with `pnpm typecheck`.
- **`MAPPER_VERSION` in `packages/publisher/src/mappers.ts` is NOT bumped** — no existing mapper's output changes in this plan. Only bump it when an existing mapper's OUTPUT changes shape.
- **Immutable events** (kind 2100) follow the existing kind-1 convention (`orgPostToSpec`): `d: ""`, `createdAt` = the moment itself, **no** `MAPPER_VERSION` offset.
- **Stage names and tag grammar are LOCKED by spec §2–§3**; the exact strings appear in Task 1 and Task 2 below. German stage slugs, ASCII only (`zurueckgezogen`, not `zurückgezogen`).
- Commit messages follow repo convention, e.g. `feat(protocol): …`, and end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

## File Structure

- Create: `packages/protocol/src/decisions.ts` — NSP-12 stage machine + event schemas + kind registry (`DECISION_KINDS`).
- Create: `packages/protocol/test/decisions.test.ts` — all protocol-side tests.
- Modify: `packages/protocol/src/manifest.ts` — add optional top-level `record` block (imports from `decisions.js`).
- Modify: `packages/protocol/src/index.ts` — export the decisions module.
- Modify: `packages/protocol/examples/roebel.netizen.json` — adopt the grammar (record block + indexer kinds widened).
- Modify: `packages/protocol/test/manifest.test.ts` — dogfood assertions for the record block.
- Modify: `packages/publisher/src/mappers.ts` — kind aliases + `transitionToSpec`.
- Modify: `packages/publisher/package.json` — add `@netizen-labs/protocol` workspace dep.
- Modify: `packages/publisher/test/mappers.test.ts` — transition builder tests.

---

### Task 1: Stage machine — stages, transition legality

**Files:**
- Create: `packages/protocol/src/decisions.ts`
- Create: `packages/protocol/test/decisions.test.ts`

**Interfaces:**
- Produces: `STAGES` (const tuple), `type Stage`, `StageSchema` (zod enum), `ALLOWED_TRANSITIONS: Record<Stage, readonly Stage[]>`, `isLegalTransition(from: string, to: string): boolean`, `STAGE_MOVERS: Record<Stage, readonly Role[]>`, `type Role`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/protocol/test/decisions.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ALLOWED_TRANSITIONS,
  isLegalTransition,
  STAGE_MOVERS,
  STAGES,
} from "../src/decisions.js";

test("the lifecycle has exactly the ten spec stages", () => {
  assert.deepEqual(
    [...STAGES],
    ["idee", "entwurf", "diskussion", "meinungsbild", "beschlussvorlage",
     "beschlossen", "abgelehnt", "umgesetzt", "ruhend", "zurueckgezogen"],
  );
});

test("the happy path is legal hop by hop", () => {
  const path = ["idee", "entwurf", "diskussion", "meinungsbild",
                "beschlussvorlage", "beschlossen", "umgesetzt"];
  for (let i = 0; i < path.length - 1; i++) {
    assert.equal(isLegalTransition(path[i], path[i + 1]), true, `${path[i]} → ${path[i + 1]}`);
  }
});

test("stage-skipping and resurrection are illegal", () => {
  assert.equal(isLegalTransition("entwurf", "beschlossen"), false);
  assert.equal(isLegalTransition("idee", "beschlussvorlage"), false);
  // terminal stages have no exits
  assert.deepEqual(ALLOWED_TRANSITIONS["abgelehnt"], []);
  assert.deepEqual(ALLOWED_TRANSITIONS["umgesetzt"], []);
  assert.deepEqual(ALLOWED_TRANSITIONS["zurueckgezogen"], []);
});

test("parking and revival: ruhend is exited only via entwurf or withdrawal", () => {
  assert.deepEqual(ALLOWED_TRANSITIONS["ruhend"], ["entwurf", "zurueckgezogen"]);
});

test("unknown stages are never legal", () => {
  assert.equal(isLegalTransition("idee", "banana"), false);
  assert.equal(isLegalTransition("banana", "entwurf"), false);
});

test("who may move a proposal into each stage matches spec §2", () => {
  assert.deepEqual(STAGE_MOVERS["entwurf"], ["editor-agent"]);
  assert.deepEqual(STAGE_MOVERS["diskussion"], ["author"]);
  assert.deepEqual(STAGE_MOVERS["meinungsbild"], ["facilitator"]);
  assert.deepEqual(STAGE_MOVERS["beschlussvorlage"], ["implementer"]);
  assert.deepEqual(STAGE_MOVERS["beschlossen"], ["body-mirror"]);
  assert.deepEqual(STAGE_MOVERS["abgelehnt"], ["body-mirror"]);
  assert.deepEqual(STAGE_MOVERS["umgesetzt"], ["implementer"]);
  assert.deepEqual(STAGE_MOVERS["ruhend"], ["editor-agent"]);
  assert.deepEqual(STAGE_MOVERS["zurueckgezogen"], ["author"]);
  assert.deepEqual(STAGE_MOVERS["idee"], []); // initial stage — nothing transitions into it
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/Documents/privat/side_projects/DAO_test/packages/protocol && pnpm test`
Expected: FAIL — `Cannot find module '../src/decisions.js'`

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/protocol/src/decisions.ts
import { z } from "zod";

/**
 * NSP-12 — the Public Decision Record grammar.
 *
 * The EIP-1/EIP-7723 pipeline mapped to German civic stages. This module is
 * the single source of truth for stage names, transition legality and the
 * NSP-12 kind numbers; the publisher and (later) the editor-agent, explorer
 * and coordinator all import from here rather than re-encoding the table.
 * See docs/superpowers/specs/2026-07-31-nsp12-public-decision-record-design.md §2–§3.
 */

export const STAGES = [
  "idee", "entwurf", "diskussion", "meinungsbild", "beschlussvorlage",
  "beschlossen", "abgelehnt", "umgesetzt", "ruhend", "zurueckgezogen",
] as const;
export type Stage = (typeof STAGES)[number];
export const StageSchema = z.enum(STAGES);

/**
 * Legal hops, keyed by current stage. `beschlossen`/`abgelehnt` are entered
 * only by mirroring a signed civic notice (enforced in the transition schema,
 * not here — this table is pure stage topology).
 */
export const ALLOWED_TRANSITIONS: Record<Stage, readonly Stage[]> = {
  idee: ["entwurf", "zurueckgezogen"],
  entwurf: ["diskussion", "ruhend", "zurueckgezogen"],
  diskussion: ["meinungsbild", "beschlussvorlage", "ruhend", "zurueckgezogen"],
  meinungsbild: ["beschlussvorlage", "diskussion", "zurueckgezogen"],
  beschlussvorlage: ["beschlossen", "abgelehnt", "zurueckgezogen"],
  beschlossen: ["umgesetzt"],
  abgelehnt: [],
  umgesetzt: [],
  ruhend: ["entwurf", "zurueckgezogen"],
  zurueckgezogen: [],
};

export function isLegalTransition(from: string, to: string): boolean {
  const targets = ALLOWED_TRANSITIONS[from as Stage];
  return !!targets && (targets as readonly string[]).includes(to);
}

/** Who may sign a transition INTO each stage (spec §2). Enforcement of
 * signer→role resolution needs the membership registry and ships with the
 * editor-agent slice; this table is exported so every consumer reads one map. */
export type Role = "author" | "editor-agent" | "facilitator" | "implementer" | "body-mirror";
export const STAGE_MOVERS: Record<Stage, readonly Role[]> = {
  idee: [],
  entwurf: ["editor-agent"],
  diskussion: ["author"],
  meinungsbild: ["facilitator"],
  beschlussvorlage: ["implementer"],
  beschlossen: ["body-mirror"],
  abgelehnt: ["body-mirror"],
  umgesetzt: ["implementer"],
  ruhend: ["editor-agent"],
  zurueckgezogen: ["author"],
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ~/Documents/privat/side_projects/DAO_test/packages/protocol && pnpm test`
Expected: PASS (decisions tests green; pre-existing manifest tests stay green)

- [ ] **Step 5: Commit**

```bash
cd ~/Documents/privat/side_projects/DAO_test
git add packages/protocol/src/decisions.ts packages/protocol/test/decisions.test.ts
git commit -m "feat(protocol): NSP-12 stage machine — ten civic stages, legal hops, movers table

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>" \
  -- packages/protocol/src/decisions.ts packages/protocol/test/decisions.test.ts
```

---

### Task 2: Transition event schema — tag grammar + notice-citation rule

**Files:**
- Modify: `packages/protocol/src/decisions.ts` (append)
- Modify: `packages/protocol/test/decisions.test.ts` (append)

**Interfaces:**
- Consumes: Task 1's `StageSchema`, `isLegalTransition`.
- Produces: `DECISION_KINDS` (`{ head: 32100, transition: 2100, meeting: 32103, meinungsbild: 32104, impact: 32105, cycle: 32106 }` as const), `headAddress(pubkeyHex: string, proposalId: string): string`, `type DecisionEventLike = { kind: number; tags: string[][]; content: string; created_at: number }`, `type ParsedTransition = { head: string; from: Stage; to: Stage; notice: string | null; reason: string; createdAt: number }`, `safeParseTransition(ev: DecisionEventLike): { ok: true; value: ParsedTransition } | { ok: false; error: string }`.

**Tag grammar being locked (spec §3):** a kind-2100 transition carries
`["a", "32100:<64-hex-pubkey>:proposal:<id>", "", "proposal"]` (exactly one),
`["from", <stage>]`, `["to", <stage>]`, and — iff `to` is `beschlossen` or
`abgelehnt` — `["a", "32102:<64-hex-pubkey>:<d>", "", "notice"]`. Content is the
free-text reason. Cross-references are `a`-tag addresses ONLY, never event ids.

- [ ] **Step 1: Write the failing test** (append to `decisions.test.ts`)

```ts
import { DECISION_KINDS, headAddress, safeParseTransition } from "../src/decisions.js";

const PK = "a".repeat(64);
const HEAD = headAddress(PK, "42");

function transition(over: Partial<{ tags: string[][]; kind: number; content: string; created_at: number }>) {
  return {
    kind: DECISION_KINDS.transition,
    tags: [["a", HEAD, "", "proposal"], ["from", "idee"], ["to", "entwurf"]],
    content: "Vollständig: Problem, Vorschlag, Betroffene benannt.",
    created_at: 1753970000,
    ...over,
  };
}

test("kind numbers are the spec's provisional set, now claimed", () => {
  assert.deepEqual(DECISION_KINDS, {
    head: 32100, transition: 2100, meeting: 32103,
    meinungsbild: 32104, impact: 32105, cycle: 32106,
  });
});

test("headAddress builds the canonical a-tag address", () => {
  assert.equal(HEAD, `32100:${PK}:proposal:42`);
});

test("a well-formed transition parses", () => {
  const r = safeParseTransition(transition({}));
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.value.head, HEAD);
    assert.equal(r.value.from, "idee");
    assert.equal(r.value.to, "entwurf");
    assert.equal(r.value.notice, null);
    assert.equal(r.value.reason, "Vollständig: Problem, Vorschlag, Betroffene benannt.");
  }
});

test("wrong kind, missing head ref, or unknown stage all fail", () => {
  assert.equal(safeParseTransition(transition({ kind: 1 })).ok, false);
  assert.equal(safeParseTransition(transition({ tags: [["from", "idee"], ["to", "entwurf"]] })).ok, false);
  assert.equal(safeParseTransition(transition({ tags: [["a", HEAD, "", "proposal"], ["from", "idee"], ["to", "banana"]] })).ok, false);
});

test("an illegal hop fails even when both stages exist", () => {
  const r = safeParseTransition(transition({ tags: [["a", HEAD, "", "proposal"], ["from", "entwurf"], ["to", "beschlossen"]] }));
  assert.equal(r.ok, false);
});

test("two head refs are ambiguous and fail", () => {
  const other = headAddress("b".repeat(64), "7");
  const r = safeParseTransition(transition({
    tags: [["a", HEAD, "", "proposal"], ["a", other, "", "proposal"], ["from", "idee"], ["to", "entwurf"]],
  }));
  assert.equal(r.ok, false);
});

test("beschlossen without a civic-notice citation fails; with one it passes", () => {
  const base = [["a", HEAD, "", "proposal"], ["from", "beschlussvorlage"], ["to", "beschlossen"]];
  assert.equal(safeParseTransition(transition({ tags: base })).ok, false);
  const notice = ["a", `32102:${PK}:alert:9`, "", "notice"];
  const r = safeParseTransition(transition({ tags: [...base, notice] }));
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.value.notice, `32102:${PK}:alert:9`);
});

test("abgelehnt requires the citation too", () => {
  const base = [["a", HEAD, "", "proposal"], ["from", "beschlussvorlage"], ["to", "abgelehnt"]];
  assert.equal(safeParseTransition(transition({ tags: base })).ok, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/Documents/privat/side_projects/DAO_test/packages/protocol && pnpm test`
Expected: FAIL — `DECISION_KINDS` / `headAddress` / `safeParseTransition` not exported

- [ ] **Step 3: Write minimal implementation** (append to `decisions.ts`)

```ts
/** NSP-12 kind numbers, claimed. The publisher's mappers.ts aliases these —
 * one registry, no drifting literals. Spec §3. */
export const DECISION_KINDS = {
  head: 32100, transition: 2100, meeting: 32103,
  meinungsbild: 32104, impact: 32105, cycle: 32106,
} as const;

const HEX64 = /^[0-9a-f]{64}$/;

/** Canonical addressable reference to a proposal head. Addresses, never event
 * ids: replaceable-event id links go stale (spec §3, hard rule). */
export function headAddress(pubkeyHex: string, proposalId: string): string {
  return `${DECISION_KINDS.head}:${pubkeyHex}:proposal:${proposalId}`;
}

export interface DecisionEventLike {
  kind: number;
  tags: string[][];
  content: string;
  created_at: number;
}

export interface ParsedTransition {
  head: string;
  from: Stage;
  to: Stage;
  /** Address of the kind-32102 civic notice this transition mirrors. */
  notice: string | null;
  reason: string;
  createdAt: number;
}

const headAddressPattern = new RegExp(`^${DECISION_KINDS.head}:[0-9a-f]{64}:proposal:.+$`);
const noticeAddressPattern = /^32102:[0-9a-f]{64}:.+$/;

/** Stages a proposal may only enter by citing the formal body's signed notice (spec §2). */
const NOTICE_GATED: readonly Stage[] = ["beschlossen", "abgelehnt"];

export function safeParseTransition(
  ev: DecisionEventLike,
): { ok: true; value: ParsedTransition } | { ok: false; error: string } {
  if (ev.kind !== DECISION_KINDS.transition) {
    return { ok: false, error: `expected kind ${DECISION_KINDS.transition}, got ${ev.kind}` };
  }
  const heads = ev.tags.filter((t) => t[0] === "a" && t[3] === "proposal");
  if (heads.length !== 1) return { ok: false, error: `expected exactly one proposal a-tag, got ${heads.length}` };
  const head = heads[0][1] ?? "";
  if (!headAddressPattern.test(head)) return { ok: false, error: `malformed head address: ${head}` };

  const tag = (name: string) => ev.tags.find((t) => t[0] === name)?.[1];
  const from = StageSchema.safeParse(tag("from"));
  const to = StageSchema.safeParse(tag("to"));
  if (!from.success || !to.success) return { ok: false, error: "from/to must be valid stages" };
  if (!isLegalTransition(from.data, to.data)) {
    return { ok: false, error: `illegal transition ${from.data} → ${to.data}` };
  }

  const noticeTag = ev.tags.find((t) => t[0] === "a" && t[3] === "notice");
  const notice = noticeTag?.[1] ?? null;
  if (NOTICE_GATED.includes(to.data)) {
    if (!notice || !noticeAddressPattern.test(notice)) {
      return { ok: false, error: `${to.data} requires a kind-32102 civic-notice citation` };
    }
  }

  return {
    ok: true,
    value: { head, from: from.data, to: to.data, notice, reason: ev.content, createdAt: ev.created_at },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ~/Documents/privat/side_projects/DAO_test/packages/protocol && pnpm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd ~/Documents/privat/side_projects/DAO_test
git add packages/protocol/src/decisions.ts packages/protocol/test/decisions.test.ts
git commit -m "feat(protocol): NSP-12 transition grammar — one head ref, legal hops only, notice-gated outcomes

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>" \
  -- packages/protocol/src/decisions.ts packages/protocol/test/decisions.test.ts
```

---

### Task 3: Transition-trail validation

**Files:**
- Modify: `packages/protocol/src/decisions.ts` (append)
- Modify: `packages/protocol/test/decisions.test.ts` (append)

**Interfaces:**
- Consumes: Task 2's `safeParseTransition`, `DecisionEventLike`, `ParsedTransition`.
- Produces: `validateTransitionTrail(events: DecisionEventLike[]): { ok: true; stage: Stage; head: string | null } | { ok: false; index: number; error: string }`. Every proposal starts at `idee` implicitly; an empty trail is valid at stage `idee` with `head: null`.

- [ ] **Step 1: Write the failing test** (append)

```ts
import { validateTransitionTrail } from "../src/decisions.js";

function hop(from: string, to: string, at: number, extra: string[][] = []) {
  return {
    kind: DECISION_KINDS.transition,
    tags: [["a", HEAD, "", "proposal"], ["from", from], ["to", to], ...extra],
    content: "",
    created_at: at,
  };
}
const NOTICE = ["a", `32102:${PK}:beschluss:1`, "", "notice"];

test("an empty trail is a proposal at idee", () => {
  assert.deepEqual(validateTransitionTrail([]), { ok: true, stage: "idee", head: null });
});

test("a full happy-path trail lands on umgesetzt, order-independent input", () => {
  const trail = [
    hop("beschlussvorlage", "beschlossen", 500, [NOTICE]),
    hop("idee", "entwurf", 100),
    hop("beschlossen", "umgesetzt", 600),
    hop("diskussion", "meinungsbild", 300),
    hop("entwurf", "diskussion", 200),
    hop("meinungsbild", "beschlussvorlage", 400),
  ];
  assert.deepEqual(validateTransitionTrail(trail), { ok: true, stage: "umgesetzt", head: HEAD });
});

test("a trail must depart from idee", () => {
  const r = validateTransitionTrail([hop("entwurf", "diskussion", 100)]);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.index, 0);
});

test("a broken chain reports the offending index after sorting", () => {
  const r = validateTransitionTrail([
    hop("idee", "entwurf", 100),
    hop("diskussion", "meinungsbild", 200), // from ≠ current stage (entwurf)
  ]);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.index, 1);
});

test("a malformed event fails at its index", () => {
  const bad = { ...hop("idee", "entwurf", 100), kind: 1 };
  const r = validateTransitionTrail([bad]);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /expected kind/);
});

test("mixed heads are one trail too many", () => {
  const other = {
    kind: DECISION_KINDS.transition,
    tags: [["a", headAddress("b".repeat(64), "7"), "", "proposal"], ["from", "idee"], ["to", "entwurf"]],
    content: "",
    created_at: 200,
  };
  const r = validateTransitionTrail([hop("idee", "entwurf", 100), other]);
  assert.equal(r.ok, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/Documents/privat/side_projects/DAO_test/packages/protocol && pnpm test`
Expected: FAIL — `validateTransitionTrail` not exported

- [ ] **Step 3: Write minimal implementation** (append)

```ts
/**
 * Validate a proposal's full transition trail (spec §3: the audit trail must
 * not be rewritable, so legality is checked over immutable events, sorted by
 * created_at — ties keep input order; NIP-01 id tie-breaks are the caller's
 * concern once events are signed).
 */
export function validateTransitionTrail(
  events: DecisionEventLike[],
): { ok: true; stage: Stage; head: string | null } | { ok: false; index: number; error: string } {
  const sorted = events
    .map((ev, i) => ({ ev, i }))
    .sort((a, b) => a.ev.created_at - b.ev.created_at || a.i - b.i);

  let stage: Stage = "idee";
  let head: string | null = null;
  for (let n = 0; n < sorted.length; n++) {
    const parsed = safeParseTransition(sorted[n].ev);
    if (!parsed.ok) return { ok: false, index: n, error: parsed.error };
    const t = parsed.value;
    if (head === null) head = t.head;
    else if (t.head !== head) return { ok: false, index: n, error: `trail mixes heads ${head} and ${t.head}` };
    if (t.from !== stage) {
      return { ok: false, index: n, error: `expected departure from ${stage}, got ${t.from}` };
    }
    stage = t.to;
  }
  return { ok: true, stage, head };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ~/Documents/privat/side_projects/DAO_test/packages/protocol && pnpm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd ~/Documents/privat/side_projects/DAO_test
git add packages/protocol/src/decisions.ts packages/protocol/test/decisions.test.ts
git commit -m "feat(protocol): NSP-12 trail validation — every proposal's history replays from idee or fails loudly

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>" \
  -- packages/protocol/src/decisions.ts packages/protocol/test/decisions.test.ts
```

---

### Task 4: Shape schemas for the four remaining kinds + module export

**Files:**
- Modify: `packages/protocol/src/decisions.ts` (append)
- Modify: `packages/protocol/src/index.ts`
- Modify: `packages/protocol/test/decisions.test.ts` (append)

**Interfaces:**
- Consumes: Task 2's `DecisionEventLike`, `DECISION_KINDS`, `headAddressPattern` logic.
- Produces: `AUDIENCES` (`["anwohner","gewerbe","vereine","verwaltung"]` as const), `type Audience`, `CYCLE_STAGES` (`["vorgeschlagen","in-pruefung","eingeplant","nicht-aufgenommen"]` as const), and four validators with the uniform signature `safeParseMeeting(ev)`, `safeParseMeinungsbild(ev)`, `safeParseImpact(ev)`, `safeParseCycle(ev)` → `{ ok: true } | { ok: false; error: string }`. These are shape gates for later slices' producers; they validate tags, not semantics.

**Rules being locked (spec §3, §6):**
- 32103 meeting: `d` matches `meeting:<body-slug>:<YYYY-MM-DD>`; a `title` tag is required.
- 32104 meinungsbild: `d` matches `poll:<id>`; an `advisory` tag is REQUIRED, always (spec §6 rule 1).
- 32105 impact: `d` matches `impact:proposal:<id>:<audience>`; requires one proposal `a`-tag head ref and an `audience` tag from `AUDIENCES` that equals the `d` suffix.
- 32106 cycle: `d` matches `cycle:<slug>`; proposal entries are `a`-tags whose marker (4th element) is a `CYCLE_STAGES` value; at most ONE `headliner` tag (spec §5).

- [ ] **Step 1: Write the failing test** (append)

```ts
import {
  AUDIENCES, CYCLE_STAGES,
  safeParseCycle, safeParseImpact, safeParseMeeting, safeParseMeinungsbild,
} from "../src/decisions.js";

function evOf(kind: number, tags: string[][]) {
  return { kind, tags, content: "", created_at: 1753970000 };
}

test("audience and cycle-stage vocabularies match the spec", () => {
  assert.deepEqual([...AUDIENCES], ["anwohner", "gewerbe", "vereine", "verwaltung"]);
  assert.deepEqual([...CYCLE_STAGES], ["vorgeschlagen", "in-pruefung", "eingeplant", "nicht-aufgenommen"]);
});

test("meeting records need a well-formed d and a title", () => {
  const ok = evOf(DECISION_KINDS.meeting, [["d", "meeting:stadtvertretung:2026-09-02"], ["title", "Sitzung 09/26"]]);
  assert.equal(safeParseMeeting(ok).ok, true);
  assert.equal(safeParseMeeting(evOf(DECISION_KINDS.meeting, [["d", "meeting:stadtvertretung:2026-09-02"]])).ok, false);
  assert.equal(safeParseMeeting(evOf(DECISION_KINDS.meeting, [["d", "stadtvertretung"], ["title", "x"]])).ok, false);
});

test("a meinungsbild result without the advisory tag is invalid, always", () => {
  const base = [["d", "poll:5"]];
  assert.equal(safeParseMeinungsbild(evOf(DECISION_KINDS.meinungsbild, base)).ok, false);
  assert.equal(safeParseMeinungsbild(evOf(DECISION_KINDS.meinungsbild, [...base, ["advisory", "true"]])).ok, true);
});

test("impact summaries bind audience, head ref and d together", () => {
  const good = evOf(DECISION_KINDS.impact, [
    ["d", "impact:proposal:42:gewerbe"],
    ["a", HEAD, "", "proposal"],
    ["audience", "gewerbe"],
  ]);
  assert.equal(safeParseImpact(good).ok, true);
  // audience outside the vocabulary
  const badAud = evOf(DECISION_KINDS.impact, [
    ["d", "impact:proposal:42:touristen"], ["a", HEAD, "", "proposal"], ["audience", "touristen"],
  ]);
  assert.equal(safeParseImpact(badAud).ok, false);
  // audience tag disagrees with d suffix
  const drift = evOf(DECISION_KINDS.impact, [
    ["d", "impact:proposal:42:gewerbe"], ["a", HEAD, "", "proposal"], ["audience", "vereine"],
  ]);
  assert.equal(safeParseImpact(drift).ok, false);
  // no head ref
  const noHead = evOf(DECISION_KINDS.impact, [["d", "impact:proposal:42:gewerbe"], ["audience", "gewerbe"]]);
  assert.equal(safeParseImpact(noHead).ok, false);
});

test("a cycle allows at most one headliner and only known stage markers", () => {
  const entry = (id: string, marker: string) => ["a", headAddress(PK, id), "", marker];
  const good = evOf(DECISION_KINDS.cycle, [
    ["d", "cycle:massnahmen-2027"],
    entry("1", "eingeplant"), entry("2", "vorgeschlagen"),
    ["headliner", headAddress(PK, "1")],
  ]);
  assert.equal(safeParseCycle(good).ok, true);
  const twoHeadliners = evOf(DECISION_KINDS.cycle, [
    ["d", "cycle:massnahmen-2027"],
    entry("1", "eingeplant"),
    ["headliner", headAddress(PK, "1")], ["headliner", headAddress(PK, "2")],
  ]);
  assert.equal(safeParseCycle(twoHeadliners).ok, false);
  const badMarker = evOf(DECISION_KINDS.cycle, [["d", "cycle:massnahmen-2027"], entry("1", "wunschliste")]);
  assert.equal(safeParseCycle(badMarker).ok, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/Documents/privat/side_projects/DAO_test/packages/protocol && pnpm test`
Expected: FAIL — new exports missing

- [ ] **Step 3: Write minimal implementation** (append to `decisions.ts`)

```ts
export const AUDIENCES = ["anwohner", "gewerbe", "vereine", "verwaltung"] as const;
export type Audience = (typeof AUDIENCES)[number];
export const CYCLE_STAGES = ["vorgeschlagen", "in-pruefung", "eingeplant", "nicht-aufgenommen"] as const;
export type CycleStage = (typeof CYCLE_STAGES)[number];

type ShapeResult = { ok: true } | { ok: false; error: string };

function dTag(ev: DecisionEventLike): string {
  return ev.tags.find((t) => t[0] === "d")?.[1] ?? "";
}
function hasTag(ev: DecisionEventLike, name: string): boolean {
  return ev.tags.some((t) => t[0] === name);
}
function shape(cond: boolean, error: string): ShapeResult {
  return cond ? { ok: true } : { ok: false, error };
}

/** 32103 — a body's meeting: agenda before, minutes/transcript pointers after. */
export function safeParseMeeting(ev: DecisionEventLike): ShapeResult {
  if (ev.kind !== DECISION_KINDS.meeting) return { ok: false, error: "wrong kind" };
  if (!/^meeting:[a-z0-9-]+:\d{4}-\d{2}-\d{2}$/.test(dTag(ev))) {
    return { ok: false, error: "d must be meeting:<body>:<YYYY-MM-DD>" };
  }
  return shape(hasTag(ev, "title"), "a meeting record needs a title tag");
}

/** 32104 — a MACI tally pointer. The advisory tag is not optional decoration:
 * a Meinungsbild that could render as a decision is a legal problem (spec §6). */
export function safeParseMeinungsbild(ev: DecisionEventLike): ShapeResult {
  if (ev.kind !== DECISION_KINDS.meinungsbild) return { ok: false, error: "wrong kind" };
  if (!/^poll:.+$/.test(dTag(ev))) return { ok: false, error: "d must be poll:<id>" };
  return shape(hasTag(ev, "advisory"), "a meinungsbild result must carry the advisory tag");
}

/** 32105 — "Was bedeutet das für dich", one audience per event. */
export function safeParseImpact(ev: DecisionEventLike): ShapeResult {
  if (ev.kind !== DECISION_KINDS.impact) return { ok: false, error: "wrong kind" };
  const d = dTag(ev);
  const m = /^impact:proposal:(.+):([a-z]+)$/.exec(d);
  if (!m) return { ok: false, error: "d must be impact:proposal:<id>:<audience>" };
  const audience = ev.tags.find((t) => t[0] === "audience")?.[1];
  if (!audience || !(AUDIENCES as readonly string[]).includes(audience)) {
    return { ok: false, error: "audience must be one of the four groups" };
  }
  if (audience !== m[2]) return { ok: false, error: "audience tag and d suffix disagree" };
  const heads = ev.tags.filter((t) => t[0] === "a" && t[3] === "proposal");
  return shape(heads.length === 1, "an impact summary cites exactly one proposal head");
}

/** 32106 — the Maßnahmenpaket. One headliner, never two (spec §5). */
export function safeParseCycle(ev: DecisionEventLike): ShapeResult {
  if (ev.kind !== DECISION_KINDS.cycle) return { ok: false, error: "wrong kind" };
  if (!/^cycle:[a-z0-9-]+$/.test(dTag(ev))) return { ok: false, error: "d must be cycle:<slug>" };
  const entries = ev.tags.filter((t) => t[0] === "a");
  for (const e of entries) {
    if (!e[3] || !(CYCLE_STAGES as readonly string[]).includes(e[3])) {
      return { ok: false, error: `cycle entry marker must be a cycle stage, got "${e[3] ?? ""}"` };
    }
  }
  const headliners = ev.tags.filter((t) => t[0] === "headliner");
  return shape(headliners.length <= 1, "at most one headliner per cycle");
}
```

Then replace `packages/protocol/src/index.ts` with:

```ts
export {
  NetizenManifestSchema,
  parseManifest,
  safeParseManifest,
  type NetizenManifest,
} from "./manifest.js";
export {
  ALLOWED_TRANSITIONS,
  AUDIENCES,
  CYCLE_STAGES,
  DECISION_KINDS,
  STAGE_MOVERS,
  STAGES,
  StageSchema,
  headAddress,
  isLegalTransition,
  safeParseCycle,
  safeParseImpact,
  safeParseMeeting,
  safeParseMeinungsbild,
  safeParseTransition,
  validateTransitionTrail,
  type Audience,
  type CycleStage,
  type DecisionEventLike,
  type ParsedTransition,
  type Role,
  type Stage,
} from "./decisions.js";
```

- [ ] **Step 4: Run tests and typecheck**

Run: `cd ~/Documents/privat/side_projects/DAO_test/packages/protocol && pnpm test && pnpm typecheck`
Expected: PASS, no type errors

- [ ] **Step 5: Commit**

```bash
cd ~/Documents/privat/side_projects/DAO_test
git add packages/protocol/src/decisions.ts packages/protocol/src/index.ts packages/protocol/test/decisions.test.ts
git commit -m "feat(protocol): NSP-12 shape gates — meetings, advisory-only meinungsbild, audience-bound impact, one-headliner cycles

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>" \
  -- packages/protocol/src/decisions.ts packages/protocol/src/index.ts packages/protocol/test/decisions.test.ts
```

---

### Task 5: Manifest `record` block + dogfood manifest adoption

**Files:**
- Modify: `packages/protocol/src/manifest.ts`
- Modify: `packages/protocol/examples/roebel.netizen.json`
- Modify: `packages/protocol/test/manifest.test.ts`

**Interfaces:**
- Consumes: Task 4's `AUDIENCES`, `DECISION_KINDS` (import from `./decisions.js`).
- Produces: optional top-level `record` field on `NetizenManifestSchema`; `NetizenManifest["record"]` type flows automatically.

**Deviations from the spec §7 sketch, both deliberate (record them in code comments):**
1. Agents are referenced by **watcher-style slug** (`agent: "mecky-editor"`), not raw npub — identity is derived from (node secret, node id, slug) exactly like `agents.watcher.agent`, and a raw key in the manifest would be a second identity scheme.
2. `bodies[].noticeAuthor` becomes `bodies[].noticeScope` — civic notices are signed under a derived org scope (the publisher's `TOWN_SCOPE` pattern), so the manifest names the scope, not a key.

- [ ] **Step 1: Write the failing test** (append to `manifest.test.ts`)

```ts
test("the Röbel manifest adopts the NSP-12 decision record with default kinds", () => {
  const m = parseManifest(roebel);
  assert.ok(m.record, "roebel example must declare the record block");
  assert.equal(m.record!.decisions.kinds.transition, 2100);
  assert.equal(m.record!.decisions.kinds.cycle, 32106);
  // adopting the grammar means indexing it — the six kinds are in the indexer set
  for (const k of [2100, 32100, 32103, 32104, 32105, 32106]) {
    assert.ok(m.services.indexer!.kinds.includes(k), `indexer must include kind ${k}`);
  }
});

test("record agents use watcher-style slugs and default staleAfterDays", () => {
  const withAgents = {
    ...roebel,
    record: {
      decisions: {
        agents: { editor: { agent: "mecky-editor" }, impact: { agent: "mecky-impact" } },
      },
    },
  };
  const m = parseManifest(withAgents);
  assert.equal(m.record!.decisions.agents!.editor!.staleAfterDays, 180);
  assert.deepEqual(m.record!.decisions.agents!.impact!.audiences,
    ["anwohner", "gewerbe", "vereine", "verwaltung"]);
});

test("a bad audience or an uppercase agent slug is rejected", () => {
  const badAudience = {
    ...roebel,
    record: { decisions: { agents: { impact: { agent: "mecky-impact", audiences: ["touristen"] } } } },
  };
  assert.equal(safeParseManifest(badAudience).success, false);
  const badSlug = {
    ...roebel,
    record: { decisions: { agents: { editor: { agent: "Mecky" } } } },
  };
  assert.equal(safeParseManifest(badSlug).success, false);
});

test("a node without a record block still validates — the grammar is optional", () => {
  const bare = { ...roebel } as Record<string, unknown>;
  delete bare.record;
  assert.equal(safeParseManifest(bare).success, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/Documents/privat/side_projects/DAO_test/packages/protocol && pnpm test`
Expected: FAIL — `m.record` undefined / schema strips the unknown key

- [ ] **Step 3: Implement**

In `manifest.ts`, add near the top:

```ts
import { AUDIENCES, DECISION_KINDS } from "./decisions.js";
```

Add before `NetizenManifestSchema` (after the `Operations` block):

```ts
/**
 * NSP-12 — the Public Decision Record: the proposal pipeline as public,
 * signed events. See docs/superpowers/specs/2026-07-31-nsp12-public-decision-record-design.md §7.
 *
 * Agents are referenced by watcher-style slug (identity derived from the node
 * secret, like `agents.watcher.agent`) — not by raw key, which would be a
 * second identity scheme in one manifest. Bodies name the publisher SCOPE
 * their notices are signed under, because notices are org-scope speech.
 */
const agentSlug = z.string().regex(/^[a-z0-9-]+$/, "agent name must be a lowercase slug");
const RecordBlock = z.object({
  decisions: z.object({
    kinds: z
      .object({
        head: z.number().int().positive().default(DECISION_KINDS.head),
        transition: z.number().int().positive().default(DECISION_KINDS.transition),
        meeting: z.number().int().positive().default(DECISION_KINDS.meeting),
        meinungsbild: z.number().int().positive().default(DECISION_KINDS.meinungsbild),
        impact: z.number().int().positive().default(DECISION_KINDS.impact),
        cycle: z.number().int().positive().default(DECISION_KINDS.cycle),
      })
      .default({}),
    agents: z
      .object({
        editor: z
          .object({
            agent: agentSlug,
            /** After this many days without activity the editor may park a draft (`ruhend`). */
            staleAfterDays: z.number().int().positive().default(180),
          })
          .optional(),
        impact: z
          .object({
            agent: agentSlug,
            audiences: z.array(z.enum(AUDIENCES)).min(1).default([...AUDIENCES]),
          })
          .optional(),
      })
      .optional(),
    /** Formal decision bodies whose signed notices gate beschlossen/abgelehnt. */
    bodies: z
      .array(z.object({ id: z.string().regex(/^[a-z0-9-]+$/), noticeScope: z.string().min(1) }))
      .optional(),
    cycle: z.object({ current: z.string().regex(/^[a-z0-9-]+$/) }).optional(),
  }),
});
```

In `NetizenManifestSchema`, after the `peers` line add:

```ts
  /** NSP-12 — the public decision record. Absent means the node does not run the pipeline. */
  record: RecordBlock.optional(),
```

In `examples/roebel.netizen.json`: append `2100, 32103, 32104, 32105, 32106` to `services.indexer.kinds`, and add after the `"peers"` section (adjust comma placement to keep valid JSON):

```json
"record": {
  "decisions": {
    "bodies": [{ "id": "stadtvertretung", "noticeScope": "town" }]
  }
},
```

(`agents` and `cycle` stay absent in the dogfood manifest until the editor-agent slice and the first real Maßnahmenpaket exist — the manifest describes what runs, not what is planned.)

- [ ] **Step 4: Run tests and typecheck**

Run: `cd ~/Documents/privat/side_projects/DAO_test/packages/protocol && pnpm test && pnpm typecheck`
Expected: PASS — including the pre-existing minimal-node and testnode tests (testnode example is deliberately untouched: absence must stay valid)

- [ ] **Step 5: Commit**

```bash
cd ~/Documents/privat/side_projects/DAO_test
git add packages/protocol/src/manifest.ts packages/protocol/examples/roebel.netizen.json packages/protocol/test/manifest.test.ts
git commit -m "feat(protocol): manifest learns the decision record — NSP-12 block, indexer kinds widened, Röbel dogfoods it

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>" \
  -- packages/protocol/src/manifest.ts packages/protocol/examples/roebel.netizen.json packages/protocol/test/manifest.test.ts
```

---

### Task 6: Publisher — kind registry aliases + `transitionToSpec`

**Files:**
- Modify: `packages/publisher/package.json` (add dep `"@netizen-labs/protocol": "workspace:*"`)
- Modify: `packages/publisher/src/mappers.ts`
- Modify: `packages/publisher/test/mappers.test.ts`

**Interfaces:**
- Consumes: `DECISION_KINDS`, `headAddress`, `isLegalTransition` from `@netizen-labs/protocol`.
- Produces (from `mappers.ts`):
  - `KIND_DECISION_TRANSITION`, `KIND_MEETING_RECORD`, `KIND_MEINUNGSBILD_RESULT`, `KIND_IMPACT_SUMMARY`, `KIND_DECISION_CYCLE` (aliases of `DECISION_KINDS.*` — the registry stays readable in one file without duplicating literals).
  - `interface TransitionInput { scope: string; proposalId: string; headPubkey: string; from: string; to: string; reason?: string; noticeAddress?: string; at: number }`
  - `transitionToSpec(input: TransitionInput): PublishSpec | null` — signer-agnostic (the caller picks the scope: editor-agent, org, or town), immutable-event conventions (`d: ""`, `createdAt = at`, no `MAPPER_VERSION` offset), returns `null` for illegal hops or a missing/malformed notice on `beschlossen`/`abgelehnt`.

**NOTE — shared-file hazard:** `packages/publisher/src/index.ts` has been edited by a parallel session recently. Do NOT touch `index.ts` in this task. `transitionToSpec` is exported from `mappers.ts`; wiring it into `index.ts` is a one-line follow-up left to whichever session next owns that file (record this in the final report).

- [ ] **Step 1: Check the working tree is safe**

Run: `cd ~/Documents/privat/side_projects/DAO_test && git status --porcelain packages/publisher/`
Expected: `src/mappers.ts` and `test/mappers.test.ts` NOT modified. If either shows modified before you start, STOP and flag — a parallel session is in the file.

- [ ] **Step 2: Write the failing test** (append to `packages/publisher/test/mappers.test.ts`; extend the existing import from `../src/mappers.js` with `KIND_DECISION_TRANSITION` and `transitionToSpec`)

```ts
const PK64 = "a".repeat(64);

describe("decision transition mapping", () => {
  const base = {
    scope: "town",
    proposalId: "42",
    headPubkey: PK64,
    from: "idee",
    to: "entwurf",
    reason: "Vollständig.",
    at: 1753970000,
  };

  it("builds an immutable kind-2100 spec with head ref and from/to tags", () => {
    const spec = transitionToSpec(base)!;
    assert.equal(spec.kind, KIND_DECISION_TRANSITION);
    assert.equal(spec.kind, 2100);
    assert.equal(spec.scope, "town");
    assert.equal(spec.d, "");
    assert.equal(spec.content, "Vollständig.");
    // immutable: the moment itself, no MAPPER_VERSION offset
    assert.equal(spec.createdAt, 1753970000);
    assert.deepEqual(spec.tags, [
      ["a", `32100:${PK64}:proposal:42`, "", "proposal"],
      ["from", "idee"],
      ["to", "entwurf"],
    ]);
  });

  it("refuses an illegal hop", () => {
    assert.equal(transitionToSpec({ ...base, from: "entwurf", to: "beschlossen" }), null);
  });

  it("beschlossen requires a notice address and carries it as a notice a-tag", () => {
    const gated = { ...base, from: "beschlussvorlage", to: "beschlossen" };
    assert.equal(transitionToSpec(gated), null);
    const spec = transitionToSpec({ ...gated, noticeAddress: `32102:${PK64}:beschluss:1` })!;
    assert.deepEqual(spec.tags[3], ["a", `32102:${PK64}:beschluss:1`, "", "notice"]);
  });

  it("refuses a malformed head pubkey", () => {
    assert.equal(transitionToSpec({ ...base, headPubkey: "0xdeadbeef" }), null);
  });
});
```

- [ ] **Step 3: Add the workspace dep and verify the test fails**

Run:
```bash
cd ~/Documents/privat/side_projects/DAO_test/packages/publisher
# add "@netizen-labs/protocol": "workspace:*" to dependencies in package.json (Edit tool)
cd ~/Documents/privat/side_projects/DAO_test && pnpm install --filter @netizen-labs/publisher... 2>/dev/null || pnpm install
cd packages/publisher && pnpm test
```
Expected: FAIL — `transitionToSpec` not exported

- [ ] **Step 4: Implement** (append to `mappers.ts`, after `proposalToSpec`)

```ts
import { DECISION_KINDS, headAddress, isLegalTransition } from "@netizen-labs/protocol";
```
(placed with the file's imports at the top)

```ts
/**
 * NSP-12 decision-record kinds. The numbers live in @netizen-labs/protocol
 * (DECISION_KINDS) so validation and construction can never drift; these
 * aliases keep this file readable as the one-stop kind registry.
 * See docs/superpowers/specs/2026-07-31-nsp12-public-decision-record-design.md §3.
 */
export const KIND_DECISION_TRANSITION = DECISION_KINDS.transition; // 2100
export const KIND_MEETING_RECORD = DECISION_KINDS.meeting; // 32103
export const KIND_MEINUNGSBILD_RESULT = DECISION_KINDS.meinungsbild; // 32104
export const KIND_IMPACT_SUMMARY = DECISION_KINDS.impact; // 32105
export const KIND_DECISION_CYCLE = DECISION_KINDS.cycle; // 32106

export interface TransitionInput {
  /** Identity scope the transition is signed under — the caller decides:
   * editor-agent, implementer org, or town (body mirror). */
  scope: string;
  proposalId: string;
  /** 64-hex pubkey the proposal head is published under. */
  headPubkey: string;
  from: string;
  to: string;
  reason?: string;
  /** kind-32102 address (`32102:<pubkey>:<d>`) — REQUIRED for beschlossen/abgelehnt. */
  noticeAddress?: string;
  /** Unix seconds of the transition moment. */
  at: number;
}

/**
 * A lifecycle move → an IMMUTABLE kind-2100 event. Immutable like org posts:
 * d = "", createdAt = the moment itself, never MAPPER_VERSION-offset — an
 * audit trail that re-publishes under new ids is not an audit trail.
 * Returns null rather than building an event the protocol would reject.
 */
export function transitionToSpec(input: TransitionInput): PublishSpec | null {
  if (!/^[0-9a-f]{64}$/.test(input.headPubkey)) return null;
  if (!input.proposalId || !isLegalTransition(input.from, input.to)) return null;

  const tags: string[][] = [
    ["a", headAddress(input.headPubkey, input.proposalId), "", "proposal"],
    ["from", input.from],
    ["to", input.to],
  ];
  if (input.to === "beschlossen" || input.to === "abgelehnt") {
    if (!input.noticeAddress || !/^32102:[0-9a-f]{64}:.+$/.test(input.noticeAddress)) return null;
    tags.push(["a", input.noticeAddress, "", "notice"]);
  }

  return {
    scope: input.scope,
    kind: KIND_DECISION_TRANSITION,
    d: "",
    content: input.reason ?? "",
    tags,
    createdAt: input.at,
  };
}
```

- [ ] **Step 5: Run tests and typecheck**

Run: `cd ~/Documents/privat/side_projects/DAO_test/packages/publisher && pnpm test && pnpm typecheck`
Expected: PASS — all pre-existing mapper/backfeed/sync tests stay green

- [ ] **Step 6: Commit**

```bash
cd ~/Documents/privat/side_projects/DAO_test
git add packages/publisher/package.json packages/publisher/src/mappers.ts packages/publisher/test/mappers.test.ts pnpm-lock.yaml
git commit -m "feat(publisher): NSP-12 kinds claimed and transitions buildable — immutable, notice-gated, signer-agnostic

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>" \
  -- packages/publisher/package.json packages/publisher/src/mappers.ts packages/publisher/test/mappers.test.ts pnpm-lock.yaml
```

(If `pnpm-lock.yaml` was concurrently modified by a parallel session, verify with `git diff pnpm-lock.yaml` that the only hunks are the publisher dep before staging it; otherwise commit without it and flag.)

---

### Task 7: Full verification + push

- [ ] **Step 1: Run both packages end to end**

```bash
cd ~/Documents/privat/side_projects/DAO_test/packages/protocol && pnpm test && pnpm typecheck
cd ~/Documents/privat/side_projects/DAO_test/packages/publisher && pnpm test && pnpm typecheck
```
Expected: all green. Paste actual output in the report — no green claims without evidence.

- [ ] **Step 2: Confirm nothing foreign is staged, then push**

```bash
cd ~/Documents/privat/side_projects/DAO_test
git status --porcelain   # only untracked/dirty files from OTHER sessions may remain — none of ours
git log --oneline origin/main..HEAD   # exactly the commits from Tasks 1–6
git push
```

- [ ] **Step 3: Report follow-ups** (not implemented here, by design)

- `packages/publisher/src/index.ts` export line for the new symbols — deferred (shared-file hazard).
- Porting the `record` block + `decisions.ts` to the netizen_labs repo's diverged protocol copy — coordinate with that session.
- The real node manifest on the box (installer input) mirrors `examples/roebel.netizen.json` — widening its indexer kinds is an operational step for the user/next ops session.
- Slices 2–4 (editor-agent, explorer "Vorhaben" pages, first cycle) each need their own plan.

---

## Self-review notes

- **Spec coverage:** §2 lifecycle → Tasks 1–3; §3 grammar + hard reference rule → Tasks 2–4, 6; §5 headliner rule → Task 4; §6 advisory rule → Task 4; §7 manifest/indexer → Task 5; §8 rails are content rules for later producers (no code here by design); §9 slice 1 fully covered, slices 2–4 explicitly out.
- **Signer-role enforcement (§2 movers)** is exported as data (`STAGE_MOVERS`) but not enforced in trail validation — signer→role resolution needs the membership registry and ships with the editor-agent slice. Stated in code comment and Task 7 report.
- **Type consistency:** `DecisionEventLike` (protocol) vs `PublishSpec` (publisher) are deliberately different shapes — builder output vs validation input; `transitionToSpec` output round-trips through `safeParseTransition` once signed (kind/tags/content/created_at align 1:1).
