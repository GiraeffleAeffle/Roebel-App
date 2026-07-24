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
