import assert from "node:assert/strict";
import { test } from "node:test";
import { selectOutreachTargets, type OutreachCandidate } from "../src/lib/outreach/select-targets";

function c(over: Partial<OutreachCandidate> & { id: string }): OutreachCandidate {
  return { account_type: "organisation", sub_type: "verein", story_outreach_opt_in: true, ...over };
}

test("selects eligible org accounts; opt_in null defaults to eligible", () => {
  const out = selectOutreachTargets(
    [c({ id: "a" }), c({ id: "b", story_outreach_opt_in: null })],
    new Set(),
  );
  assert.deepEqual(out, ["a", "b"]);
});

test("excludes personal accounts and ineligible sub_types", () => {
  const out = selectOutreachTargets(
    [
      c({ id: "org", sub_type: "unternehmen" }),
      c({ id: "person", account_type: "personal" }),
      c({ id: "journalist", sub_type: "journalist" }),
      c({ id: "fraktion", sub_type: "fraktion" }),
      c({ id: "nosub", sub_type: null }),
    ],
    new Set(),
  );
  assert.deepEqual(out, ["org"]);
});

test("excludes opted-out (false) and already-invited accounts", () => {
  const out = selectOutreachTargets(
    [c({ id: "a" }), c({ id: "optout", story_outreach_opt_in: false }), c({ id: "invited" })],
    new Set(["invited"]),
  );
  assert.deepEqual(out, ["a"]);
});
