import assert from "node:assert/strict";
import test from "node:test";
import { classifyAdministrationAccess } from "../src/lib/administration-review/access.ts";

test("only an explicit authentication challenge requests sign-in", () => {
  assert.equal(classifyAdministrationAccess(401, { error: "authentication_required" }), "sign-in");
  assert.equal(classifyAdministrationAccess(401, { error: "review_unavailable" }), "unavailable");
  assert.equal(classifyAdministrationAccess(503, { error: "authentication_required" }), "unavailable");
  assert.equal(classifyAdministrationAccess(401, null), "unavailable");
});

test("missing current role remains distinct from a rejected or unavailable request", () => {
  assert.equal(classifyAdministrationAccess(403, { error: "review_role_required" }), "no-current-role");
  assert.equal(classifyAdministrationAccess(403, { error: "request_origin_rejected" }), "unavailable");
  assert.equal(classifyAdministrationAccess(403, { error: "review_unavailable" }), "unavailable");
});
