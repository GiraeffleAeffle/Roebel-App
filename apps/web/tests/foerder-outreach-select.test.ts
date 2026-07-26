import assert from "node:assert/strict";
import { test } from "node:test";
import {
  selectFoerderTargets,
  type FoerderCandidate,
} from "../src/lib/outreach/select-foerder-targets";

function cand(over: Partial<FoerderCandidate>): FoerderCandidate {
  return {
    id: "a",
    account_type: "organisation",
    sub_type: "verein",
    foerder_outreach_opt_in: true,
    ...over,
  };
}

test("selects eligible orgs not yet invited", () => {
  const targets = selectFoerderTargets(
    [
      cand({ id: "v", sub_type: "verein" }),
      cand({ id: "u", sub_type: "unternehmen" }),
      cand({ id: "r", sub_type: "restaurant" }),
      cand({ id: "s", sub_type: "stadt" }),
    ],
    new Set(),
  );
  assert.deepEqual(targets.sort(), ["r", "s", "u", "v"]);
});

test("excludes personal accounts, ineligible sub_types, opted-out, and already-invited", () => {
  const targets = selectFoerderTargets(
    [
      cand({ id: "personal", account_type: "personal" }),
      cand({ id: "fraktion", sub_type: "fraktion" }),
      cand({ id: "journalist", sub_type: "journalist" }),
      cand({ id: "no-subtype", sub_type: null }),
      cand({ id: "opted-out", foerder_outreach_opt_in: false }),
      cand({ id: "invited", sub_type: "verein" }),
      cand({ id: "fresh", sub_type: "verein" }),
    ],
    new Set(["invited"]),
  );
  assert.deepEqual(targets, ["fresh"]);
});

test("null opt-in is treated as opted-in (default-on)", () => {
  const targets = selectFoerderTargets(
    [cand({ id: "x", foerder_outreach_opt_in: null })],
    new Set(),
  );
  assert.deepEqual(targets, ["x"]);
});
