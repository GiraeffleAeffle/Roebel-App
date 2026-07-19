import assert from "node:assert/strict";
import test from "node:test";

import { StadtstackFederationError } from "@roebel/stadtstack-federation-client";

import { classifyMunicipalDecisionCaseFailure } from "./municipalDecisionCasesState";

test("a missing federation endpoint is not presented as an honest empty index", () => {
  const state = classifyMunicipalDecisionCaseFailure(
    new StadtstackFederationError("not_found", "missing", 404),
  );

  assert.equal(state, "not_found");
  assert.notEqual(state, "empty");
});
