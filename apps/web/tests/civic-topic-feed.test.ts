import assert from "node:assert/strict";
import { test } from "node:test";
import {
  projectPublicCivicFeed,
  type PublicCivicFeedEntry,
} from "../src/lib/stadtstack/civic-topic-feed";
import type { StagingTopicPost } from "../src/lib/stadtstack/staging-api";

type TestPost = { id: string; created_at: string };

function topic(
  input: Partial<StagingTopicPost> & Pick<StagingTopicPost, "id" | "topicId">
): StagingTopicPost {
  return {
    id: input.id,
    entryType: "topic",
    topicId: input.topicId,
    topicTitle: input.topicTitle ?? "Offener Treffpunkt",
    discussionCount: input.discussionCount ?? 1,
    discussionIds: input.discussionIds ?? [input.id],
    sourcePostIds: input.sourcePostIds ?? [],
    activityCount: input.activityCount ?? 1,
    lastActivityAt: input.lastActivityAt ?? "2026-08-22T12:00:00.000Z",
    author: input.author ?? {
      name: "Max",
      kind: "citizen",
      pubkey: "a".repeat(64),
    },
    content: input.content ?? "Soll daraus eine gemeinsame Diskussion werden?",
    createdAt: input.createdAt ?? "2026-08-22T11:00:00.000Z",
    replyCount: input.replyCount ?? 0,
    meckyMentioned: input.meckyMentioned ?? false,
    meckyAnswered: input.meckyAnswered ?? false,
    synthetic: input.synthetic ?? false,
  };
}

test("keeps ordinary posts and projects one latest card per public civic topic", () => {
  const posts: TestPost[] = [
    { id: "source-post", created_at: "2026-08-22T11:30:00.000Z" },
    { id: "ordinary-post", created_at: "2026-08-22T10:00:00.000Z" },
  ];
  const older = topic({
    id: "discussion-old",
    topicId: "urn:stadtstack:topic:municipality:roebel-mueritz:treffpunkt",
    sourcePostIds: ["source-post"],
    lastActivityAt: "2026-08-22T11:00:00.000Z",
  });
  const latest = topic({
    id: "discussion-latest",
    topicId: older.topicId,
    discussionCount: 2,
    discussionIds: ["discussion-old", "discussion-latest"],
    sourcePostIds: ["source-post"],
    lastActivityAt: "2026-08-22T12:00:00.000Z",
  });

  const projected = projectPublicCivicFeed(posts, [older, latest]);

  assert.deepEqual(
    projected.map((entry) => [entry.kind, entry.occurredAt]),
    [
      ["topic", "2026-08-22T12:00:00.000Z"],
      ["post", "2026-08-22T11:30:00.000Z"],
      ["post", "2026-08-22T10:00:00.000Z"],
    ]
  );
  assert.equal(
    (projected[0] as Extract<PublicCivicFeedEntry<TestPost>, { kind: "topic" }>)
      .topic.id,
    "discussion-latest"
  );
  assert.deepEqual(
    projected
      .filter((entry) => entry.kind === "post")
      .map((entry) => entry.post.id),
    ["source-post", "ordinary-post"]
  );
});

test("excludes synthetic and malformed topic activity without hiding normal posts", () => {
  const posts: TestPost[] = [
    { id: "ordinary-post", created_at: "2026-08-22T10:00:00.000Z" },
  ];
  const synthetic = topic({
    id: "synthetic",
    topicId: "urn:stadtstack:topic:municipality:roebel-mueritz:test",
    synthetic: true,
  });
  const malformed = topic({
    id: "malformed",
    topicId: "urn:stadtstack:topic:municipality:roebel-mueritz:broken",
    lastActivityAt: "not-a-date",
  });

  assert.deepEqual(projectPublicCivicFeed(posts, [synthetic, malformed]), [
    {
      kind: "post",
      occurredAt: "2026-08-22T10:00:00.000Z",
      post: posts[0],
    },
  ]);
});
