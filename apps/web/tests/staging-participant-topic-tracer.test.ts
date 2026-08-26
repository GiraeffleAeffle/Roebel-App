import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import {
  promoteStagingParticipantSourcePost,
  signStagingParticipantTopicSuggestion,
} from "../src/lib/staging-participant/topic-tracer.ts";
import { createCitizenSession } from "../src/lib/citizen-session/session.ts";
import {
  buildCivicTopicPromotionEvent,
  buildNoteEvent,
  deriveNostrIdentity,
} from "@netizen-labs/nostr";

const originalFetch = globalThis.fetch;
const originalLocalStorage = Object.getOwnPropertyDescriptor(
  globalThis,
  "localStorage",
);
const SOURCE_POST_ID = "11111111-1111-4111-8111-111111111111";
const MECKY_PUBKEY = "d".repeat(64);

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }

  removeItem(key: string) {
    this.values.delete(key);
  }
}

beforeEach(() => {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: new MemoryStorage(),
  });
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalLocalStorage) {
    Object.defineProperty(globalThis, "localStorage", originalLocalStorage);
  } else {
    Reflect.deleteProperty(globalThis, "localStorage");
  }
});

test("an author promotion replays one exact signed request after publish-completion failure and reload", async () => {
  const calls: Array<{ path: string; body: Record<string, unknown> }> = [];
  let gatewayAvailable = false;
  globalThis.fetch = async (input, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    calls.push({ path: String(input), body });
    if (!gatewayAvailable) {
      return new Response(JSON.stringify({ error: "temporary_unavailable" }), {
        status: 503,
        headers: { "content-type": "application/json" },
      });
    }
    const rootEvent = body.rootEvent as { id: string };
    return new Response(
      JSON.stringify({
        schemaVersion: "staging_source_post_promotion_receipt_v1",
        status: "promoted",
        sourcePostId: SOURCE_POST_ID,
        discussionRootId: rootEvent.id,
        topicId: "urn:stadtstack:topic:municipality:roebel-mueritz:offener-treffpunkt",
        sourceConversation: {
          sourceAppPostId: SOURCE_POST_ID,
          sourceAppCommentId: "22222222-2222-4222-8222-222222222222",
          mentionEventId: "e".repeat(64),
          meckyReplyEventId: "f".repeat(64),
        },
        authorityBinding: "none",
        policyVersion: "staging-participant-topic-v1",
        receiptChecksum: "a".repeat(64),
      }),
      { status: 201, headers: { "content-type": "application/json" } },
    );
  };
  const session = createCitizenSession({
    memberId: null,
    appAccountId: null,
    credential: {
      kind: "thirdweb_smart_account",
      address: "0x1111111111111111111111111111111111111111",
      chainId: 100,
      async signMessage() {
        return `0x${"12".repeat(65)}`;
      },
    },
  });
  const sourceNote = await session.signConversationMention({
    content: "@Mecky, welche Optionen gibt es?",
    createdAt: 1_787_659_100,
    agentPubkey: MECKY_PUBKEY,
    sourceAppPostId: SOURCE_POST_ID,
  });
  const rootEvent = await session.promotePublicPostToTopic({
    sourcePost: sourceNote,
    municipalityId: "roebel-mueritz",
    topicId: "urn:stadtstack:topic:municipality:roebel-mueritz:offener-treffpunkt",
    topicTitle: "Offener Treffpunkt",
    agentPubkey: MECKY_PUBKEY,
    content: "@Mecky, welche geprüften Informationen gibt es?",
    createdAt: 1_787_659_101,
  });

  await assert.rejects(
    promoteStagingParticipantSourcePost({
      sourcePostId: SOURCE_POST_ID,
      rootEvent,
    }),
    /temporary_unavailable/u,
  );
  gatewayAvailable = true;
  const replacementRoot = await session.promotePublicPostToTopic({
    sourcePost: sourceNote,
    municipalityId: "roebel-mueritz",
    topicId: "urn:stadtstack:topic:municipality:roebel-mueritz:offener-treffpunkt",
    topicTitle: "Offener Treffpunkt",
    agentPubkey: MECKY_PUBKEY,
    content: "@Mecky, welche geprüften Informationen gibt es?",
    createdAt: 1_787_659_102,
  });
  assert.notEqual(replacementRoot.id, rootEvent.id);

  const receipt = await promoteStagingParticipantSourcePost({
    sourcePostId: SOURCE_POST_ID,
    rootEvent: replacementRoot,
  });

  assert.equal(receipt.status, "promoted");
  assert.equal(receipt.discussionRootId, rootEvent.id);
  assert.equal(receipt.authorityBinding, "none");
  assert.deepEqual(calls.map((call) => call.path), [
    "/api/staging-participant/v1/promote-source-post",
    "/api/staging-participant/v1/promote-source-post",
    "/api/staging-participant/v1/promote-source-post",
  ]);
  assert.deepEqual(calls[0]!.body, calls[1]!.body);
  assert.deepEqual(calls[1]!.body, calls[2]!.body);
  assert.equal((calls[2]!.body.rootEvent as { id: string }).id, rootEvent.id);
  assert.match(String(calls[2]!.body.requestId), /^[0-9a-f-]{36}$/iu);
  assert.equal(
    calls[2]!.body.idempotencyKey,
    `promotion-${calls[2]!.body.requestId}`,
  );
  assert.deepEqual(Object.keys(calls[2]!.body).sort(), [
    "idempotencyKey",
    "requestId",
    "rootEvent",
    "schemaVersion",
    "sourcePostId",
  ]);
  assert.equal(
    calls[2]!.body.schemaVersion,
    "staging_source_post_promotion_v1",
  );
  assert.equal(calls[2]!.body.sourcePostId, SOURCE_POST_ID);
  assert.deepEqual(calls[2]!.body.rootEvent, rootEvent);
  assert.doesNotMatch(JSON.stringify(calls[2]!.body), /signed-event|case|vote|treasury/u);
  session.dispose();
});

