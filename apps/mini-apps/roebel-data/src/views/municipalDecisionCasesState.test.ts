import assert from "node:assert/strict";
import test from "node:test";

import { StadtstackFederationError } from "@roebel/stadtstack-federation-client";

import { classifyMunicipalDecisionCaseFailure } from "./municipalDecisionCasesState";
import { presentActivityJournalEvent } from "./municipalDecisionCasesState";

test("a missing federation endpoint is not presented as an honest empty index", () => {
  const state = classifyMunicipalDecisionCaseFailure(
    new StadtstackFederationError("not_found", "missing", 404),
  );

  assert.equal(state, "not_found");
  assert.notEqual(state, "empty");
});

test("the Mini App renders only static allowlisted Activity Journal labels", () => {
  const presented = presentActivityJournalEvent({
    descriptionCode: "synthetic_companion_run_completed",
    status: "succeeded",
    actor: {
      kind: "agent",
      actorRef: "agent:synthetic-mecky-public",
      roleCode: "public_city_companion",
    },
  });

  assert.deepEqual(presented, {
    description: "Mecky-Entwurf wurde zur menschlichen Prüfung bereitgestellt",
    status: "abgeschlossen",
    actor: "Mecky",
  });
  assert.doesNotMatch(
    Object.values(presented).join(" "),
    /prompt|tool|conversation|wallet|token/iu,
  );
});
