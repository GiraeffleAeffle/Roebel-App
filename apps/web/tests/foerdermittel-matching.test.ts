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
