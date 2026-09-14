import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { projectCivicJourney } from "../src/lib/stadtstack/civic-journey";
import { projectSyntheticJourney } from "../src/lib/stadtstack/synthetic-journey";
import { publicReturnStatus, type TopicOrigin } from "../src/lib/administration-review/overview";
import { verifySyntheticCitizenBrief } from "@roebel/stadtstack-federation-client";

const fixture = JSON.parse(readFileSync(new URL("../../../packages/stadtstack-federation-client/src/fixtures/synthetic-citizen-brief-return-v1.json", import.meta.url), "utf8")).returned;
const binding = { caseId: fixture.caseId, topicId: fixture.topicId, discussionId: fixture.discussionId };
const original = projectCivicJourney({ sourcePostCount: 1, discussionCount: 1, meckyMentioned: true, meckyAnswered: true,
  proposalSigned: true, citizenAdoptionVerified: false, caseAdmitted: false })!;

test("a verified synthetic return advances the displayed test lane without changing municipal eligibility", async () => {
  const returned = await verifySyntheticCitizenBrief(fixture, binding);
  const before = JSON.stringify(original);
  const journey = projectSyntheticJourney(original, binding, returned);
  assert.equal(original.currentStageId, "adoption");
  assert.equal(journey.currentStageId, "participation");
  assert.equal(journey.displayScope, "synthetic_demo");
  assert.equal(journey.stages.find(s => s.id === "administration")?.state, "complete");
  assert.equal(journey.stages.find(s => s.id === "participation")?.label, "Rücklauf diskutieren");
  assert.match(journey.stages.find(s => s.id === "participation")!.detail, /noch nicht geöffnet/);
  assert.ok(journey.stages.slice(-2).every(s => s.state === "gated"));
  assert.equal(journey.authorityBinding, "none");
  assert.equal(JSON.stringify(original), before);
});

test("absent, withdrawn or differently bound returns never claim completed review", () => {
  for (const returned of [null, { ...fixture, status: "withdrawn", brief: null },
    { ...fixture, status: "not_ready", brief: null }, { ...fixture, discussionId: "f".repeat(64) },
    { ...fixture, caseId: "other" }, { ...fixture, topicId: "other" }]) {
    const journey = projectSyntheticJourney(original, binding, returned);
    assert.equal(journey.currentStageId, "administration");
    assert.equal(journey.stages.find(s => s.id === "participation")?.state, "gated");
  }
});

test("workspace return status needs a matching public response, and detects changed versions", () => {
  const origin: TopicOrigin = { ...binding, rootId: binding.discussionId, admissionVersion: 3, title: "Test", content: "Test",
    createdAt: "2026-09-14T10:00:00.000Z", receiptChecksum: "sha256:" + "a".repeat(64), testOnly: true, sources: [] };
  const view = { caseId: binding.caseId, caseVersion: fixture.caseVersion, departmentPackages: [], briefReadiness: null };
  assert.equal(publicReturnStatus(origin, view, null), "unverified");
  assert.equal(publicReturnStatus(origin, view, fixture), "available");
  assert.equal(publicReturnStatus(origin, { ...view, caseVersion: fixture.caseVersion + 1 }, fixture), "changed");
  assert.equal(publicReturnStatus(origin, view, { ...fixture, discussionId: "e".repeat(64) }), "unverified");
  assert.equal(publicReturnStatus(origin, view, { ...fixture, status: "withdrawn", brief: null }), "withdrawn");
});
