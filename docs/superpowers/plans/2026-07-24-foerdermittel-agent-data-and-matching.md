# Fördermittel Agent — Plan 1: Data Model + Honest Matching Engine

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Given an organization's funding-profile, produce a persisted, honest, ranked list of funding programs it genuinely qualifies for — deterministic eligibility filtering plus Claude-reasoned fit with honest probability bands.

**Architecture:** All matching logic is written as **pure functions with injected data sources and an injected LLM caller**, matching this repo's `node:test`+`tsx` dependency-injection test style. Hard eligibility filters are fully deterministic (no LLM, fully unit-tested). Deep fit reasoning calls Claude Opus behind an injected `GenerateFit` seam so the orchestrator is testable without hitting the API. A thin server action wires the real Supabase (`createAdminClient`) + real Opus adapter together. Data lives in four new Supabase tables plus one consent column on `accounts`.

**Tech Stack:** Next.js 15 (App Router, server actions), Supabase Postgres (migrations via Supabase MCP), `@ai-sdk/anthropic` v3 + `ai` v6 `generateObject`, `zod` v3, `node:test` + `tsx` for tests.

## Global Constraints

- **Migrations dir:** canonical is `supabase/migrations/`; filename format `YYYYMMDD_snake_case.sql`. Apply via the **Supabase MCP** `mcp__supabase__apply_migration` (project ref `wwbeqhkslxdxhktqzqti`) — the `supabase` CLI is intentionally not installed.
- **No generated DB types.** Hand-write interfaces in `apps/web/src/types/foerdermittel.ts`; cast query results (`data as FundingProgram[]`).
- **RLS pattern:** enable RLS, add open `USING (true)` policies; enforce access in server code via `createAdminClient()` + explicit `wallet_address`/owner checks. Never import `createAdminClient` in a client component.
- **Anthropic structured-output gotcha:** with `@ai-sdk/anthropic` v3, do **not** put `.min()`/`.max()` on integer/number Zod fields — Anthropic's native structured output rejects the JSON-schema `minimum`/`maximum` keyword with a 400. Clamp numeric ranges in code instead.
- **Model routing:** deep fit reasoning → `anthropic("claude-opus-4-8")`. (Later plans: Sonnet for chat/research, deterministic for hard filters — no LLM.)
- **Honesty rule (from spec §6):** matches must carry a rationale + source URL; `niedrig`-band matches are surfaced **collapsed**, not hidden. Never fabricate program deadlines/amounts — unknown numerics stay `null`.
- **German user-facing strings** in server actions (`{ success, error }`, `console.error` on catch).
- **Test command (from repo root):** `pnpm exec tsx --test apps/web/tests/<file>.test.ts`. All test files: `apps/web/tests/*.test.ts`, `node:test` + `node:assert/strict`, inject fake sources (see `apps/web/tests/unread-notification-count.test.ts`).
- **Commit convention:** `feat(foerdermittel): …` / `test(foerdermittel): …`. Stage only files changed by the task. Git cycle add→commit→push after each task.

---

## Where this plan sits (Phase 1 sequencing)

Phase 1 of the Fördermittel Agent (spec: [`docs/superpowers/specs/2026-07-24-foerdermittel-agent-design.md`](../specs/2026-07-24-foerdermittel-agent-design.md)) is delivered as sequential plans:

1. **Plan 1 (this doc) — Data model + honest matching engine.** Tables, types, curated seed, deterministic eligibility, Claude fit reasoning, orchestrator + server action. Deliverable: `runFundingMatchAction(accountId, walletAddress)` returns and persists honest ranked matches.
2. **Plan 2 — Mecky interview + report surface.** Server-side conversational agent + the profile-capture flow + the 7 Mecky tools that read/write the profile and call the Plan 1 engine.
3. **Plan 3 — Dashboard panel + admin verification queue.** Web org-dashboard "Fördermittel" panel (gated via `subTypeFeatures`) + admin review UI for research-agent proposals (mecky_drafts pattern).
4. **Plan 4 — Research agent.** Scheduled ingestion (Claude + web search) writing `status='proposed'` programs with citations.
5. **Plan 5 — Outreach orchestrator.** Relevance-driven, opt-out, frequency-capped outreach to `account_owners` via `notifications`.

Plan 1's server action is the seam Plans 2–3 call; the `funding_programs.status='proposed'→'verified'` gate is the seam Plans 3–4 use.

---

## File Structure (Plan 1)

**Create:**
- `supabase/migrations/20260724_foerdermittel_schema.sql` — 4 tables + `accounts.foerder_outreach_opt_in`.
- `supabase/migrations/20260724_foerdermittel_seed.sql` — curated core programs (`status='verified'`).
- `apps/web/src/types/foerdermittel.ts` — all hand-written types + enums.
- `apps/web/src/lib/foerdermittel/eligibility.ts` — `filterEligiblePrograms` (pure, deterministic).
- `apps/web/src/lib/foerdermittel/matching.ts` — `rankMatches` (pure, injected `GenerateFit`).
- `apps/web/src/lib/foerdermittel/fit-prompt.ts` — `buildFitPrompt` (pure) + `FIT_SYSTEM_PROMPT`.
- `apps/web/src/lib/foerdermittel/fit-generator.ts` — `generateFitWithClaude` (real Opus adapter; not unit-tested).
- `apps/web/src/lib/foerdermittel/run-match.ts` — `runFundingMatch` orchestrator (pure, injected sources).
- `apps/web/src/lib/foerdermittel/sources.ts` — `createMatchSources` (real Supabase adapter; not unit-tested).
- `apps/web/src/app/actions/foerdermittel.ts` — `runFundingMatchAction` server action (wiring + owner check).
- `apps/web/tests/foerdermittel-eligibility.test.ts`
- `apps/web/tests/foerdermittel-matching.test.ts`
- `apps/web/tests/foerdermittel-fit-prompt.test.ts`
- `apps/web/tests/foerdermittel-run-match.test.ts`

**Modify:** none in Plan 1 (all additive).

---

### Task 1: Schema migration + types

**Files:**
- Create: `supabase/migrations/20260724_foerdermittel_schema.sql`
- Create: `apps/web/src/types/foerdermittel.ts`

**Interfaces:**
- Produces (types consumed by every later task): `FundingProgram`, `ProgramEligibility`, `OrgFundingProfile`, `MatchInput`, `RankedMatch`, `FitResult`, and the enums `FundingLevel | LegalForm | BudgetBand | ProbabilityBand | ProgramStatus | ProgramOrigin | Confidence | FundingOrgSubType | DeadlineType | MatchStatus`.
- Produces (tables): `funding_programs`, `funding_program_sources`, `org_funding_profiles`, `org_funding_matches`, and `accounts.foerder_outreach_opt_in`.

- [ ] **Step 1: Write the schema migration**

Create `supabase/migrations/20260724_foerdermittel_schema.sql`:

