import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { readSyntheticBriefResponse } from "@roebel/stadtstack-federation-client";
import { projectCivicJourney } from "../src/lib/stadtstack/civic-journey";
import { loadCurrentPostJourney } from "../src/lib/stadtstack/current-post-journey";
import { resolveCivicPostJourney } from "../src/lib/stadtstack/civic-post-journey-policy";
import type { PublicCivicPostLink } from "../src/lib/stadtstack/civic-topic-detail";
import type { StagingThreadResponse } from "../src/lib/stadtstack/staging-api";

const { returned, receipt } = JSON.parse(readFileSync(new URL("../../../packages/stadtstack-federation-client/src/fixtures/synthetic-citizen-brief-return-v1.json", import.meta.url), "utf8"));
const link = { discussionId: returned.discussionId, detail: { topic: { topicId: returned.topicId } },
  journey: projectCivicJourney({ sourcePostCount: 1, discussionCount: 1, meckyMentioned: true,
    meckyAnswered: true, proposalSigned: true, citizenAdoptionVerified: false, caseAdmitted: false }) } as PublicCivicPostLink;
const thread = { topic: { id: returned.topicId }, suggestion: {
  schemaVersion: "staging_participant_signed_topic_suggestion_v1", suggestionId: receipt.participantSuggestionEventId,
} } as StagingThreadResponse;
const readers = { loadReceipt: async () => receipt, loadDiscussion: async () => thread,
  loadBrief: async (binding: Parameters<typeof readSyntheticBriefResponse>[1]) => readSyntheticBriefResponse(Response.json(returned), binding) };

test("the feed advances from adoption to the exact verified return, preserving civic authority", async () => {
  const current = await loadCurrentPostJourney(link, readers);
  assert.equal(link.journey.currentStageId, "adoption");
  assert.equal(current.currentStageId, "participation");
  assert.equal(current.displayScope, "synthetic_demo");
  assert.equal(current.authorityBinding, "none");
  assert.equal(current.stages.find(s => s.id === "participation")?.label, "Rücklauf diskutieren");
});

test("a receipt for another proposal, discussion or topic cannot advance the feed", async () => {
  for (const changed of [{ participantSuggestionEventId: "f".repeat(64) }, { rootEventId: "f".repeat(64) }, { topicId: "other-topic" }]) {
    await assert.rejects(loadCurrentPostJourney(link, { ...readers, loadReceipt: async () => ({ ...receipt, ...changed }) }), /binding_mismatch/);
  }
  await assert.rejects(loadCurrentPostJourney({ ...link, detail: { ...link.detail, topic: { ...link.detail.topic, topicId: "other-topic" } } }, readers), /binding_mismatch/);
});

test("missing admission stays on the original journey and never reads the test Brief", async () => {
  assert.equal(await loadCurrentPostJourney(link, { ...readers, loadReceipt: async () => null,
    loadBrief: async () => { throw Error("must not read"); } }), link.journey);
});

test("withdrawn returns reopen review, while invalid or unreachable returns offer retry", async () => {
  const current = await loadCurrentPostJourney(link, { ...readers, loadBrief: async () => ({ ...returned, status: "withdrawn", brief: null }) });
  assert.equal(current.currentStageId, "administration");
  for (const loadBrief of [async () => { throw Error("unavailable"); }, async () => readSyntheticBriefResponse(Response.json({ ...returned, returnChecksum: "sha256:" + "0".repeat(64) }), returned)]) {
    const state = await resolveCivicPostJourney({ sourceAppPostId: "source", loadPostLink: async () => ({ ...link, journey: await loadCurrentPostJourney(link, { ...readers, loadBrief }) }) });
    assert.equal(state.kind, "unavailable");
  }
});
