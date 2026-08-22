import assert from "node:assert/strict";
import { test } from "node:test";
import { projectCivicJourney } from "../src/lib/stadtstack/civic-journey";

const base = {
  sourcePostCount: 1,
  discussionCount: 1,
  meckyMentioned: true,
  meckyAnswered: false,
  proposalSigned: false,
  caseAdmitted: false,
} as const;

test("places the current step at the unanswered Mecky mention", () => {
  const journey = projectCivicJourney(base);
  assert.ok(journey);
  assert.equal(journey.currentStageId, "mecky");
  assert.deepEqual(
    journey.stages.slice(0, 5).map((stage) => [stage.id, stage.state]),
    [
      ["topic", "complete"],
      ["discussion", "complete"],
      ["mecky", "current"],
      ["proposal", "gated"],
      ["case", "gated"],
    ]
  );
  assert.equal(journey.authorityBinding, "none");
});

test("keeps proposal signing and human case admission as separate steps", () => {
  const answered = projectCivicJourney({
    ...base,
    meckyAnswered: true,
  });
  const signed = projectCivicJourney({
    ...base,
    meckyAnswered: true,
    proposalSigned: true,
  });

  assert.equal(answered?.currentStageId, "proposal");
  assert.equal(signed?.currentStageId, "case");
  assert.equal(
    signed?.stages.find((stage) => stage.id === "proposal")?.state,
    "complete"
  );
  assert.equal(
    signed?.stages.find((stage) => stage.id === "case")?.state,
    "current"
  );
});

test("shows public brief and advisory participation without unlocking effects", () => {
  const journey = projectCivicJourney({
    ...base,
    meckyAnswered: true,
    proposalSigned: true,
    caseAdmitted: true,
    administrationStatus: "brief_current",
    participationStatus: "result_current",
  });
  assert.ok(journey);
  assert.equal(journey.currentStageId, null);
  assert.equal(
    journey.stages.find((stage) => stage.id === "participation")?.state,
    "complete"
  );
  assert.deepEqual(
    journey.stages.slice(-2).map((stage) => [stage.id, stage.state]),
    [
      ["decision", "gated"],
      ["execution", "gated"],
    ]
  );
});

test("does not invent a missing public proposal receipt for an existing case", () => {
  const journey = projectCivicJourney({
    ...base,
    meckyAnswered: true,
    caseAdmitted: true,
  });
  assert.ok(journey);
  assert.equal(journey.currentStageId, "administration");
  assert.equal(
    journey.stages.find((stage) => stage.id === "proposal")?.state,
    "gated"
  );
  assert.match(
    journey.stages.find((stage) => stage.id === "proposal")?.detail ?? "",
    /nicht öffentlich projiziert/
  );
});

test("fails closed on invalid counts", () => {
  assert.equal(
    projectCivicJourney({ ...base, discussionCount: Number.NaN }),
    null
  );
  assert.equal(projectCivicJourney({ ...base, sourcePostCount: -1 }), null);
});