```sql
-- Fördermittel Agent — Plan 1 schema (funding catalog, org profile, matches, consent)

CREATE TABLE IF NOT EXISTS public.funding_programs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name              TEXT NOT NULL,
  provider          TEXT NOT NULL,
  level             TEXT NOT NULL DEFAULT 'sonstiges'
                      CHECK (level IN ('eu','bund','land','landkreis','lag','stiftung','kommune','sonstiges')),
  summary           TEXT NOT NULL DEFAULT '',
  description       TEXT NOT NULL DEFAULT '',
  target_sub_types  TEXT[] NOT NULL DEFAULT '{}',
  sector_tags       TEXT[] NOT NULL DEFAULT '{}',
  eligibility       JSONB NOT NULL DEFAULT '{}'::jsonb,
  amount_min        NUMERIC,
  amount_max        NUMERIC,
  funding_rate      TEXT,
  deadline          DATE,
  deadline_type     TEXT NOT NULL DEFAULT 'unknown'
                      CHECK (deadline_type IN ('fixed','rolling','annual','unknown')),
  source_url        TEXT NOT NULL,
  source_checked_at TIMESTAMPTZ,
  status            TEXT NOT NULL DEFAULT 'proposed'
                      CHECK (status IN ('curated','proposed','verified','archived')),
  confidence        TEXT NOT NULL DEFAULT 'medium'
                      CHECK (confidence IN ('high','medium','low')),
  origin            TEXT NOT NULL DEFAULT 'curated'
                      CHECK (origin IN ('curated','research_agent')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_funding_programs_status ON public.funding_programs(status);
ALTER TABLE public.funding_programs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "funding_programs_select" ON public.funding_programs FOR SELECT USING (true);
CREATE POLICY "funding_programs_insert" ON public.funding_programs FOR INSERT WITH CHECK (true);
CREATE POLICY "funding_programs_update" ON public.funding_programs FOR UPDATE USING (true);
CREATE POLICY "funding_programs_delete" ON public.funding_programs FOR DELETE USING (true);

CREATE TABLE IF NOT EXISTS public.funding_program_sources (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id  UUID NOT NULL REFERENCES public.funding_programs(id) ON DELETE CASCADE,
  url         TEXT NOT NULL,
  quote       TEXT NOT NULL DEFAULT '',
  fetched_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_funding_program_sources_program ON public.funding_program_sources(program_id);
ALTER TABLE public.funding_program_sources ENABLE ROW LEVEL SECURITY;
CREATE POLICY "funding_program_sources_all" ON public.funding_program_sources FOR ALL USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.org_funding_profiles (
  account_id           UUID PRIMARY KEY REFERENCES public.accounts(id) ON DELETE CASCADE,
  legal_form           TEXT NOT NULL DEFAULT 'unbekannt'
                         CHECK (legal_form IN ('ev','gmbh','ggmbh','gbr','ug','einzelunternehmen','sonstiges','unbekannt')),
  is_gemeinnuetzig     BOOLEAN,
  founded_year         INT,
  member_count         INT,
  budget_band          TEXT NOT NULL DEFAULT 'unbekannt'
                         CHECK (budget_band IN ('unter_5k','5k_25k','25k_100k','ueber_100k','unbekannt')),
  sector_tags          TEXT[] NOT NULL DEFAULT '{}',
  project_needs        TEXT NOT NULL DEFAULT '',
  goals                TEXT NOT NULL DEFAULT '',
  region               TEXT NOT NULL DEFAULT 'Röbel/Müritz',
  profile_completeness INT NOT NULL DEFAULT 0,
  last_interviewed_at  TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.org_funding_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org_funding_profiles_all" ON public.org_funding_profiles FOR ALL USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.org_funding_matches (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  program_id        UUID NOT NULL REFERENCES public.funding_programs(id) ON DELETE CASCADE,
  score             NUMERIC NOT NULL DEFAULT 0,
  probability_band  TEXT NOT NULL DEFAULT 'niedrig'
                      CHECK (probability_band IN ('hoch','mittel','niedrig')),
  rationale         TEXT NOT NULL DEFAULT '',
  requirements      TEXT NOT NULL DEFAULT '',
  red_flags         TEXT NOT NULL DEFAULT '',
  collapsed         BOOLEAN NOT NULL DEFAULT false,
  status            TEXT NOT NULL DEFAULT 'new'
                      CHECK (status IN ('new','seen','saved','dismissed','applying')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id, program_id)
);
CREATE INDEX IF NOT EXISTS idx_org_funding_matches_account ON public.org_funding_matches(account_id);
ALTER TABLE public.org_funding_matches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org_funding_matches_all" ON public.org_funding_matches FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS foerder_outreach_opt_in BOOLEAN NOT NULL DEFAULT true;
```

- [ ] **Step 2: Apply the migration via the Supabase MCP**

Call `mcp__supabase__apply_migration` with `project_id: "wwbeqhkslxdxhktqzqti"`, `name: "20260724_foerdermittel_schema"`, and `query` = the full SQL above.
Expected: success, no error.

- [ ] **Step 3: Verify the tables exist**

Call `mcp__supabase__list_tables` with `project_id: "wwbeqhkslxdxhktqzqti"`, `schemas: ["public"]`.
Expected: `funding_programs`, `funding_program_sources`, `org_funding_profiles`, `org_funding_matches` present; `accounts` now has `foerder_outreach_opt_in`.

- [ ] **Step 4: Write the types file**

Create `apps/web/src/types/foerdermittel.ts`:

```ts
// Hand-written domain types for the Fördermittel Agent (no generated DB types in this repo).

export type FundingLevel = "eu" | "bund" | "land" | "landkreis" | "lag" | "stiftung" | "kommune" | "sonstiges";
export type LegalForm = "ev" | "gmbh" | "ggmbh" | "gbr" | "ug" | "einzelunternehmen" | "sonstiges" | "unbekannt";
export type BudgetBand = "unter_5k" | "5k_25k" | "25k_100k" | "ueber_100k" | "unbekannt";
export type ProbabilityBand = "hoch" | "mittel" | "niedrig";
export type ProgramStatus = "curated" | "proposed" | "verified" | "archived";
export type ProgramOrigin = "curated" | "research_agent";
export type Confidence = "high" | "medium" | "low";
export type FundingOrgSubType = "verein" | "unternehmen" | "restaurant" | "stadt";
export type DeadlineType = "fixed" | "rolling" | "annual" | "unknown";
export type MatchStatus = "new" | "seen" | "saved" | "dismissed" | "applying";

export interface ProgramEligibility {
  legal_forms_allowed: LegalForm[]; // empty = any legal form
  gemeinnuetzig_required: boolean;
  min_members: number | null;
  max_members: number | null;
  region_scope: string[]; // e.g. ["bundesweit"] or ["MV", "Landkreis MSE"]
  project_types: string[];
  cofinancing_required: boolean;
  min_years_established: number | null;
}

export interface FundingProgram {
  id: string;
  name: string;
  provider: string;
  level: FundingLevel;
  summary: string;
  description: string;
  target_sub_types: FundingOrgSubType[];
  sector_tags: string[];
  eligibility: ProgramEligibility;
  amount_min: number | null;
  amount_max: number | null;
  funding_rate: string | null;
  deadline: string | null;
  deadline_type: DeadlineType;
  source_url: string;
  source_checked_at: string | null;
  status: ProgramStatus;
  confidence: Confidence;
  origin: ProgramOrigin;
  created_at: string;
  updated_at: string;
}

export interface OrgFundingProfile {
  account_id: string;
  legal_form: LegalForm;
  is_gemeinnuetzig: boolean | null;
  founded_year: number | null;
  member_count: number | null;
  budget_band: BudgetBand;
  sector_tags: string[];
  project_needs: string;
  goals: string;
  region: string;
  profile_completeness: number;
  last_interviewed_at: string | null;
}

/** What the matching engine consumes: the DB profile + the org's sub_type (from accounts) + an injected current year (keeps pure fns free of Date.now). */
export interface MatchInput {
  profile: OrgFundingProfile;
  sub_type: FundingOrgSubType;
  current_year: number;
}

export interface FitResult {
  probability_band: ProbabilityBand;
  score: number; // 0..100 (clamped in code, not schema)
  rationale: string;
  requirements: string;
  red_flags: string;
}

export interface RankedMatch extends FitResult {
  program_id: string;
  program_name: string;
  source_url: string;
  deadline: string | null;
  amount_min: number | null;
  amount_max: number | null;
  collapsed: boolean; // true for niedrig — surfaced collapsed, never hidden
}
```

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter web exec tsc --noEmit` (or from `apps/web`: `pnpm exec tsc --noEmit`).
Expected: no NEW errors referencing `apps/web/src/types/foerdermittel.ts`. (The repo has pre-existing unrelated tsc errors; only ensure the new file introduces none.)

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260724_foerdermittel_schema.sql apps/web/src/types/foerdermittel.ts
git commit -m "feat(foerdermittel): schema (programs, sources, profile, matches) + consent flag + types"
git push
```

