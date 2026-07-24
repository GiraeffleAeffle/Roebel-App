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
