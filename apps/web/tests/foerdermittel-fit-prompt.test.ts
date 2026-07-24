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