---

### Task 2: Deterministic eligibility filter (TDD)

**Files:**
- Create: `apps/web/src/lib/foerdermittel/eligibility.ts`
- Test: `apps/web/tests/foerdermittel-eligibility.test.ts`

**Interfaces:**
- Consumes: `FundingProgram`, `MatchInput` from `@/types/foerdermittel`.
- Produces: `filterEligiblePrograms(input: MatchInput, programs: FundingProgram[]): EligibilityResult[]` and `interface EligibilityResult { program: FundingProgram; eligible: boolean; failed_rules: string[] }`. Honesty rule: an **unknown** profile value (null `is_gemeinnuetzig`, null `member_count`, null `founded_year`, `legal_form === "unbekannt"`) never hard-fails — only a **known** contradiction fails.

- [ ] **Step 1: Write the failing test**

Create `apps/web/tests/foerdermittel-eligibility.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { filterEligiblePrograms } from "../src/lib/foerdermittel/eligibility";
import type { FundingProgram, MatchInput, ProgramEligibility, FundingOrgSubType } from "../src/types/foerdermittel";

function elig(partial: Partial<ProgramEligibility> = {}): ProgramEligibility {
  return {
    legal_forms_allowed: [], gemeinnuetzig_required: false,
    min_members: null, max_members: null, region_scope: ["bundesweit"],
    project_types: [], cofinancing_required: false, min_years_established: null,
    ...partial,
  };
}
function program(id: string, target: FundingOrgSubType[], eligibility: ProgramEligibility): FundingProgram {
  return {
    id, name: `P-${id}`, provider: "X", level: "bund", summary: "", description: "",
    target_sub_types: target, sector_tags: [], eligibility,
    amount_min: null, amount_max: null, funding_rate: null, deadline: null,
    deadline_type: "unknown", source_url: "https://example.org", source_checked_at: null,
    status: "verified", confidence: "medium", origin: "curated",
    created_at: "", updated_at: "",
  };
}
function input(over: Partial<MatchInput["profile"]> = {}, sub_type: FundingOrgSubType = "verein", current_year = 2026): MatchInput {
  return {
    sub_type, current_year,
    profile: {
      account_id: "a1", legal_form: "ev", is_gemeinnuetzig: true, founded_year: 2010,
      member_count: 40, budget_band: "5k_25k", sector_tags: ["youth"],
      project_needs: "", goals: "", region: "Röbel/Müritz", profile_completeness: 80,
      last_interviewed_at: null, ...over,
    },
  };
}

test("known gemeinnützig=false fails a gemeinnützig-required program", () => {
  const r = filterEligiblePrograms(input({ legal_form: "gbr", is_gemeinnuetzig: false }),
    [program("p1", ["verein", "unternehmen"], elig({ gemeinnuetzig_required: true }))]);
  assert.equal(r[0].eligible, false);
  assert.ok(r[0].failed_rules.some((s) => s.toLowerCase().includes("gemeinnütz")));
});

test("eligible youth Verein passes a matching bundesweit program", () => {
  const r = filterEligiblePrograms(input(),
    [program("p2", ["verein"], elig({ gemeinnuetzig_required: true }))]);
  assert.equal(r[0].eligible, true);
  assert.deepEqual(r[0].failed_rules, []);
});

test("region mismatch fails", () => {
  const r = filterEligiblePrograms(input(),
    [program("p3", ["verein"], elig({ region_scope: ["Bayern"] }))]);
  assert.equal(r[0].eligible, false);
  assert.ok(r[0].failed_rules.some((s) => s.toLowerCase().includes("region")));
});

test("sub_type mismatch fails", () => {
  const r = filterEligiblePrograms(input({}, "verein"),
    [program("p4", ["unternehmen"], elig())]);
  assert.equal(r[0].eligible, false);
  assert.ok(r[0].failed_rules.some((s) => s.toLowerCase().includes("organisationsart")));
});

test("min_years unmet fails; unknown founding year does not", () => {
  const tooYoung = filterEligiblePrograms(input({ founded_year: 2025 }),
    [program("p5", ["verein"], elig({ min_years_established: 3 }))]);
  assert.equal(tooYoung[0].eligible, false);
  const unknown = filterEligiblePrograms(input({ founded_year: null }),
    [program("p5", ["verein"], elig({ min_years_established: 3 }))]);
  assert.equal(unknown[0].eligible, true);
});

test("unknown gemeinnützig (null) is not hard-failed", () => {
  const r = filterEligiblePrograms(input({ is_gemeinnuetzig: null }),
    [program("p6", ["verein"], elig({ gemeinnuetzig_required: true }))]);
  assert.equal(r[0].eligible, true);
});

test("empty target_sub_types matches any org type", () => {
  const r = filterEligiblePrograms(input({}, "stadt"),
    [program("p7", [], elig())]);
  assert.equal(r[0].eligible, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec tsx --test apps/web/tests/foerdermittel-eligibility.test.ts`
Expected: FAIL — cannot find module `../src/lib/foerdermittel/eligibility`.

- [ ] **Step 3: Write the implementation**

Create `apps/web/src/lib/foerdermittel/eligibility.ts`:

