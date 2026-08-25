import assert from "node:assert/strict";
import { test } from "node:test";

import {
  APP_CONVERSATION_TOPIC,
  isAppConversationMentionEvent,
} from "../src/conversation";
import { buildNoteEvent } from "../src/events";
import { deriveNostrSecretKey } from "../src/keys";

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
