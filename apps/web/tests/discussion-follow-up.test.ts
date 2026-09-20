import assert from "node:assert/strict";
import { test } from "node:test";
import { buildNoteEvent } from "@netizen-labs/nostr";
import { discussionFollowUpComment, discussionFollowUpHref, discussionFollowUpPresentation, discussionFollowUpSuffix, readDiscussionFollowUp } from "../src/lib/stadtstack/discussion-follow-up";
import type { StagingThreadResponse } from "../src/lib/stadtstack/staging-api";

const postId = "735187dc-d737-4e6c-bdd9-fe0792fec498";
const topic = { id: "urn:stadtstack:topic:municipality:example-town:begegnungsort", title: "Begegnungsort" };
const root = buildNoteEvent(new Uint8Array(32).fill(45), "@Mecky Welche Räume stehen zur Verfügung?", {
  createdAt: 101, tags: [["t", "stadtstack-civic-discussion"], ["stance", "root"],
    ["municipality", "example-town"], ["topic", topic.id], ["topic-title", topic.title], ["source-app-post", postId]],
});
const thread = { rootEvent: root, sourceAppPostId: postId, authorityBinding: "none", topic } as StagingThreadResponse;
const context = readDiscussionFollowUp(thread, root.id, postId);
const origin = "https://app.example.org";

test("the Brief opens the shared post composer with its signed discussion context", () => {
  const url = new URL(discussionFollowUpHref(root.id, postId), origin);
  assert.equal(url.pathname, `/app/posts/${postId}`);
  assert.equal(url.searchParams.get("discussion"), root.id);
  assert.equal(url.hash, "#discussion-follow-up");
  assert.equal(context.title, topic.title);
  assert.equal(discussionFollowUpComment(" @Mecky Was sagen die Fachbereiche Finanzen und Stadtplanung? ", context, origin),
    `@Mecky Was sagen die Fachbereiche Finanzen und Stadtplanung?\n\nDiskussion: ${origin}/app/diskussion/${root.id}#citizen-brief`);
  assert.ok(!discussionFollowUpComment("Eine Rückfrage ohne KI", context, origin).includes("@Mecky"));
});

test("a URL cannot attach another post or a forged root, title or municipality", () => {
  for (const changed of [
    { ...thread, sourceAppPostId: "f".repeat(64) },
    { ...thread, rootEvent: { ...root, content: "changed" } },
    { ...thread, topic: { ...topic, title: "Another topic" } },
    { ...thread, topic: { ...topic, id: "urn:stadtstack:topic:municipality:another-town:begegnungsort" } },
  ]) assert.throws(() => readDiscussionFollowUp(changed, root.id, postId));
  assert.throws(() => readDiscussionFollowUp(thread, "f".repeat(64), postId));
  assert.throws(() => readDiscussionFollowUp(thread, root.id, "f".repeat(64)));
  assert.throws(() => discussionFollowUpHref("../other", postId));
  assert.throws(() => discussionFollowUpHref(root.id, "https://other.example"));
});

test("the discussion link counts toward the comment limit and blank mentions cannot publish", () => {
  const remaining = 500 - discussionFollowUpSuffix(context, origin).length;
  assert.equal(discussionFollowUpComment("x".repeat(remaining), context, origin).length, 500);
  assert.throws(() => discussionFollowUpComment("x".repeat(remaining + 1), context, origin), /kürze/);
  for (const empty of ["", " ", "@Mecky", "@Mecky, "]) {
    assert.throws(() => discussionFollowUpComment(empty, context, origin), /Rückfrage/);
  }
  for (const unsafe of ["https://app.example.org/path", "https://user@host.example", "http://remote.example"]) {
    assert.throws(() => discussionFollowUpComment("Meine Frage", context, unsafe));
  }
});

test("the feed displays the exact discussion reference without hiding other comment text", () => {
  const content = discussionFollowUpComment("@Mecky Was sagt Finanzen?", context, origin);
  assert.deepEqual(discussionFollowUpPresentation(content, origin), { text: "@Mecky Was sagt Finanzen?", href: `/app/diskussion/${root.id}#citizen-brief` });
  for (const changed of [content.replace(origin, "https://foreign.example"), content + " additional text", content.replace("#citizen-brief", "?token=hidden")]) {
    assert.deepEqual(discussionFollowUpPresentation(changed, origin), { text: changed });
  }
});