```ts
import type { FundingProgram, MatchInput } from "@/types/foerdermittel";

export interface EligibilityResult {
  program: FundingProgram;
  eligible: boolean;
  failed_rules: string[];
}

// Region tokens that count as always-eligible regardless of the org's location.
const NATIONAL_TOKENS = ["bundesweit", "deutschlandweit", "eu", "europaweit"];
// Tokens that describe Röbel's location; a program's region_scope must intersect these.
const LOCAL_TOKENS = [
  "mv", "mecklenburg-vorpommern", "mecklenburg vorpommern",
  "landkreis mse", "mecklenburgische seenplatte", "müritz", "muritz", "röbel", "roebel",
];

function regionEligible(scope: string[]): boolean {
  if (scope.length === 0) return true;
  const lower = scope.map((s) => s.toLowerCase().trim());
  if (lower.some((s) => NATIONAL_TOKENS.includes(s))) return true;
  return lower.some((s) => LOCAL_TOKENS.some((loc) => s.includes(loc) || loc.includes(s)));
}

export function filterEligiblePrograms(input: MatchInput, programs: FundingProgram[]): EligibilityResult[] {
  const { profile, sub_type, current_year } = input;
  return programs.map((program) => {
    const e = program.eligibility;
    const failed: string[] = [];

    if (program.target_sub_types.length > 0 && !program.target_sub_types.includes(sub_type)) {
      failed.push(`Organisationsart ${sub_type} nicht förderfähig`);
    }
    if (e.legal_forms_allowed.length > 0 && profile.legal_form !== "unbekannt"
        && !e.legal_forms_allowed.includes(profile.legal_form)) {
      failed.push(`Rechtsform ${profile.legal_form} nicht zugelassen`);
    }
    if (e.gemeinnuetzig_required && profile.is_gemeinnuetzig === false) {
      failed.push("Gemeinnützigkeit erforderlich");
    }
    if (!regionEligible(e.region_scope)) {
      failed.push("Region nicht im Fördergebiet");
    }
    if (e.min_members !== null && profile.member_count !== null && profile.member_count < e.min_members) {
      failed.push(`Mindestens ${e.min_members} Mitglieder erforderlich`);
    }
    if (e.max_members !== null && profile.member_count !== null && profile.member_count > e.max_members) {
      failed.push(`Höchstens ${e.max_members} Mitglieder zulässig`);
    }
    if (e.min_years_established !== null && profile.founded_year !== null
        && current_year - profile.founded_year < e.min_years_established) {
      failed.push(`Organisation muss mindestens ${e.min_years_established} Jahre bestehen`);
    }

    return { program, eligible: failed.length === 0, failed_rules: failed };
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec tsx --test apps/web/tests/foerdermittel-eligibility.test.ts`
Expected: PASS (all 7 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/foerdermittel/eligibility.ts apps/web/tests/foerdermittel-eligibility.test.ts
git commit -m "feat(foerdermittel): deterministic eligibility hard-filter + golden tests"
git push
```

---

### Task 3: Fit ranking with injected LLM (TDD)

**Files:**
- Create: `apps/web/src/lib/foerdermittel/matching.ts`
- Test: `apps/web/tests/foerdermittel-matching.test.ts`

**Interfaces:**
- Consumes: `FundingProgram`, `MatchInput`, `FitResult`, `RankedMatch` from `@/types/foerdermittel`.
- Produces: `type GenerateFit = (input: MatchInput, program: FundingProgram) => Promise<FitResult>` and `rankMatches(input: MatchInput, eligible: FundingProgram[], deps: { generateFit: GenerateFit }): Promise<RankedMatch[]>`. Order: band priority (`hoch` > `mittel` > `niedrig`), then `score` desc. `collapsed = band === "niedrig"`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/tests/foerdermittel-matching.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { rankMatches, type GenerateFit } from "../src/lib/foerdermittel/matching";
import type { FundingProgram, MatchInput, FitResult, ProbabilityBand } from "../src/types/foerdermittel";

function program(id: string): FundingProgram {
  return {
    id, name: `P-${id}`, provider: "X", level: "bund", summary: "", description: "",
    target_sub_types: ["verein"], sector_tags: [], eligibility: {
      legal_forms_allowed: [], gemeinnuetzig_required: false, min_members: null, max_members: null,
      region_scope: ["bundesweit"], project_types: [], cofinancing_required: false, min_years_established: null,
    },
    amount_min: 1000, amount_max: 5000, funding_rate: null, deadline: "2026-12-01",
    deadline_type: "fixed", source_url: `https://example.org/${id}`, source_checked_at: null,
    status: "verified", confidence: "medium", origin: "curated", created_at: "", updated_at: "",
  };
}
const input: MatchInput = {
  sub_type: "verein", current_year: 2026,
  profile: {
    account_id: "a1", legal_form: "ev", is_gemeinnuetzig: true, founded_year: 2010, member_count: 40,
    budget_band: "5k_25k", sector_tags: [], project_needs: "", goals: "", region: "Röbel/Müritz",
    profile_completeness: 80, last_interviewed_at: null,
  },
};
function fakeFit(bands: Record<string, [ProbabilityBand, number]>): GenerateFit {
  return async (_i, p) => {
    const [band, score] = bands[p.id];
    const r: FitResult = { probability_band: band, score, rationale: `r-${p.id}`, requirements: "", red_flags: "" };
    return r;
  };
}

test("ranks by band then score and marks niedrig collapsed", async () => {
  const programs = [program("a"), program("b"), program("c")];
  const gen = fakeFit({ a: ["niedrig", 90], b: ["hoch", 50], c: ["mittel", 80] });
  const out = await rankMatches(input, programs, { generateFit: gen });
  assert.deepEqual(out.map((m) => m.program_id), ["b", "c", "a"]);
  assert.equal(out[0].probability_band, "hoch");
  assert.equal(out[2].collapsed, true);
  assert.equal(out[0].collapsed, false);
});

test("carries source_url, deadline, amounts, and rationale through", async () => {
  const out = await rankMatches(input, [program("a")], { generateFit: fakeFit({ a: ["hoch", 70] }) });
  assert.equal(out[0].source_url, "https://example.org/a");
  assert.equal(out[0].deadline, "2026-12-01");
  assert.equal(out[0].amount_min, 1000);
  assert.equal(out[0].rationale, "r-a");
});