test("promotion accepts only documented optional source-conversation fields", async () => {
  let includeUnexpectedField = false;
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    const rootEvent = body.rootEvent as { id: string };
    return new Response(
      JSON.stringify({
        schemaVersion: "staging_source_post_promotion_receipt_v1",
        status: "already_promoted",
        sourcePostId: SOURCE_POST_ID,
        discussionRootId: rootEvent.id,
        topicId: "urn:stadtstack:topic:municipality:roebel-mueritz:offener-treffpunkt",
        sourceConversation: {
          sourceAppPostId: SOURCE_POST_ID,
          mentionEventId: "e".repeat(64),
          meckyReplyEventId: "f".repeat(64),
          ...(includeUnexpectedField ? { unexpected: true } : {}),
        },
        authorityBinding: "none",
        policyVersion: "staging-participant-topic-v1",
        receiptChecksum: "a".repeat(64),
      }),
      { status: 201, headers: { "content-type": "application/json" } },
    );
  };
  const session = createCitizenSession({
    memberId: null,
    appAccountId: null,
    credential: {
      kind: "thirdweb_smart_account",
      address: "0x1111111111111111111111111111111111111111",
      chainId: 100,
      async signMessage() {
        return `0x${"12".repeat(65)}`;
      },
    },
  });
  const sourceNote = await session.signConversationMention({
    content: "@Mecky, welche Optionen gibt es?",
    createdAt: 1_787_659_100,
    agentPubkey: MECKY_PUBKEY,
    sourceAppPostId: SOURCE_POST_ID,
  });
  const rootEvent = await session.promotePublicPostToTopic({
    sourcePost: sourceNote,
    municipalityId: "roebel-mueritz",
    topicId: "urn:stadtstack:topic:municipality:roebel-mueritz:offener-treffpunkt",
    topicTitle: "Offener Treffpunkt",
    agentPubkey: MECKY_PUBKEY,
    content: "@Mecky, welche geprüften Informationen gibt es?",
    createdAt: 1_787_659_101,
  });

  const receipt = await promoteStagingParticipantSourcePost({
    sourcePostId: SOURCE_POST_ID,
    rootEvent,
  });

  assert.equal(receipt.status, "already_promoted");
  assert.equal(receipt.sourceConversation?.sourceAppCommentId, undefined);
  assert.equal(receipt.sourceConversation?.meckyReceiptId, undefined);
  includeUnexpectedField = true;
  await assert.rejects(
    promoteStagingParticipantSourcePost({ sourcePostId: SOURCE_POST_ID, rootEvent }),
    /staging_participant_promotion_receipt_invalid/u,
  );
  session.dispose();
});

