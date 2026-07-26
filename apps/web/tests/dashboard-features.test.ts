import assert from "node:assert/strict";
import { test } from "node:test";
import { dashboardFeatures } from "../src/lib/dashboard/features";

test("citizen sees every section", () => {
  assert.deepEqual(dashboardFeatures("citizen"), {
    identity: true,
    memberships: true,
    copilot: true,
    civic: true,
    workspace: true,
  });
});

test("tourist sees no sections", () => {
  const f = dashboardFeatures("tourist");
  assert.equal(Object.values(f).some(Boolean), false);
});

test("guest sees no sections", () => {
  const f = dashboardFeatures("guest");
  assert.equal(Object.values(f).some(Boolean), false);
});