test("empty eligible list yields no matches and no LLM calls", async () => {
  let calls = 0;
  const gen: GenerateFit = async (_i, p) => { calls++; return { probability_band: "hoch", score: 1, rationale: "", requirements: "", red_flags: "" }; };
  const out = await rankMatches(input, [], { generateFit: gen });
  assert.deepEqual(out, []);
  assert.equal(calls, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec tsx --test apps/web/tests/foerdermittel-matching.test.ts`
Expected: FAIL — cannot find module `../src/lib/foerdermittel/matching`.

- [ ] **Step 3: Write the implementation**

Create `apps/web/src/lib/foerdermittel/matching.ts`:

```ts
import type { FundingProgram, MatchInput, FitResult, RankedMatch, ProbabilityBand } from "@/types/foerdermittel";

export type GenerateFit = (input: MatchInput, program: FundingProgram) => Promise<FitResult>;

const BAND_RANK: Record<ProbabilityBand, number> = { hoch: 3, mittel: 2, niedrig: 1 };

export async function rankMatches(
  input: MatchInput,
  eligible: FundingProgram[],
  deps: { generateFit: GenerateFit },
): Promise<RankedMatch[]> {
  const matches: RankedMatch[] = [];
  for (const program of eligible) {
    const fit = await deps.generateFit(input, program);
    matches.push({
      ...fit,
      program_id: program.id,
      program_name: program.name,
      source_url: program.source_url,
      deadline: program.deadline,
      amount_min: program.amount_min,
      amount_max: program.amount_max,
      collapsed: fit.probability_band === "niedrig",
    });
  }
  matches.sort((a, b) => {
    const byBand = BAND_RANK[b.probability_band] - BAND_RANK[a.probability_band];
    return byBand !== 0 ? byBand : b.score - a.score;
  });
  return matches;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec tsx --test apps/web/tests/foerdermittel-matching.test.ts`
Expected: PASS (all 3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/foerdermittel/matching.ts apps/web/tests/foerdermittel-matching.test.ts
git commit -m "feat(foerdermittel): fit ranking with injected LLM seam + tests"
git push
```

---

### Task 4: Fit prompt builder + real Opus adapter

**Files:**
- Create: `apps/web/src/lib/foerdermittel/fit-prompt.ts`
- Create: `apps/web/src/lib/foerdermittel/fit-generator.ts`
- Test: `apps/web/tests/foerdermittel-fit-prompt.test.ts`

**Interfaces:**
- Consumes: `MatchInput`, `FundingProgram`, `FitResult` from `@/types/foerdermittel`; `GenerateFit` type shape from `./matching`.
- Produces: `buildFitPrompt(input: MatchInput, program: FundingProgram): string`, `FIT_SYSTEM_PROMPT: string` (pure, tested), and `generateFitWithClaude: GenerateFit` (real `generateObject` adapter using `anthropic("claude-opus-4-8")`; wiring, not unit-tested).

- [ ] **Step 1: Write the failing test**

Create `apps/web/tests/foerdermittel-fit-prompt.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildFitPrompt, FIT_SYSTEM_PROMPT } from "../src/lib/foerdermittel/fit-prompt";
import type { FundingProgram, MatchInput } from "../src/types/foerdermittel";

const program: FundingProgram = {
  id: "p1", name: "Ehrenamt-Topf", provider: "DSEE", level: "bund",
  summary: "Förderung für Vereine", description: "Details ...",
  target_sub_types: ["verein"], sector_tags: ["ehrenamt"], eligibility: {
    legal_forms_allowed: ["ev"], gemeinnuetzig_required: true, min_members: null, max_members: null,
    region_scope: ["bundesweit"], project_types: [], cofinancing_required: false, min_years_established: null,
  },
  amount_min: 1000, amount_max: 5000, funding_rate: null, deadline: "2026-12-01",
  deadline_type: "fixed", source_url: "https://dsee.example/foerderung", source_checked_at: null,
  status: "verified", confidence: "medium", origin: "curated", created_at: "", updated_at: "",
};
const input: MatchInput = {
  sub_type: "verein", current_year: 2026,
  profile: {
    account_id: "a1", legal_form: "ev", is_gemeinnuetzig: true, founded_year: 2010, member_count: 40,
    budget_band: "5k_25k", sector_tags: ["jugend"],
    project_needs: "Wir wollen einen neuen Jugendraum einrichten.", goals: "Mehr Jugendarbeit",
    region: "Röbel/Müritz", profile_completeness: 80, last_interviewed_at: null,
  },
};

test("prompt grounds on the program source and the org's project", () => {
  const p = buildFitPrompt(input, program);
  assert.ok(p.includes("https://dsee.example/foerderung"));
  assert.ok(p.includes("Ehrenamt-Topf"));
  assert.ok(p.includes("Jugendraum"));
});

test("prompt and system enforce honesty and the three probability bands", () => {
  const p = buildFitPrompt(input, program);
  assert.ok(/hoch/.test(p) && /mittel/.test(p) && /niedrig/.test(p));
  assert.ok(/ehrlich/i.test(FIT_SYSTEM_PROMPT));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec tsx --test apps/web/tests/foerdermittel-fit-prompt.test.ts`
Expected: FAIL — cannot find module `../src/lib/foerdermittel/fit-prompt`.

- [ ] **Step 3: Write the prompt builder**

Create `apps/web/src/lib/foerdermittel/fit-prompt.ts`:

```ts
import type { MatchInput, FundingProgram } from "@/types/foerdermittel";

export const FIT_SYSTEM_PROMPT = [
  "Du bist Meckys Fördermittel-Experte für Röbel/Müritz.",
  "Bewerte ehrlich, ob diese Organisation realistisch Chancen auf dieses Förderprogramm hat.",
  "Sei nüchtern: lieber 'niedrig' als falsche Hoffnung. Erfinde niemals Bedingungen, Fristen oder Summen.",
  "Stütze dich NUR auf die angegebenen Programmdaten und die Organisationsdaten.",
  "Antworte mit: probability_band (hoch|mittel|niedrig), score 0-100, rationale (warum es passt/nicht passt),",
  "requirements (was die Organisation für die Bewerbung braucht) und red_flags (Ausschlussrisiken).",
].join(" ");

export function buildFitPrompt(input: MatchInput, program: FundingProgram): string {
  const { profile, sub_type, current_year } = input;
  const e = program.eligibility;
  return [
    "## Organisation",
    `Art: ${sub_type}`,
    `Rechtsform: ${profile.legal_form}`,
    `Gemeinnützig: ${profile.is_gemeinnuetzig === null ? "unbekannt" : profile.is_gemeinnuetzig ? "ja" : "nein"}`,
    `Gegründet: ${profile.founded_year ?? "unbekannt"} (aktuelles Jahr: ${current_year})`,
    `Mitglieder: ${profile.member_count ?? "unbekannt"}`,
    `Jahresbudget: ${profile.budget_band}`,
    `Region: ${profile.region}`,
    `Themen: ${profile.sector_tags.join(", ") || "—"}`,
    `Vorhaben/Bedarf: ${profile.project_needs || "—"}`,
    `Ziele: ${profile.goals || "—"}`,
    "",
    "## Förderprogramm",
    `Name: ${program.name} (${program.provider})`,
    `Kurzbeschreibung: ${program.summary}`,
    `Zielgruppen: ${program.target_sub_types.join(", ") || "alle"}`,
    `Themen: ${program.sector_tags.join(", ") || "—"}`,
    `Rechtsformen zugelassen: ${e.legal_forms_allowed.join(", ") || "alle"}`,
    `Gemeinnützigkeit erforderlich: ${e.gemeinnuetzig_required ? "ja" : "nein"}`,
    `Region: ${e.region_scope.join(", ") || "—"}`,
    `Kofinanzierung nötig: ${e.cofinancing_required ? "ja" : "nein"}`,
    `Fördersumme: ${program.amount_min ?? "?"}–${program.amount_max ?? "?"} EUR`,
    `Frist: ${program.deadline ?? "unbekannt"} (${program.deadline_type})`,
    `Quelle: ${program.source_url}`,
    "",
    "Bewerte die Passung ehrlich (hoch/mittel/niedrig) und begründe kurz.",
  ].join("\n");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec tsx --test apps/web/tests/foerdermittel-fit-prompt.test.ts`
Expected: PASS (both tests).

- [ ] **Step 5: Write the real Opus adapter**

Create `apps/web/src/lib/foerdermittel/fit-generator.ts`:

```ts
import { generateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import type { MatchInput, FundingProgram, FitResult } from "@/types/foerdermittel";
import type { GenerateFit } from "./matching";
import { buildFitPrompt, FIT_SYSTEM_PROMPT } from "./fit-prompt";

// NOTE: no .min()/.max() on the number field — @ai-sdk/anthropic rejects integer minimum/maximum (400). Clamp below.
const FitSchema = z.object({
  probability_band: z.enum(["hoch", "mittel", "niedrig"]),
  score: z.number().describe("0 bis 100"),
  rationale: z.string(),
  requirements: z.string(),
  red_flags: z.string(),
});

export const generateFitWithClaude: GenerateFit = async (
  input: MatchInput,
  program: FundingProgram,
): Promise<FitResult> => {
  const { object } = await generateObject({
    model: anthropic("claude-opus-4-8"),
    schema: FitSchema,
    system: FIT_SYSTEM_PROMPT,
    prompt: buildFitPrompt(input, program),
  });
  const score = Math.max(0, Math.min(100, Math.round(object.score)));
  return { ...object, score };
};
```

- [ ] **Step 6: Typecheck the adapter**

Run (from `apps/web`): `pnpm exec tsc --noEmit`
Expected: no new errors in `fit-generator.ts` / `fit-prompt.ts`.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/foerdermittel/fit-prompt.ts apps/web/src/lib/foerdermittel/fit-generator.ts apps/web/tests/foerdermittel-fit-prompt.test.ts
git commit -m "feat(foerdermittel): grounded fit prompt + Opus generateObject adapter"
git push
```

---

### Task 5: Match orchestrator + real sources + server action

**Files:**
- Create: `apps/web/src/lib/foerdermittel/run-match.ts`
- Create: `apps/web/src/lib/foerdermittel/sources.ts`
- Create: `apps/web/src/app/actions/foerdermittel.ts`
- Test: `apps/web/tests/foerdermittel-run-match.test.ts`

**Interfaces:**
- Consumes: `filterEligiblePrograms` (Task 2), `rankMatches` + `GenerateFit` (Task 3), `generateFitWithClaude` (Task 4), `MatchInput`, `FundingProgram`, `RankedMatch` from `@/types/foerdermittel`; `createAdminClient` from `@/lib/supabase/admin`; `createClient` from `@/lib/supabase/server`.
- Produces:
  - `interface MatchSources { loadMatchInput(accountId): Promise<MatchInput | null>; loadVerifiedPrograms(): Promise<FundingProgram[]>; saveMatches(accountId, matches): Promise<void>; }`
  - `interface RunMatchResult { ok: boolean; reason?: "no_profile" | "incomplete_profile"; matches: RankedMatch[]; }`
  - `runFundingMatch(accountId: string, deps: MatchSources & { generateFit: GenerateFit; minCompleteness?: number }): Promise<RunMatchResult>` (pure orchestration; default `minCompleteness = 40`).
  - `createMatchSources(): MatchSources` (real Supabase adapter).
  - `runFundingMatchAction(accountId: string, walletAddress: string): Promise<{ success: boolean; error?: string; matches?: RankedMatch[] }>` (server action; owner check via `account_owners`).

- [ ] **Step 1: Write the failing test**

Create `apps/web/tests/foerdermittel-run-match.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { runFundingMatch, type MatchSources } from "../src/lib/foerdermittel/run-match";
import type { GenerateFit } from "../src/lib/foerdermittel/matching";
import type { FundingProgram, MatchInput, RankedMatch } from "../src/types/foerdermittel";

function program(id: string, gemeinnuetzigRequired: boolean): FundingProgram {
  return {
    id, name: `P-${id}`, provider: "X", level: "bund", summary: "", description: "",
    target_sub_types: ["verein"], sector_tags: [], eligibility: {
      legal_forms_allowed: [], gemeinnuetzig_required: gemeinnuetzigRequired, min_members: null, max_members: null,
      region_scope: ["bundesweit"], project_types: [], cofinancing_required: false, min_years_established: null,
    },
    amount_min: null, amount_max: null, funding_rate: null, deadline: null, deadline_type: "unknown",
    source_url: `https://example.org/${id}`, source_checked_at: null, status: "verified",
    confidence: "medium", origin: "curated", created_at: "", updated_at: "",
  };
}
function makeInput(completeness: number, gemeinnuetzig: boolean | null): MatchInput {
  return {
    sub_type: "verein", current_year: 2026,
    profile: {
      account_id: "a1", legal_form: "ev", is_gemeinnuetzig: gemeinnuetzig, founded_year: 2010, member_count: 40,
      budget_band: "5k_25k", sector_tags: [], project_needs: "x", goals: "y", region: "Röbel/Müritz",
      profile_completeness: completeness, last_interviewed_at: null,
    },
  };
}
const gen: GenerateFit = async () => ({ probability_band: "hoch", score: 80, rationale: "ok", requirements: "", red_flags: "" });

function sources(input: MatchInput | null, programs: FundingProgram[], saved: RankedMatch[][]): MatchSources {
  return {
    async loadMatchInput() { return input; },
    async loadVerifiedPrograms() { return programs; },
    async saveMatches(_a, m) { saved.push(m); },
  };
}

test("no profile short-circuits without saving", async () => {
  const saved: RankedMatch[][] = [];
  const r = await runFundingMatch("a1", { ...sources(null, [], saved), generateFit: gen });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "no_profile");
  assert.equal(saved.length, 0);
});

test("incomplete profile short-circuits", async () => {
  const saved: RankedMatch[][] = [];
  const r = await runFundingMatch("a1", { ...sources(makeInput(10, true), [program("p", false)], saved), generateFit: gen });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "incomplete_profile");
  assert.equal(saved.length, 0);
});

test("filters ineligible, ranks eligible, and persists", async () => {
  const saved: RankedMatch[][] = [];
  // gemeinnützig=false org; p1 requires gemeinnützig (ineligible), p2 does not (eligible)
  const r = await runFundingMatch("a1", {
    ...sources(makeInput(80, false), [program("p1", true), program("p2", false)], saved),
    generateFit: gen,
  });
  assert.equal(r.ok, true);
  assert.deepEqual(r.matches.map((m) => m.program_id), ["p2"]);
  assert.equal(saved.length, 1);
  assert.deepEqual(saved[0].map((m) => m.program_id), ["p2"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec tsx --test apps/web/tests/foerdermittel-run-match.test.ts`
Expected: FAIL — cannot find module `../src/lib/foerdermittel/run-match`.

- [ ] **Step 3: Write the orchestrator**

Create `apps/web/src/lib/foerdermittel/run-match.ts`:

```ts
import type { MatchInput, FundingProgram, RankedMatch } from "@/types/foerdermittel";
import { filterEligiblePrograms } from "./eligibility";
import { rankMatches, type GenerateFit } from "./matching";

export interface MatchSources {
  loadMatchInput(accountId: string): Promise<MatchInput | null>;
  loadVerifiedPrograms(): Promise<FundingProgram[]>;
  saveMatches(accountId: string, matches: RankedMatch[]): Promise<void>;
}

export interface RunMatchResult {
  ok: boolean;
  reason?: "no_profile" | "incomplete_profile";
  matches: RankedMatch[];
}

export async function runFundingMatch(
  accountId: string,
  deps: MatchSources & { generateFit: GenerateFit; minCompleteness?: number },
): Promise<RunMatchResult> {
  const minCompleteness = deps.minCompleteness ?? 40;
  const input = await deps.loadMatchInput(accountId);
  if (!input) return { ok: false, reason: "no_profile", matches: [] };
  if (input.profile.profile_completeness < minCompleteness) {
    return { ok: false, reason: "incomplete_profile", matches: [] };
  }
  const programs = await deps.loadVerifiedPrograms();
  const eligible = filterEligiblePrograms(input, programs)
    .filter((r) => r.eligible)
    .map((r) => r.program);
  const matches = await rankMatches(input, eligible, { generateFit: deps.generateFit });
  await deps.saveMatches(accountId, matches);
  return { ok: true, matches };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec tsx --test apps/web/tests/foerdermittel-run-match.test.ts`
Expected: PASS (all 3 tests).

- [ ] **Step 5: Write the real Supabase sources adapter**

Create `apps/web/src/lib/foerdermittel/sources.ts`:

```ts
import { createAdminClient } from "@/lib/supabase/admin";
import type { MatchInput, FundingProgram, RankedMatch, OrgFundingProfile, FundingOrgSubType } from "@/types/foerdermittel";
import type { MatchSources } from "./run-match";

const FUNDING_SUB_TYPES: FundingOrgSubType[] = ["verein", "unternehmen", "restaurant", "stadt"];

export function createMatchSources(): MatchSources {
  const supabase = createAdminClient();
  return {
    async loadMatchInput(accountId: string): Promise<MatchInput | null> {
      const { data: profile } = await supabase
        .from("org_funding_profiles").select("*").eq("account_id", accountId).maybeSingle();
      if (!profile) return null;
      const { data: account } = await supabase
        .from("accounts").select("sub_type").eq("id", accountId).maybeSingle();
      const sub = (account?.sub_type ?? "verein") as string;
      const sub_type = (FUNDING_SUB_TYPES as string[]).includes(sub) ? (sub as FundingOrgSubType) : "verein";
      return {
        profile: profile as OrgFundingProfile,
        sub_type,
        current_year: new Date().getUTCFullYear(),
      };
    },
    async loadVerifiedPrograms(): Promise<FundingProgram[]> {
      const { data } = await supabase.from("funding_programs").select("*").eq("status", "verified");
      return (data ?? []) as FundingProgram[];
    },
    async saveMatches(accountId: string, matches: RankedMatch[]): Promise<void> {
      // Refresh: drop prior auto-generated 'new' matches, keep user-touched states (saved/dismissed/applying).
      await supabase.from("org_funding_matches").delete().eq("account_id", accountId).eq("status", "new");
      if (matches.length === 0) return;
      const rows = matches.map((m) => ({
        account_id: accountId, program_id: m.program_id, score: m.score,
        probability_band: m.probability_band, rationale: m.rationale, requirements: m.requirements,
        red_flags: m.red_flags, collapsed: m.collapsed, status: "new",
      }));
      await supabase.from("org_funding_matches")
        .upsert(rows, { onConflict: "account_id,program_id", ignoreDuplicates: true });
    },
  };
}
```

- [ ] **Step 6: Write the server action**

Create `apps/web/src/app/actions/foerdermittel.ts`:

```ts
"use server";

import { createClient } from "@/lib/supabase/server";
import { createMatchSources } from "@/lib/foerdermittel/sources";
import { runFundingMatch } from "@/lib/foerdermittel/run-match";
import { generateFitWithClaude } from "@/lib/foerdermittel/fit-generator";
import type { RankedMatch } from "@/types/foerdermittel";

export async function runFundingMatchAction(
  accountId: string,
  walletAddress: string,
): Promise<{ success: boolean; error?: string; matches?: RankedMatch[] }> {
  try {
    const supabase = await createClient();
    const { data: owner } = await supabase
      .from("account_owners").select("role")
      .eq("account_id", accountId).eq("wallet_address", walletAddress.toLowerCase()).maybeSingle();
    if (!owner) return { success: false, error: "Keine Berechtigung für diese Organisation" };

    const result = await runFundingMatch(accountId, {
      ...createMatchSources(),
      generateFit: generateFitWithClaude,
    });
    if (!result.ok) {
      const error = result.reason === "no_profile"
        ? "Bitte zuerst das Förderprofil ausfüllen."
        : "Das Förderprofil ist noch zu unvollständig für einen Abgleich.";
      return { success: false, error };
    }
    return { success: true, matches: result.matches };
  } catch (error) {
    console.error("runFundingMatchAction failed", error);
    return { success: false, error: "Der Förderabgleich ist fehlgeschlagen." };
  }
}
```

- [ ] **Step 7: Typecheck the wiring**

Run (from `apps/web`): `pnpm exec tsc --noEmit`
Expected: no new errors in `run-match.ts`, `sources.ts`, `actions/foerdermittel.ts`.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/lib/foerdermittel/run-match.ts apps/web/src/lib/foerdermittel/sources.ts apps/web/src/app/actions/foerdermittel.ts apps/web/tests/foerdermittel-run-match.test.ts
git commit -m "feat(foerdermittel): match orchestrator + Supabase sources + server action"
git push
```

---

### Task 6: Curated core seed

**Files:**
- Create: `supabase/migrations/20260724_foerdermittel_seed.sql`

**Interfaces:**
- Consumes: `funding_programs` + `funding_program_sources` tables (Task 1).
- Produces: an initial curated core of real, rural-MV-relevant programs as `status='verified'`, so the matching engine has data to run against.

**Honesty guardrail (Global Constraints):** these rows carry **real program names + real official source URLs + conservative structural eligibility only**. Any specific amount/deadline that is not certain stays `NULL` and `deadline_type='unknown'`; `source_checked_at` is left `NULL` so the later refresh/verification pass (Plan 4) knows to confirm. This is the "curated core" of decision #1 — a human curator should still review/enrich these (spec §10) before relying on exact figures.

- [ ] **Step 1: Write the seed migration**

Create `supabase/migrations/20260724_foerdermittel_seed.sql`:

```sql
-- Fördermittel Agent — curated core (real programs, conservative structural data, human-verify before relying on exact figures)

INSERT INTO public.funding_programs
  (name, provider, level, summary, target_sub_types, sector_tags, eligibility, deadline_type, source_url, status, confidence, origin)
VALUES
  ('DSEE-Förderprogramme', 'Deutsche Stiftung für Engagement und Ehrenamt', 'bund',
   'Förderung für gemeinnützige Vereine und Engagement-Organisationen (Strukturstärkung, Digitalisierung, Qualifizierung).',
   ARRAY['verein'], ARRAY['ehrenamt','digitalisierung','engagement'],
   '{"legal_forms_allowed":["ev","ggmbh"],"gemeinnuetzig_required":true,"min_members":null,"max_members":null,"region_scope":["bundesweit"],"project_types":["strukturstaerkung","digitalisierung","qualifizierung"],"cofinancing_required":false,"min_years_established":null}'::jsonb,
   'rolling', 'https://www.deutsche-stiftung-engagement-und-ehrenamt.de/foerderung/', 'verified', 'medium', 'curated'),

  ('Aktion Mensch Förderung', 'Aktion Mensch e.V.', 'stiftung',
   'Förderung sozialer Projekte und Inklusion durch gemeinnützige Organisationen.',
   ARRAY['verein'], ARRAY['soziales','inklusion','teilhabe'],
   '{"legal_forms_allowed":["ev","ggmbh"],"gemeinnuetzig_required":true,"min_members":null,"max_members":null,"region_scope":["bundesweit"],"project_types":["inklusion","soziales"],"cofinancing_required":false,"min_years_established":null}'::jsonb,
   'rolling', 'https://www.aktion-mensch.de/foerderung', 'verified', 'medium', 'curated'),

  ('LEADER – LAG Mecklenburgische Seenplatte – Müritz', 'LEADER / LAG Mecklenburgische Seenplatte', 'lag',
   'Regionale EU-Förderung (ELER) für Projekte der ländlichen Entwicklung in der Mecklenburgischen Seenplatte.',
   ARRAY['verein','unternehmen','stadt'], ARRAY['laendliche_entwicklung','regional','tourismus'],
   '{"legal_forms_allowed":[],"gemeinnuetzig_required":false,"min_members":null,"max_members":null,"region_scope":["Landkreis MSE","Mecklenburgische Seenplatte"],"project_types":["laendliche_entwicklung"],"cofinancing_required":true,"min_years_established":null}'::jsonb,
   'unknown', 'https://www.leader-mse.de/', 'verified', 'low', 'curated'),

  ('Ehrenamtsstiftung MV – Förderungen', 'Ehrenamtsstiftung Mecklenburg-Vorpommern', 'land',
   'Landesförderung für ehrenamtliches Engagement und Vereine in Mecklenburg-Vorpommern.',
   ARRAY['verein'], ARRAY['ehrenamt','engagement'],
   '{"legal_forms_allowed":["ev"],"gemeinnuetzig_required":true,"min_members":null,"max_members":null,"region_scope":["MV","Mecklenburg-Vorpommern"],"project_types":["ehrenamt"],"cofinancing_required":false,"min_years_established":null}'::jsonb,
   'rolling', 'https://www.ehrenamtsstiftung-mv.de/', 'verified', 'medium', 'curated'),

  ('Demokratie leben!', 'Bundesministerium für Familie, Senioren, Frauen und Jugend (BMFSFJ)', 'bund',
   'Bundesprogramm zur Förderung von Demokratie, Vielfalt und gegen Extremismus.',
   ARRAY['verein','stadt'], ARRAY['demokratie','vielfalt','jugend','integration'],
   '{"legal_forms_allowed":[],"gemeinnuetzig_required":true,"min_members":null,"max_members":null,"region_scope":["bundesweit"],"project_types":["demokratie","integration"],"cofinancing_required":false,"min_years_established":null}'::jsonb,
   'unknown', 'https://www.demokratie-leben.de/', 'verified', 'low', 'curated'),

  ('Förderung durch die Sparkassenstiftung', 'Sparkassenstiftung (regional)', 'stiftung',
   'Regionale Stiftungsförderung für Kultur, Sport und Soziales durch Vereine und Initiativen.',
   ARRAY['verein'], ARRAY['kultur','sport','soziales'],
   '{"legal_forms_allowed":["ev"],"gemeinnuetzig_required":true,"min_members":null,"max_members":null,"region_scope":["MV","Landkreis MSE"],"project_types":["kultur","sport","soziales"],"cofinancing_required":false,"min_years_established":null}'::jsonb,
   'unknown', 'https://www.sparkasse.de/', 'verified', 'low', 'curated');

-- One representative citation per program for grounding (the human curator adds exact quotes on verification).
INSERT INTO public.funding_program_sources (program_id, url, quote)
SELECT id, source_url, '' FROM public.funding_programs WHERE origin = 'curated';
```

- [ ] **Step 2: Apply the seed via the Supabase MCP**

Call `mcp__supabase__apply_migration` with `project_id: "wwbeqhkslxdxhktqzqti"`, `name: "20260724_foerdermittel_seed"`, and `query` = the SQL above.
Expected: success.

- [ ] **Step 3: Verify the seed loaded**

Call `mcp__supabase__execute_sql` with `project_id: "wwbeqhkslxdxhktqzqti"`, `query: "select count(*) as n, count(*) filter (where status='verified') as verified from public.funding_programs;"`.
Expected: `n >= 6`, `verified >= 6`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260724_foerdermittel_seed.sql
git commit -m "feat(foerdermittel): curated core seed (DSEE, Aktion Mensch, LEADER MSE, Ehrenamtsstiftung MV, Demokratie leben!, Sparkassenstiftung)"
git push
```

---

## Self-Review

**1. Spec coverage (Plan 1 slice of spec §3.1, §3.2, §3.4):**
- Funding DB (§3.1) → Task 1 (`funding_programs`, `funding_program_sources`) + Task 6 (curated core). ✓
- Org funding-profile table + consent flag (§3.2) → Task 1 (`org_funding_profiles`, `accounts.foerder_outreach_opt_in`). ✓ (Interview that *fills* it = Plan 2.)
- Matching engine two-stage: hard filters (§3.4a) → Task 2; deep fit + honest bands (§3.4b) → Tasks 3–4; persistence to `org_funding_matches` → Tasks 1 + 5. ✓
- Honesty guardrail (collapse niedrig, cite source, no fabricated numerics) → Task 3 (`collapsed`), Task 4 (prompt + system), Task 6 (null numerics). ✓
- Model routing: Opus for fit reasoning → Task 4 (`claude-opus-4-8`); deterministic hard filter (no LLM) → Task 2. ✓
- Out of Plan 1 (correctly deferred): research agent (Plan 4), outreach orchestrator (Plan 5), Mecky tools/interview (Plan 2), dashboard/admin verification UI (Plan 3). ✓

**2. Placeholder scan:** No "TBD/TODO/implement later" in any step. Every code step ships full code; every test step ships full assertions; every migration step ships full SQL. Task 6's `NULL` numerics are an explicit honesty decision, not a placeholder. ✓

**3. Type consistency:** `MatchInput`, `FundingProgram`, `RankedMatch`, `FitResult`, `GenerateFit`, `MatchSources`, `RunMatchResult` are used identically across Tasks 2–5. `filterEligiblePrograms(input, programs)` (Task 2) is called with the same signature in Task 5. `rankMatches(input, eligible, { generateFit })` (Task 3) matches its Task 5 call. `saveMatches(accountId, matches)` and the `org_funding_matches` columns (Task 1) match the rows built in Task 5 Step 5. `generateFitWithClaude` (Task 4) satisfies the `GenerateFit` type (Task 3). ✓

**Note for the executor:** run each test file with `pnpm exec tsx --test apps/web/tests/<file>.test.ts` from the **repo root**. There is no `test` script in `apps/web` or in `turbo.json`; the root `test:web` script globs all Plan-1 test files at once once they exist.
