import assert from "node:assert/strict";
import { test } from "node:test";
import {
  computeCompleteness,
  emptyProfileForm,
  profileToForm,
  type ProfileFormInput,
} from "../src/lib/foerdermittel/profile";
import type { OrgFundingProfile } from "../src/types/foerdermittel";

test("empty profile scores 0 completeness", () => {
  assert.equal(computeCompleteness(emptyProfileForm()), 0);
});

test("project need + legal form clears the 40-point matching threshold", () => {
  const input: Partial<ProfileFormInput> = {
    project_needs: "Wir möchten unseren Vereinsraum barrierefrei umbauen.",
    legal_form: "ev",
  };
  // 30 (needs >=20) + 15 (legal form) = 45 >= 40
  assert.equal(computeCompleteness(input), 45);
});

test("a short project need scores less than a real one", () => {
  assert.equal(computeCompleteness({ project_needs: "Hilfe" }), 15);
  assert.equal(
    computeCompleteness({ project_needs: "Wir brauchen eine neue Heizungsanlage." }),
    30,
  );
});

test("unbekannt legal form / budget do not count", () => {
  assert.equal(
    computeCompleteness({ legal_form: "unbekannt", budget_band: "unbekannt" }),
    0,
  );
});

test("gemeinnuetzig=false still counts as answered", () => {
  assert.equal(computeCompleteness({ is_gemeinnuetzig: false }), 10);
  assert.equal(computeCompleteness({ is_gemeinnuetzig: null }), 0);
});

test("a fully filled profile reaches 100", () => {
  const full: ProfileFormInput = {
    legal_form: "ev",
    is_gemeinnuetzig: true,
    founded_year: 1998,
    member_count: 42,
    budget_band: "5k_25k",
    sector_tags: ["kultur", "jugend"],
    project_needs: "Wir wollen ein Kulturfest für Jugendliche in Röbel veranstalten.",
    goals: "Mehr Teilhabe junger Menschen am Vereinsleben.",
    region: "Röbel",
  };
  assert.equal(computeCompleteness(full), 100);
});

test("profileToForm falls back to defaults for null row", () => {
  const form = profileToForm(null);
  assert.equal(form.legal_form, "unbekannt");
  assert.equal(form.sector_tags.length, 0);
  assert.ok(form.region.length > 0);
});

test("profileToForm preserves stored values", () => {
  const row: OrgFundingProfile = {
    account_id: "a1",
    legal_form: "ggmbh",
    is_gemeinnuetzig: true,
    founded_year: 2010,
    member_count: null,
    budget_band: "25k_100k",
    sector_tags: ["soziales"],
    project_needs: "Beratungsangebot ausbauen",
    goals: "",
    region: "Landkreis MSE",
    profile_completeness: 70,
    last_interviewed_at: null,
  };
  const form = profileToForm(row);
  assert.equal(form.legal_form, "ggmbh");
  assert.equal(form.budget_band, "25k_100k");
  assert.deepEqual(form.sector_tags, ["soziales"]);
  assert.equal(form.region, "Landkreis MSE");
});