test("a participant suggestion replays its exact adoption-required hand-off until completion", async () => {
  const calls: Array<{ path: string; body: Record<string, unknown> }> = [];
  let gatewayAvailable = false;
  globalThis.fetch = async (input, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    calls.push({ path: String(input), body });
    if (!gatewayAvailable) {
      return new Response(JSON.stringify({ error: "temporary_unavailable" }), {
        status: 503,
        headers: { "content-type": "application/json" },
      });
    }
    const root = body.discussionRootEvent as { id: string };
    const answer = body.meckyAnswerEvent as { id: string };
    const suggestion = body.suggestionEvent as { id: string };
    return new Response(
      JSON.stringify({
        schemaVersion: "staging_topic_suggestion_receipt_v1",
        status: "signed",
        suggestionId: suggestion.id,
        discussionRootId: root.id,
        meckyAnswerId: answer.id,
        meckyReceiptId: `urn:stadtstack:mecky-answer:${"a".repeat(64)}`,
        topicId: "urn:stadtstack:topic:municipality:roebel-mueritz:offener-treffpunkt",
        entryState: "citizen_adoption_required",
        authorityBinding: "none",
        submittedToCivicWorkflow: false,
        policyVersion: "staging-participant-topic-v1",
        receiptChecksum: "b".repeat(64),
      }),
      { status: 201, headers: { "content-type": "application/json" } },
    );
  };
  const author = deriveNostrIdentity(`0x${"1".repeat(130)}`);
  const mecky = deriveNostrIdentity(`0x${"2".repeat(130)}`);
  const participantSession = createCitizenSession({
    memberId: null,
    appAccountId: null,
    credential: {
      kind: "thirdweb_smart_account",
      address: "0x1111111111111111111111111111111111111111",
      chainId: 100,
      async signMessage() {
        return `0x${"1".repeat(130)}`;
      },
    },
  });
  const topicId = "urn:stadtstack:topic:municipality:roebel-mueritz:offener-treffpunkt";
  const sourceNote = buildNoteEvent(author.secretKey, "@Mecky, was hilft?", {
    createdAt: 1_787_659_100,
    tags: [
      ["p", mecky.publicKey],
      ["source-app-post", SOURCE_POST_ID],
      ["t", "roebel-app-conversation"],
    ],
  });
  const root = buildCivicTopicPromotionEvent(author.secretKey, {
    municipalityId: "roebel-mueritz",
    topicId,
    topicTitle: "Offener Treffpunkt",
    sourcePost: sourceNote,
    agentPubkey: mecky.publicKey,
    content: "@Mecky, welche Optionen gibt es?",
    createdAt: 1_787_659_110,
  });
  const receiptId = `urn:stadtstack:mecky-answer:${"a".repeat(64)}`;
  const answer = buildNoteEvent(mecky.secretKey, "Eine Quelle nennt mögliche Räume.", {
    createdAt: 1_787_659_120,
    tags: [
      ["netizen_agent", "Mecky", "roebel-staging"],
      ["e", root.id, "", "reply"],
      ["p", author.publicKey],
      ["source-app-post", SOURCE_POST_ID],
      ["mecky-receipt", receiptId],
      ["municipality", "roebel-mueritz"],
      ["topic", topicId],
      ["evidence", `sha256:${"c".repeat(64)}`, "https://example.invalid/source"],
    ],
  });
  const suggestion = (await participantSession.signParticipantTopicSuggestion({
    binding: { municipalityId: "roebel-mueritz", topicId },
    sourcePost: sourceNote,
    sourceDiscussion: root,
    sourceAnswer: answer,
    agentPubkey: mecky.publicKey,
    title: "Offener Treffpunkt",
    summary: "Räume und Trägerschaft gemeinsam prüfen.",
    createdAt: 1_787_659_130,
  })).event;

  const operation = {
    discussionRootEvent: root,
    meckyAnswerEvent: answer,
    suggestionEvent: suggestion,
  } as const;
  await assert.rejects(
    signStagingParticipantTopicSuggestion(operation),
    /temporary_unavailable/u,
  );
  gatewayAvailable = true;
  const receipt = await signStagingParticipantTopicSuggestion(operation);

  assert.equal(receipt.entryState, "citizen_adoption_required");
  assert.equal(receipt.authorityBinding, "none");
  assert.equal(receipt.submittedToCivicWorkflow, false);
  assert.deepEqual(calls.map((call) => call.path), [
    "/api/staging-participant/v1/sign-topic-suggestion",
    "/api/staging-participant/v1/sign-topic-suggestion",
    "/api/staging-participant/v1/sign-topic-suggestion",
  ]);
  assert.deepEqual(calls[0]!.body, calls[1]!.body);
  assert.deepEqual(calls[1]!.body, calls[2]!.body);
  assert.deepEqual(Object.keys(calls[2]!.body).sort(), [
    "discussionRootEvent",
    "idempotencyKey",
    "meckyAnswerEvent",
    "requestId",
    "schemaVersion",
    "suggestionEvent",
  ]);
  assert.equal(
    calls[2]!.body.schemaVersion,
    "staging_topic_suggestion_signature_v1",
  );
  assert.doesNotMatch(JSON.stringify(calls[2]!.body), /signed-event|case|vote|treasury/u);
  participantSession.dispose();
});
