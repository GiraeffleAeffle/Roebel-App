import assert from "node:assert/strict";
import { test } from "node:test";

import {
  APP_CONVERSATION_TOPIC,
  isAppConversationMentionEvent,
  verifyAppConversationExchange,
} from "../src/conversation";
import { buildNoteEvent } from "../src/events";
import { deriveNostrSecretKey, getPublicKeyHex } from "../src/keys";

const SECRET_KEY = deriveNostrSecretKey(`0x${"12".repeat(65)}`);
const AGENT = "d".repeat(64);
const POST = "11111111-1111-4111-8111-111111111111";
const COMMENT = "22222222-2222-4222-8222-222222222222";

test("accepts only the exact signed ordinary-post conversation envelope", () => {
  const event = buildNoteEvent(SECRET_KEY, "@Mecky, bitte einordnen", {
    createdAt: 1_787_659_200,
    tags: [
      ["p", AGENT],
      ["source-app-post", POST],
      ["t", APP_CONVERSATION_TOPIC],
    ],
  });
  assert.equal(
    isAppConversationMentionEvent(event, {
      agentPubkey: AGENT,
      sourceAppPostId: POST,
    }),
    true,
  );
  assert.equal(
    isAppConversationMentionEvent(
      { ...event, tags: event.tags.slice(0, 2) },
      { agentPubkey: AGENT, sourceAppPostId: POST },
    ),
    false,
  );
  assert.equal(
    isAppConversationMentionEvent(
      { ...event, content: `${event.content} verändert` },
      { agentPubkey: AGENT, sourceAppPostId: POST },
    ),
    false,
  );
});

test("accepts only one exact same-thread evidence-bearing agent exchange", () => {
  const agentPubkey = getPublicKeyHex(SECRET_KEY);
  const mention = buildNoteEvent(SECRET_KEY, "@Mecky, bitte einordnen", {
    createdAt: 1_787_659_200,
    tags: [["p", agentPubkey], ["source-app-post", POST], ["t", "roebel-app-conversation"]],
  });
  const reply = buildNoteEvent(SECRET_KEY, "Die Unterlagen weisen auf drei Prüfpfade hin.", {
    createdAt: 1_787_659_201,
    tags: [
      ["netizen_agent", "Mecky", "mecky"], ["e", mention.id, "", "reply"], ["p", mention.pubkey],
      ["source-app-post", POST], ["mecky-receipt", `urn:stadtstack:mecky-answer:${"a".repeat(64)}`],
      ["municipality", "roebel-mueritz"], ["topic", "urn:stadtstack:topic:municipality:roebel-mueritz:marienfelder-strasse"],
      ["evidence", `sha256:${"b".repeat(64)}`, "https://example.test/ris"],
    ],
  });
  const expected = {
    agentPubkey, sourceAppPostId: POST, conversationTopic: "roebel-app-conversation",
    municipalityId: "roebel-mueritz", topicId: "urn:stadtstack:topic:municipality:roebel-mueritz:marienfelder-strasse",
  };
  assert.ok(verifyAppConversationExchange(mention, reply, expected));
  assert.equal(verifyAppConversationExchange(mention, { ...reply, tags: [...reply.tags, ["evidence", `sha256:${"c".repeat(64)}`, "https://example.test/too-many"]] }, expected), null);
  assert.equal(verifyAppConversationExchange(mention, { ...reply, tags: reply.tags.map((tag) => tag[0] === "source-app-post" ? ["source-app-post", COMMENT] : tag) }, expected), null);
});

test("binds an optional comment in its one permitted tag position", () => {
  const event = buildNoteEvent(SECRET_KEY, "@Mecky, was meinst du?", {
    createdAt: 1_787_659_200,
    tags: [
      ["p", AGENT],
      ["source-app-post", POST],
      ["source-app-comment", COMMENT],
      ["t", APP_CONVERSATION_TOPIC],
    ],
  });
  assert.equal(
    isAppConversationMentionEvent(event, {
      agentPubkey: AGENT,
      sourceAppPostId: POST,
      sourceAppCommentId: COMMENT,
    }),
    true,
  );
  assert.equal(
    isAppConversationMentionEvent(event, {
      agentPubkey: AGENT,
      sourceAppPostId: POST,
    }),
    false,
  );
});
