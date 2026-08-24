import assert from "node:assert/strict";
import { test } from "node:test";
import {
  projectPublicCivicTopicDetail,
  projectPublicCivicTopicJourney,
} from "../src/lib/stadtstack/civic-topic-detail";
import type {
  StagingFeedResponse,
  StagingOrdinaryPost,
  StagingTopicPost,
} from "../src/lib/stadtstack/staging-api";

const TOPIC_ID =
  "urn:stadtstack:topic:municipality:roebel-mueritz:offener-treffpunkt";

function sourcePost(id: string, sourceAppPostId: string): StagingOrdinaryPost {
  return {
    id,
    entryType: "post",
    event: {
      id,
      pubkey: "a".repeat(64),
      created_at: 1_787_396_400,
      kind: 1,
      tags: [],
      content: "Ein Treffpunkt fehlt.",
      sig: "b".repeat(128),
    },
    author: { name: "Anna", kind: "citizen", pubkey: "a".repeat(64) },
    content: "Ein Treffpunkt fehlt.",
    createdAt: "2026-08-22T12:00:00.000Z",
    replyCount: 0,
    meckyMentioned: false,
    meckyAnswered: false,
    sourceAppPostId,
    promotedDiscussionId: "discussion-a",
    promotedTopicId: TOPIC_ID,
    synthetic: false,
  };
}

function topic(overrides: Partial<StagingTopicPost> = {}): StagingTopicPost {
  return {
    id: "discussion-a",
    entryType: "topic",
    topicId: TOPIC_ID,
    topicTitle: "Ein offener Treffpunkt für Röbel",
    discussionCount: 2,
    discussionIds: ["discussion-a", "discussion-b"],
    discussions: [
      {
        id: "discussion-b",
        author: { name: "Bernd", kind: "citizen", pubkey: "c".repeat(64) },
        content: "Wie könnte ein gemeinsamer Raum finanziert werden?",
        createdAt: "2026-08-22T13:00:00.000Z",
        replyCount: 1,
        meckyMentioned: true,
        meckyAnswered: true,
        suggestionSigned: true,
        caseBinding: null,
        sourceConversation: null,
        synthetic: false,
      },
      {
        id: "discussion-a",
        author: { name: "Anna", kind: "citizen", pubkey: "a".repeat(64) },
        content: "Braucht Röbel einen offenen Treffpunkt?",
        createdAt: "2026-08-22T12:30:00.000Z",
        replyCount: 2,
        meckyMentioned: false,
        meckyAnswered: false,
        suggestionSigned: false,
        caseBinding: null,
        sourceConversation: null,
        synthetic: false,
      },
    ],
    sourcePostIds: ["source-a", "missing-source"],
    activityCount: 6,
    lastActivityAt: "2026-08-22T13:00:00.000Z",
    author: { name: "Anna", kind: "citizen", pubkey: "a".repeat(64) },
    content: "Braucht Röbel einen offenen Treffpunkt?",
    createdAt: "2026-08-22T12:30:00.000Z",
    replyCount: 3,
    meckyMentioned: true,
    meckyAnswered: true,
    synthetic: false,
    ...overrides,
  };
}

test("projects one canonical topic with attributable posts and discussions", () => {
  const feed: StagingFeedResponse = {
    schemaVersion: "roebel_staging_mixed_feed_v1",
    authorityBinding: "none",
    posts: [sourcePost("source-a", "app-post-a"), topic()],
  };

  const detail = projectPublicCivicTopicDetail(feed, TOPIC_ID);

  assert.ok(detail);
  assert.equal(detail.topic.topicId, TOPIC_ID);
  assert.deepEqual(
    detail.topic.discussions.map((entry) => entry.id),
    ["discussion-b", "discussion-a"]
  );
  assert.deepEqual(
    detail.sourcePosts.map((entry) => entry.sourceAppPostId),
    ["app-post-a"]
  );
  assert.deepEqual(detail.unresolvedSourcePostIds, ["missing-source"]);
  const journey = projectPublicCivicTopicJourney(detail);
  assert.equal(journey?.currentStageId, "case");
  assert.equal(
    journey?.stages.find((stage) => stage.id === "proposal")?.state,
    "complete"
  );
});

test("advances the same topic journey only for its exact reviewed case", () => {
  const bound = topic();
  bound.discussions[0]!.caseBinding = {
    municipalityId: "roebel-mueritz",
    sourceCaseId: "offener-treffpunkt",
    canonicalCaseId:
      "urn:stadtstack:case:municipality:roebel-mueritz:018f0000-0000-7000-8000-000000000001",
  };
  const detail = projectPublicCivicTopicDetail(
    {
      schemaVersion: "roebel_staging_mixed_feed_v1",
      authorityBinding: "none",
      posts: [bound],
    },
    TOPIC_ID
  );
  assert.ok(detail?.caseBinding);
  assert.equal(detail.caseBindingConflict, false);

  const reviewed = projectPublicCivicTopicJourney(detail, {
    caseId: detail.caseBinding.canonicalCaseId,
    status: "brief_current",
  });
  assert.equal(reviewed?.currentStageId, "participation");

  const wrongCase = projectPublicCivicTopicJourney(detail, {
    caseId:
      "urn:stadtstack:case:municipality:roebel-mueritz:018f0000-0000-7000-8000-000000000099",
    status: "brief_current",
  });
  assert.equal(wrongCase?.currentStageId, "administration");
  assert.equal(
    wrongCase?.stages.find((stage) => stage.id === "administration")?.state,
    "current"
  );
  assert.equal(
    wrongCase?.stages.find((stage) => stage.id === "participation")?.state,
    "gated"
  );
});

test("fails closed for another municipality, synthetic topics, or authority drift", () => {
  const feed: StagingFeedResponse = {
    schemaVersion: "roebel_staging_mixed_feed_v1",
    authorityBinding: "none",
    posts: [topic({ synthetic: true })],
  };
  assert.equal(projectPublicCivicTopicDetail(feed, TOPIC_ID), null);
  assert.equal(
    projectPublicCivicTopicDetail(
      { ...feed, posts: [topic()] },
      "urn:stadtstack:topic:municipality:strausberg:treffpunkt"
    ),
    null
  );
});
