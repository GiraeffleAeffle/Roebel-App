import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import {
  buildBindingEvent,
  buildCivicTopicPromotionEvent,
  buildNoteEvent,
  buildParticipantTopicSuggestion,
  deriveNostrIdentity,
  getPublicKeyHex,
} from "@netizen-labs/nostr";

import { createStagingParticipantGatewayHandler } from "../src/http.ts";
import {
  CHALLENGE_COOKIE,
  MAX_PENDING_CHALLENGES,
  PARTICIPANT_COOKIE_PATH,
  SESSION_COOKIE,
  prepareChallengeStore,
  type ChallengeStore,
} from "../src/protocol.ts";
import type {
  MeckyMirrorAdapter,
  StagingParticipantDataAdapter,
  StagingParticipantMirrorReceipt,
  StagingParticipantPromotionReceipt,
  StagingParticipantSuggestionReceipt,
  StagingParticipantTopicTracerAdapter,
  WalletSignatureVerifier,
} from "../src/types.ts";

const ORIGIN = "https://roebel-web.staging.agentcart.eu";
const WALLET = "0x1111111111111111111111111111111111111111";
const OTHER_WALLET = "0x2222222222222222222222222222222222222222";
const INVITE = "bounded-test-invite";
const INVITE_SHA256 = createHash("sha256").update(INVITE).digest("hex");
const KEY = "k".repeat(32);
const MECKY_PUBKEY = "a".repeat(64);
const POST_REQUEST_ID = "20000000-0000-4000-8000-000000000001";
const COMMENT_REQUEST_ID = "20000000-0000-4000-8000-000000000002";

function cookieValue(response: Response, name: string): string {
  const setCookie = response.headers.get("set-cookie") ?? "";
  assert.match(
    setCookie,
    new RegExp(`; Path=${PARTICIPANT_COOKIE_PATH}; HttpOnly; Secure; SameSite=Strict;`),
  );
  assert.doesNotMatch(setCookie, /; Path=\/;/u);
  const matched = setCookie.match(new RegExp(`${name}=([^;]+)`));
  assert.ok(matched, `missing ${name} cookie`);
  return `${name}=${matched[1]}`;
}

function request(path: string, init: RequestInit = {}): Request {
  return new Request(`https://participant-gateway.staging.agentcart.eu${path}`, {
    ...init,
    headers: { origin: ORIGIN, ...(init.headers ?? {}) },
  });
}

function jsonRequest(path: string, body: unknown, cookie?: string): Request {
  return request(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

function fixture(input: Partial<{
  verify: boolean;
  nowMs: number;
  mirrorFails: boolean;
  ready: boolean;
  mirrorReceipts: Map<string, StagingParticipantMirrorReceipt>;
  promotionReceipts: Map<string, StagingParticipantPromotionReceipt>;
  suggestionReceipts: Map<string, StagingParticipantSuggestionReceipt>;
  topicTracer: StagingParticipantTopicTracerAdapter;
  meckyPubkey: string;
  sourceBindingPubkey: string;
}> = {}) {
  let nowMs = input.nowMs ?? Date.parse("2026-08-25T12:00:00.000Z");
  let mirrorFails = input.mirrorFails ?? false;
  const calls: Array<{ kind: "post" | "comment"; walletAddress: string; content: string; postId?: string }> = [];
  const verifier: WalletSignatureVerifier = {
    async verifyWalletSignature({ address, message, signature }) {
      assert.equal(address, WALLET);
      assert.match(message, /(?:Staging-Testteilnahme|Netizen Nostr-Binding v1)/u);
      return signature === "0xaaaa" && (input.verify ?? true);
    },
  };
  const mirrorReceipts = input.mirrorReceipts ?? new Map<string, StagingParticipantMirrorReceipt>();
  const promotionReceipts = input.promotionReceipts ?? new Map<string, StagingParticipantPromotionReceipt>();
  const suggestionReceipts = input.suggestionReceipts ?? new Map<string, StagingParticipantSuggestionReceipt>();
  const receiptKey = (walletAddress: string, sourcePostId: string) =>
    `${walletAddress.toLowerCase()}:${sourcePostId.toLowerCase()}`;
  const data: StagingParticipantDataAdapter = {
    async createMainTextPost({ walletAddress, content }) {
      calls.push({ kind: "post", walletAddress, content });
      return {
        id: "10000000-0000-4000-8000-000000000001", wallet_address: walletAddress,
        account_id: null, content, media_urls: [], video_url: null, category: "generell",
        status: "published", likes_count: 0, comments_count: 0,
        created_at: "2026-08-25T12:00:00.000Z", updated_at: "2026-08-25T12:00:00.000Z",
        post_type: "user", feed_type: "main", linked_event_id: null, linked_experience_id: null,
      };
    },
    async createMainTextComment({ walletAddress, postId, content }) {
      calls.push({ kind: "comment", walletAddress, postId, content });
      return {
        id: "10000000-0000-4000-8000-000000000002", post_id: postId, wallet_address: walletAddress,
        account_id: null, content, media_urls: [], video_url: null, status: "published",
        created_at: "2026-08-25T12:00:00.000Z", author_username: null, author_profile_picture_url: null,
      };
    },
    async readOwnedMainTextPost({ walletAddress, postId }) {
      if (walletAddress !== WALLET || ![
        "10000000-0000-4000-8000-000000000001",
        "10000000-0000-4000-8000-000000000003",
      ].includes(postId)) {
        return null;
      }
      return {
        id: postId, wallet_address: walletAddress,
        account_id: null, content: "@Mecky, was ist der nächste sinnvolle Schritt?", media_urls: [], video_url: null,
        category: "generell", status: "published", likes_count: 0, comments_count: 0,
        created_at: "2026-08-25T12:00:00.000Z", updated_at: "2026-08-25T12:00:00.000Z",
        post_type: "user", feed_type: "main", linked_event_id: null, linked_experience_id: null,
      };
    },
    async reserveNostrPostMirror(mirrorInput) {
      const key = receiptKey(mirrorInput.walletAddress, mirrorInput.sourcePostId);
      const existing = mirrorReceipts.get(key);
      if (existing) {
        if (existing.request_id !== mirrorInput.requestId || existing.event_id !== mirrorInput.eventId ||
          existing.event_created_at !== mirrorInput.eventCreatedAt ||
          existing.content_sha256 !== mirrorInput.contentSha256) {
          throw new Error("staging_participant_mirror_conflict");
        }
        return existing;
      }
      if ([...mirrorReceipts.values()].some((receipt) => receipt.request_id === mirrorInput.requestId)) {
        throw new Error("staging_participant_mirror_conflict");
      }
      if (Math.abs(mirrorInput.eventCreatedAt - Math.floor(nowMs / 1_000)) > 300) {
        throw new Error("staging_participant_mirror_stale");
      }
      const receipt: StagingParticipantMirrorReceipt = {
        wallet_address: mirrorInput.walletAddress,
        source_post_id: mirrorInput.sourcePostId,
        request_id: mirrorInput.requestId,
        event_id: mirrorInput.eventId,
        event_created_at: mirrorInput.eventCreatedAt,
        content_sha256: mirrorInput.contentSha256,
        state: "reserved",
      };
      mirrorReceipts.set(key, receipt);
      return receipt;
    },
    async completeNostrPostMirror(mirrorInput) {
      const key = receiptKey(mirrorInput.walletAddress, mirrorInput.sourcePostId);
      const receipt = mirrorReceipts.get(key);
      if (!receipt || receipt.request_id !== mirrorInput.requestId || receipt.event_id !== mirrorInput.eventId ||
        receipt.content_sha256 !== mirrorInput.contentSha256) {
        throw new Error("staging_participant_mirror_conflict");
      }
      const published: StagingParticipantMirrorReceipt = { ...receipt, state: "published" };
      mirrorReceipts.set(key, published);
      return published;
    },
    async bindPublishedNostrPostMirror({ walletAddress, sourcePostId, eventId, nostrPubkey }) {
      return { wallet_address: walletAddress, source_post_id: sourcePostId, event_id: eventId, nostr_pubkey: nostrPubkey };
    },
    async resolvePublishedNostrPostMirror({ walletAddress, sourcePostId }) {
      return {
        wallet_address: walletAddress, source_post_id: sourcePostId,
        event_id: "f".repeat(64), nostr_pubkey: input.sourceBindingPubkey ?? "e".repeat(64),
      };
    },
    async reserveSourcePostPromotion(value): Promise<StagingParticipantPromotionReceipt> {
      const key = `${value.namespace}:${value.sourcePostId}`;
      const existing = promotionReceipts.get(key);
      if (existing) {
        if (existing.request_id !== value.requestId || existing.idempotency_key_sha256 !== value.idempotencyKeySha256 ||
          existing.discussion_root_id !== value.discussionRootId || existing.discussion_root_sha256 !== value.discussionRootSha256 ||
          existing.topic_id !== value.topicId || existing.policy_version !== value.policyVersion) {
          throw new Error("staging_participant_promotion_conflict");
        }
        return existing;
      }
      const receipt: StagingParticipantPromotionReceipt = {
        namespace: value.namespace, wallet_address: value.walletAddress, source_post_id: value.sourcePostId,
        request_id: value.requestId, idempotency_key_sha256: value.idempotencyKeySha256,
        discussion_root_id: value.discussionRootId, discussion_root_sha256: value.discussionRootSha256,
        topic_id: value.topicId, policy_version: value.policyVersion, state: "reserved", receipt_checksum: "c".repeat(64),
      };
      promotionReceipts.set(key, receipt);
      return receipt;
    },
    async completeSourcePostPromotion(value): Promise<StagingParticipantPromotionReceipt> {
      const key = `${value.namespace}:${value.sourcePostId}`;
      const receipt = promotionReceipts.get(key);
      if (!receipt || receipt.request_id !== value.requestId || receipt.idempotency_key_sha256 !== value.idempotencyKeySha256 ||
        receipt.discussion_root_id !== value.discussionRootId || receipt.discussion_root_sha256 !== value.discussionRootSha256) {
        throw new Error("staging_participant_promotion_conflict");
      }
      const published: StagingParticipantPromotionReceipt = { ...receipt, state: "published" };
      promotionReceipts.set(key, published);
      return published;
    },
    async resolvePublishedSourcePostPromotion({ walletAddress, namespace, discussionRootId, sourceAuthorPubkey }) {
      const receipt = [...promotionReceipts.values()].find((value) => value.wallet_address === walletAddress &&
        value.namespace === namespace && value.discussion_root_id === discussionRootId && value.state === "published");
      return receipt && sourceAuthorPubkey === (input.sourceBindingPubkey ?? "e".repeat(64)) ? receipt : null;
    },
    async reserveTopicSuggestion(value): Promise<StagingParticipantSuggestionReceipt> {
      const key = `${value.namespace}:${value.discussionRootId}:${value.sourceAuthorPubkey}`;
      const existing = suggestionReceipts.get(key);
      if (existing) {
        if (existing.request_id !== value.requestId || existing.idempotency_key_sha256 !== value.idempotencyKeySha256 ||
          existing.suggestion_id !== value.suggestionId || existing.suggestion_sha256 !== value.suggestionSha256) {
          throw new Error("staging_participant_suggestion_conflict");
        }
        return existing;
      }
      const receipt: StagingParticipantSuggestionReceipt = {
        namespace: value.namespace, wallet_address: value.walletAddress, discussion_root_id: value.discussionRootId,
        source_author_pubkey: value.sourceAuthorPubkey, request_id: value.requestId,
        idempotency_key_sha256: value.idempotencyKeySha256, suggestion_id: value.suggestionId,
        suggestion_sha256: value.suggestionSha256, mecky_answer_id: value.meckyAnswerId,
        mecky_receipt_id: value.meckyReceiptId, topic_id: value.topicId, policy_version: value.policyVersion,
        state: "reserved", receipt_checksum: "d".repeat(64),
      };
      suggestionReceipts.set(key, receipt);
      return receipt;
    },
    async completeTopicSuggestion(value): Promise<StagingParticipantSuggestionReceipt> {
      const key = `${value.namespace}:${value.discussionRootId}:${value.sourceAuthorPubkey}`;
      const receipt = suggestionReceipts.get(key);
      if (!receipt || receipt.request_id !== value.requestId || receipt.idempotency_key_sha256 !== value.idempotencyKeySha256 ||
        receipt.suggestion_id !== value.suggestionId || receipt.suggestion_sha256 !== value.suggestionSha256) {
        throw new Error("staging_participant_suggestion_conflict");
      }
      const published: StagingParticipantSuggestionReceipt = { ...receipt, state: "published" };
      suggestionReceipts.set(key, published);
      return published;
    },
  };
  const mirrored: unknown[] = [];
  const mirror: MeckyMirrorAdapter = {
    async mirrorPost(mirrorInput) {
      mirrored.push(mirrorInput);
      if (mirrorFails) throw new Error("upstream unavailable");
      return { status: "published", eventId: mirrorInput.event.id };
    },
  };
  let count = 0;
  const handler = createStagingParticipantGatewayHandler({
    config: {
      origin: ORIGIN,
      sessionHmacKey: KEY,
      inviteSha256: INVITE_SHA256,
      allowedWallets: [WALLET],
      cookieSecure: true,
      meckyPubkey: input.meckyPubkey ?? MECKY_PUBKEY,
      topicPolicy: {
        municipalityId: "roebel-mueritz",
        topicNamespace: "urn:stadtstack:topic:municipality:roebel-mueritz",
        sourceConversationTopic: "roebel-app-conversation",
        policyVersion: "staging-participant-topic-v1",
      },
    },
    verifier,
    data,
    mirror,
    ...(input.topicTracer ? { topicTracer: input.topicTracer } : {}),
    now: () => new Date(nowMs),
    randomId: () => (++count).toString(16).padStart(32, "0"),
    ...(input.ready === true ? {
      readiness: {
        async preflight() {
          return {
            migrationId: "20260825_staging_participant_gateway",
            databaseSchemaSha256: `sha256:${"d".repeat(64)}`,
          };
        },
        async preflightTopicTracer() {
          return { migrationId: "20260825_staging_participant_topic_tracer", databaseSchemaSha256: `sha256:${"e".repeat(64)}` };
        },
      },
      readinessPins: {
        sourceRevision: "a".repeat(40),
        manifestDigest: `sha256:${"b".repeat(64)}`,
        migrationSha256: `sha256:${"c".repeat(64)}`,
        databaseSchemaSha256: `sha256:${"d".repeat(64)}`,
        topicTracerMigrationSha256: `sha256:${"f".repeat(64)}`,
        topicTracerDatabaseSchemaSha256: `sha256:${"e".repeat(64)}`,
      },
    } : {}),
  });
  return {
    handler,
    calls,
    mirrored,
    mirrorReceipts,
    promotionReceipts,
    suggestionReceipts,
    setNow: (value: number) => { nowMs = value; },
    setMirrorFails: (value: boolean) => { mirrorFails = value; },
  };
}

async function enrolledSession(input: Parameters<typeof fixture>[0] = {}) {
  const setup = fixture(input);
  const challenge = await setup.handler(jsonRequest("/api/staging-participant/v1/challenge", {
    schemaVersion: "staging_participant_challenge_request_v1",
    walletAddress: WALLET,
    inviteToken: INVITE,
  }));
  assert.equal(challenge.status, 200);
  const challengeCookie = cookieValue(challenge, CHALLENGE_COOKIE);
  const session = await setup.handler(jsonRequest("/api/staging-participant/v1/session", {
    schemaVersion: "staging_participant_session_request_v1",
    signature: "0xaaaa",
  }, challengeCookie));
  assert.equal(session.status, 200);
  return { ...setup, sessionCookie: cookieValue(session, SESSION_COOKIE) };
}

test("requires an exact origin, invite hash and schema before issuing a wallet-bound challenge", async () => {
  const { handler } = fixture();
  assert.equal((await handler(new Request("https://gateway/api/staging-participant/v1/status"))).status, 200);
  assert.equal((await handler(new Request("https://gateway/api/staging-participant/v1/status", {
    headers: { origin: "https://attacker.invalid" },
  }))).status, 403);
  assert.equal((await handler(new Request("https://gateway/api/staging-participant/v1/challenge", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      schemaVersion: "staging_participant_challenge_request_v1",
      walletAddress: WALLET,
      inviteToken: INVITE,
    }),
  }))).status, 403);
  assert.equal((await handler(jsonRequest("/api/staging-participant/v1/challenge", {
    schemaVersion: "staging_participant_challenge_request_v1",
    walletAddress: WALLET,
    inviteToken: "wrong",
  }))).status, 401);
  assert.equal((await handler(jsonRequest("/api/staging-participant/v1/challenge", {
    schemaVersion: "staging_participant_challenge_request_v1",
    walletAddress: OTHER_WALLET,
    inviteToken: INVITE,
  }))).status, 401);
  assert.equal((await handler(jsonRequest("/api/staging-participant/v1/challenge", {
    schemaVersion: "staging_participant_challenge_request_v1",
    walletAddress: WALLET,
    inviteToken: INVITE,
    municipal: true,
  }))).status, 401);
});

test("invalidates an unconsumed challenge when the single gateway replica restarts", async () => {
  const beforeRestart = fixture();
  const challenge = await beforeRestart.handler(jsonRequest("/api/staging-participant/v1/challenge", {
    schemaVersion: "staging_participant_challenge_request_v1",
    walletAddress: WALLET,
    inviteToken: INVITE,
  }));
  const challengeCookie = cookieValue(challenge, CHALLENGE_COOKIE);

  const afterRestart = fixture();
  const session = await afterRestart.handler(jsonRequest("/api/staging-participant/v1/session", {
    schemaVersion: "staging_participant_session_request_v1",
    signature: "0xaaaa",
  }, challengeCookie));
  assert.equal(session.status, 401);
});

test("consumes each signed challenge once and binds its session to the exact verified wallet", async () => {
  const { handler } = fixture();
  const challenge = await handler(jsonRequest("/api/staging-participant/v1/challenge", {
    schemaVersion: "staging_participant_challenge_request_v1",
    walletAddress: WALLET,
    inviteToken: INVITE,
  }));
  const challengeCookie = cookieValue(challenge, CHALLENGE_COOKIE);
  const bad = await handler(jsonRequest("/api/staging-participant/v1/session", {
    schemaVersion: "staging_participant_session_request_v1",
    signature: "0xbbbb",
  }, challengeCookie));
  assert.equal(bad.status, 401);
  const replay = await handler(jsonRequest("/api/staging-participant/v1/session", {
    schemaVersion: "staging_participant_session_request_v1",
    signature: "0xaaaa",
  }, challengeCookie));
  assert.equal(replay.status, 401);
});

test("allows only a short-lived session to create personal main-feed text posts and comments", async () => {
  const { handler, calls, sessionCookie } = await enrolledSession();
  const post = await handler(jsonRequest("/api/staging-participant/v1/posts", {
    schemaVersion: "staging_participant_post_request_v1",
    requestId: POST_REQUEST_ID,
    content: "Die Beleuchtung am Weg sollte geprüft werden.",
  }, sessionCookie));
  assert.equal(post.status, 201);
  const comment = await handler(jsonRequest("/api/staging-participant/v1/comments", {
    schemaVersion: "staging_participant_comment_request_v1",
    requestId: COMMENT_REQUEST_ID,
    postId: "10000000-0000-4000-8000-000000000001",
    content: "Ich habe die Stelle ebenfalls beobachtet.",
  }, sessionCookie));
  assert.equal(comment.status, 201);
  assert.deepEqual(calls, [
    { kind: "post", walletAddress: WALLET, content: "Die Beleuchtung am Weg sollte geprüft werden." },
    {
      kind: "comment",
      walletAddress: WALLET,
      postId: "10000000-0000-4000-8000-000000000001",
      content: "Ich habe die Stelle ebenfalls beobachtet.",
    },
  ]);
});

test("promotes one server-resolved source note that is exactly the @Mecky mention once", async () => {
  const sourcePostId = "10000000-0000-4000-8000-000000000001";
  const sourceAppPostId = sourcePostId;
  const author = deriveNostrIdentity("0x" + "7".repeat(130));
  const mecky = deriveNostrIdentity("0x" + "8".repeat(130));
  const meckyPubkey = getPublicKeyHex(mecky.secretKey);
  const sourcePost = buildNoteEvent(author.secretKey, "@Mecky, was ist hierzu bekannt?", {
    createdAt: 1_787_659_110,
    tags: [["p", meckyPubkey], ["source-app-post", sourcePostId], ["t", "roebel-app-conversation"]],
  });
  const mentionEvent = sourcePost;
  const sourceReceipt = `urn:stadtstack:mecky-answer:${"a".repeat(64)}`;
  const meckyReplyEvent = buildNoteEvent(mecky.secretKey, "Die Stelle sollte mit der Verwaltung abgeglichen werden.", {
    createdAt: 1_787_659_120,
    tags: [
      ["netizen_agent", "Mecky", "roebel-staging"],
      ["e", mentionEvent.id, "", "reply"],
      ["p", sourcePost.pubkey],
      ["source-app-post", sourcePostId],
      ["mecky-receipt", sourceReceipt],
      ["evidence", `sha256:${"b".repeat(64)}`, "https://example.invalid/source"],
    ],
  });
  const topicId = "urn:stadtstack:topic:municipality:roebel-mueritz:marienfelder-strasse";
  const rootEvent = buildCivicTopicPromotionEvent(author.secretKey, {
    municipalityId: "roebel-mueritz", topicId, topicTitle: "Sichere Querung Marienfelder Straße",
    sourcePost, agentPubkey: meckyPubkey, content: "@Mecky, wie kann die Querung nachvollziehbar verbessert werden?",
    conversationSource: {
      kind: "selected_conversation", sourceAppPostId, mentionEventId: mentionEvent.id,
      replyEventId: meckyReplyEvent.id, receiptId: sourceReceipt,
    },
    createdAt: 1_787_659_130,
  });
  assert.equal(sourcePost.id, mentionEvent.id, "the published mirror is the exact @Mecky source note");
  const answerReceipt = `urn:stadtstack:mecky-answer:${"c".repeat(64)}`;
  const meckyAnswerEvent = buildNoteEvent(mecky.secretKey, "Eine eindeutige Markierung und Prüfung der Sichtachsen sind naheliegende Optionen.", {
    createdAt: 1_787_659_140,
    tags: [
      ["netizen_agent", "Mecky", "roebel-staging"],
      ["e", rootEvent.id, "", "reply"],
      ["p", sourcePost.pubkey],
      ["source-app-post", sourcePostId],
      ["mecky-receipt", answerReceipt],
      ["municipality", "roebel-mueritz"],
      ["topic", topicId],
      ["evidence", `sha256:${"d".repeat(64)}`, "https://example.invalid/answer"],
    ],
  });
  const suggestionEvent = buildParticipantTopicSuggestion(author.secretKey, {
    binding: { municipalityId: "roebel-mueritz", topicId }, sourcePost, sourceDiscussion: rootEvent,
    sourceAnswer: meckyAnswerEvent, agentPubkey: meckyPubkey,
    conversationWitnesses: { conversationTopic: "roebel-app-conversation", mentionEvent, replyEvent: meckyReplyEvent },
    title: "Sichere Querung Marienfelder Straße", summary: "Sichtbarkeit, Querung und Beleuchtung gemeinsam prüfen.",
    createdAt: 1_787_659_150,
  }).event;
  const publishedPromotions: string[] = [];
  const publishedSuggestions: string[] = [];
  const topicTracer: StagingParticipantTopicTracerAdapter = {
    async resolvePromotionSource(input) {
      assert.deepEqual(input, { sourceNoteEventId: "f".repeat(64), sourceAuthorPubkey: sourcePost.pubkey, sourceAppPostId: sourcePostId });
      return { sourceNote: sourcePost, meckyReplyEvent, meckyReceiptId: sourceReceipt };
    },
    async publishPromotion({ event }) { publishedPromotions.push(event.id); return { status: "published", eventId: event.id }; },
    async resolveTopicSuggestionSources(input) {
      assert.deepEqual(input, { discussionRootId: rootEvent.id, sourceAuthorPubkey: sourcePost.pubkey, sourceNoteEventId: "f".repeat(64), sourceAppPostId: sourcePostId });
      return { sourceNote: sourcePost, discussionRoot: rootEvent, meckyAnswer: meckyAnswerEvent, meckyReplyEvent, meckyReceiptId: sourceReceipt };
    },
    async publishTopicSuggestion({ event }) { publishedSuggestions.push(event.id); return { status: "published", eventId: event.id }; },
  };
  const { handler, sessionCookie } = await enrolledSession({ topicTracer, meckyPubkey, sourceBindingPubkey: sourcePost.pubkey });
  const body = {
    schemaVersion: "staging_source_post_promotion_v1",
    requestId: "20000000-0000-4000-8000-000000000020",
    idempotencyKey: "promotion-idempotency-0001",
    sourcePostId,
    rootEvent,
  };
  const [first, concurrent] = await Promise.all([
    handler(jsonRequest("/api/staging-participant/v1/promote-source-post", body, sessionCookie)),
    handler(jsonRequest("/api/staging-participant/v1/promote-source-post", body, sessionCookie)),
  ]);
  assert.equal(first.status, 201);
  assert.equal(concurrent.status, 201);
  assert.deepEqual(await first.json(), {
    schemaVersion: "staging_source_post_promotion_receipt_v1", status: "promoted", sourcePostId,
    discussionRootId: rootEvent.id, topicId,
    sourceConversation: {
      sourceAppPostId, mentionEventId: mentionEvent.id, meckyReplyEventId: meckyReplyEvent.id,
      meckyReceiptId: sourceReceipt,
    },
    authorityBinding: "none", policyVersion: "staging-participant-topic-v1", receiptChecksum: "c".repeat(64),
  });
  assert.deepEqual([...new Set(publishedPromotions)], [rootEvent.id]);
  const retry = await handler(jsonRequest("/api/staging-participant/v1/promote-source-post", body, sessionCookie));
  assert.equal(retry.status, 200);
  assert.equal((await retry.json() as { status: string }).status, "already_promoted");
  const replacement = buildCivicTopicPromotionEvent(author.secretKey, {
    municipalityId: "roebel-mueritz", topicId, topicTitle: "Andere Überschrift", sourcePost,
    agentPubkey: meckyPubkey, content: "@Mecky, bitte diesmal anders erklären.",
    conversationSource: {
      kind: "selected_conversation", sourceAppPostId, mentionEventId: mentionEvent.id,
      replyEventId: meckyReplyEvent.id, receiptId: sourceReceipt,
    },
    createdAt: 1_787_659_131,
  });
  assert.equal((await handler(jsonRequest("/api/staging-participant/v1/promote-source-post", {
    ...body, requestId: "20000000-0000-4000-8000-000000000021", idempotencyKey: "promotion-idempotency-0002", rootEvent: replacement,
  }, sessionCookie))).status, 409);

  const suggestionBody = {
    schemaVersion: "staging_topic_suggestion_signature_v1",
    requestId: "20000000-0000-4000-8000-000000000022",
    idempotencyKey: "suggestion-idempotency-0001",
    discussionRootEvent: rootEvent,
    meckyAnswerEvent,
    suggestionEvent,
  };
  const [signed, signedConcurrent] = await Promise.all([
    handler(jsonRequest("/api/staging-participant/v1/sign-topic-suggestion", suggestionBody, sessionCookie)),
    handler(jsonRequest("/api/staging-participant/v1/sign-topic-suggestion", suggestionBody, sessionCookie)),
  ]);
  assert.equal(signed.status, 201);
  assert.equal(signedConcurrent.status, 201);
  assert.equal((await signed.json() as { suggestionId: string; entryState: string; authorityBinding: string }).suggestionId, suggestionEvent.id);
  assert.deepEqual([...new Set(publishedSuggestions)], [suggestionEvent.id]);
  const signedRetry = await handler(jsonRequest("/api/staging-participant/v1/sign-topic-suggestion", suggestionBody, sessionCookie));
  assert.equal(signedRetry.status, 200);
  assert.equal((await signedRetry.json() as { status: string }).status, "already_signed");
  const replacementSuggestion = buildParticipantTopicSuggestion(author.secretKey, {
    binding: { municipalityId: "roebel-mueritz", topicId }, sourcePost, sourceDiscussion: rootEvent,
    sourceAnswer: meckyAnswerEvent, agentPubkey: meckyPubkey,
    conversationWitnesses: { conversationTopic: "roebel-app-conversation", mentionEvent, replyEvent: meckyReplyEvent },
    title: "Andere Zusammenfassung", summary: "Dieselbe Quelle mit abweichendem Entwurf.", createdAt: 1_787_659_151,
  }).event;
  assert.equal((await handler(jsonRequest("/api/staging-participant/v1/sign-topic-suggestion", {
    ...suggestionBody, requestId: "20000000-0000-4000-8000-000000000023",
    idempotencyKey: "suggestion-idempotency-0002", suggestionEvent: replacementSuggestion,
  }, sessionCookie))).status, 409);
});

test("mirrors only the exact owner-signed @Mecky post after its source row exists", async () => {
  const { handler, mirrored, sessionCookie } = await enrolledSession();
  const identity = deriveNostrIdentity("0x" + "1".repeat(130));
  const bindingEvent = buildBindingEvent(identity.secretKey, WALLET, { createdAt: 1_787_659_199 });
  const event = buildNoteEvent(
    identity.secretKey,
    "@Mecky, was ist der nächste sinnvolle Schritt?",
    {
      createdAt: 1_787_659_200,
      tags: [
        ["p", MECKY_PUBKEY],
        ["source-app-post", "10000000-0000-4000-8000-000000000001"],
        ["t", "roebel-app-conversation"],
      ],
    },
  );
  const response = await handler(jsonRequest("/api/staging-participant/v1/nostr-post", {
    schemaVersion: "staging_participant_nostr_post_request_v1",
    requestId: "20000000-0000-4000-8000-000000000003",
    sourcePostId: "10000000-0000-4000-8000-000000000001",
    admissionProof: {
      schemaVersion: "roebel_citizen_admission_proof_v1",
      credential: { kind: "thirdweb_smart_account", address: WALLET, chainId: 100 },
      statement: bindingEvent.content,
      walletSignature: "0xaaaa",
      bindingEvent,
    },
    event,
  }, sessionCookie));
  assert.equal(response.status, 201);
  assert.equal(mirrored.length, 1);
  assert.equal((mirrored[0] as { event: { id: string } }).event.id, event.id);
  assert.equal((await handler(jsonRequest("/api/staging-participant/v1/nostr-post", {
    schemaVersion: "staging_participant_nostr_post_request_v1",
    requestId: "20000000-0000-4000-8000-000000000003",
    sourcePostId: "10000000-0000-4000-8000-000000000001",
    admissionProof: {
      schemaVersion: "roebel_citizen_admission_proof_v1",
      credential: { kind: "thirdweb_smart_account", address: WALLET, chainId: 100 },
      statement: bindingEvent.content, walletSignature: "0xaaaa", bindingEvent,
    }, event,
  }, sessionCookie))).status, 200);
  assert.equal(mirrored.length, 1);

  const tagDrift = buildNoteEvent(identity.secretKey, event.content, {
    createdAt: 1_787_659_201,
    tags: [["p", "b".repeat(64)], ["source-app-post", "10000000-0000-4000-8000-000000000001"]],
  });
  assert.equal((await handler(jsonRequest("/api/staging-participant/v1/nostr-post", {
    schemaVersion: "staging_participant_nostr_post_request_v1",
    requestId: "20000000-0000-4000-8000-000000000004",
    sourcePostId: "10000000-0000-4000-8000-000000000001",
    admissionProof: {
      schemaVersion: "roebel_citizen_admission_proof_v1",
      credential: { kind: "thirdweb_smart_account", address: WALLET, chainId: 100 },
      statement: bindingEvent.content, walletSignature: "0xaaaa", bindingEvent,
    }, event: tagDrift,
  }, sessionCookie))).status, 400);

  const sourceDrift = buildNoteEvent(identity.secretKey, "@Mecky, anderer Quelltext", {
    createdAt: 1_787_659_202,
    tags: [["p", MECKY_PUBKEY], ["source-app-post", "10000000-0000-4000-8000-000000000001"], ["t", "roebel-app-conversation"]],
  });
  assert.equal((await handler(jsonRequest("/api/staging-participant/v1/nostr-post", {
    schemaVersion: "staging_participant_nostr_post_request_v1",
    requestId: "20000000-0000-4000-8000-000000000005",
    sourcePostId: "10000000-0000-4000-8000-000000000001",
    admissionProof: {
      schemaVersion: "roebel_citizen_admission_proof_v1",
      credential: { kind: "thirdweb_smart_account", address: WALLET, chainId: 100 },
      statement: bindingEvent.content, walletSignature: "0xaaaa", bindingEvent,
    }, event: sourceDrift,
  }, sessionCookie))).status, 409);
});

test("refuses cross-wallet and malformed participant Mecky mirrors before their upstream", async () => {
  const { handler, mirrored, sessionCookie } = await enrolledSession();
  const identity = deriveNostrIdentity("0x" + "2".repeat(130));
  const bindingEvent = buildBindingEvent(identity.secretKey, OTHER_WALLET, { createdAt: 1_787_659_199 });
  const event = buildNoteEvent(identity.secretKey, "@Mecky, bitte einordnen", {
    createdAt: 1_787_659_200,
    tags: [["p", MECKY_PUBKEY], ["source-app-post", "10000000-0000-4000-8000-000000000001"], ["t", "roebel-app-conversation"]],
  });
  const response = await handler(jsonRequest("/api/staging-participant/v1/nostr-post", {
    schemaVersion: "staging_participant_nostr_post_request_v1",
    requestId: "20000000-0000-4000-8000-000000000006",
    sourcePostId: "10000000-0000-4000-8000-000000000001",
    admissionProof: {
      schemaVersion: "roebel_citizen_admission_proof_v1",
      credential: { kind: "thirdweb_smart_account", address: OTHER_WALLET, chainId: 100 },
      statement: bindingEvent.content, walletSignature: "0xaaaa", bindingEvent,
    }, event,
  }, sessionCookie));
  assert.equal(response.status, 400);
  assert.equal((await handler(jsonRequest("/api/staging-participant/v1/nostr-post", {
    schemaVersion: "staging_participant_nostr_post_request_v1",
  }, sessionCookie))).status, 400);
  assert.equal(mirrored.length, 0);
});

test("durably reserves one source event across concurrent gateway handlers and rejects replacement", async () => {
  const setup = await enrolledSession();
  const resumed = fixture({ mirrorReceipts: setup.mirrorReceipts });
  const identity = deriveNostrIdentity("0x" + "4".repeat(130));
  const bindingEvent = buildBindingEvent(identity.secretKey, WALLET, { createdAt: 1_787_659_199 });
  const sourcePostId = "10000000-0000-4000-8000-000000000001";
  const event = buildNoteEvent(identity.secretKey, "@Mecky, was ist der nächste sinnvolle Schritt?", {
    createdAt: 1_787_659_200,
    tags: [["p", MECKY_PUBKEY], ["source-app-post", sourcePostId], ["t", "roebel-app-conversation"]],
  });
  const body = {
    schemaVersion: "staging_participant_nostr_post_request_v1",
    requestId: "20000000-0000-4000-8000-000000000008",
    sourcePostId,
    admissionProof: {
      schemaVersion: "roebel_citizen_admission_proof_v1",
      credential: { kind: "thirdweb_smart_account", address: WALLET, chainId: 100 },
      statement: bindingEvent.content, walletSignature: "0xaaaa", bindingEvent,
    },
    event,
  };
  const [first, retry] = await Promise.all([
    setup.handler(jsonRequest("/api/staging-participant/v1/nostr-post", body, setup.sessionCookie)),
    resumed.handler(jsonRequest("/api/staging-participant/v1/nostr-post", body, setup.sessionCookie)),
  ]);
  assert.ok([200, 201].includes(first.status));
  assert.ok([200, 201].includes(retry.status));
  const receipt = [...setup.mirrorReceipts.values()][0];
  assert.equal(receipt?.event_id, event.id);
  assert.equal(receipt?.state, "published");

  const replacement = buildNoteEvent(identity.secretKey, event.content, {
    createdAt: 1_787_659_201,
    tags: [["p", MECKY_PUBKEY], ["source-app-post", sourcePostId], ["t", "roebel-app-conversation"]],
  });
  assert.equal((await resumed.handler(jsonRequest("/api/staging-participant/v1/nostr-post", {
    ...body,
    requestId: "20000000-0000-4000-8000-000000000009",
    event: replacement,
  }, setup.sessionCookie))).status, 409);
});

test("permits an old exact retry only after its first durable reservation", async () => {
  const setup = await enrolledSession({ mirrorFails: true });
  const identity = deriveNostrIdentity("0x" + "6".repeat(130));
  const bindingEvent = buildBindingEvent(identity.secretKey, WALLET, { createdAt: 1_787_659_199 });
  const event = buildNoteEvent(identity.secretKey, "@Mecky, was ist der nächste sinnvolle Schritt?", {
    createdAt: 1_787_659_200,
    tags: [["p", MECKY_PUBKEY], ["source-app-post", "10000000-0000-4000-8000-000000000001"], ["t", "roebel-app-conversation"]],
  });
  const body = {
    schemaVersion: "staging_participant_nostr_post_request_v1",
    requestId: "20000000-0000-4000-8000-000000000006",
    sourcePostId: "10000000-0000-4000-8000-000000000001",
    admissionProof: {
      schemaVersion: "roebel_citizen_admission_proof_v1",
      credential: { kind: "thirdweb_smart_account", address: WALLET, chainId: 100 },
      statement: bindingEvent.content, walletSignature: "0xaaaa", bindingEvent,
    },
    event,
  };
  assert.equal(
    (await setup.handler(jsonRequest("/api/staging-participant/v1/nostr-post", body, setup.sessionCookie))).status,
    503,
  );
  assert.equal([...setup.mirrorReceipts.values()][0]?.state, "reserved");
  assert.equal([...setup.mirrorReceipts.values()][0]?.event_created_at, event.created_at);
  setup.setNow(Date.parse("2026-08-25T12:11:00.000Z"));
  setup.setMirrorFails(false);
  const retryBindingEvent = buildBindingEvent(identity.secretKey, WALLET, {
    createdAt: 1_787_659_860,
  });
  assert.equal(
    (await setup.handler(jsonRequest("/api/staging-participant/v1/nostr-post", {
      ...body,
      admissionProof: {
        ...body.admissionProof,
        statement: retryBindingEvent.content,
        bindingEvent: retryBindingEvent,
      },
    }, setup.sessionCookie))).status,
    201,
  );
  assert.equal([...setup.mirrorReceipts.values()][0]?.state, "published");

  const firstOldEvent = buildNoteEvent(identity.secretKey, "@Mecky, was ist der nächste sinnvolle Schritt?", {
    createdAt: event.created_at,
    tags: [["p", MECKY_PUBKEY], ["source-app-post", "10000000-0000-4000-8000-000000000003"], ["t", "roebel-app-conversation"]],
  });
  assert.equal((await setup.handler(jsonRequest("/api/staging-participant/v1/nostr-post", {
    ...body,
    requestId: "20000000-0000-4000-8000-000000000007",
    sourcePostId: "10000000-0000-4000-8000-000000000003",
    event: firstOldEvent,
  }, setup.sessionCookie))).status, 400);
});

test("returns an honest failure without recording a successful mirror when the private adapter is unavailable", async () => {
  const setup = fixture({ mirrorFails: true });
  const challenge = await setup.handler(jsonRequest("/api/staging-participant/v1/challenge", {
    schemaVersion: "staging_participant_challenge_request_v1", walletAddress: WALLET, inviteToken: INVITE,
  }));
  const session = await setup.handler(jsonRequest("/api/staging-participant/v1/session", {
    schemaVersion: "staging_participant_session_request_v1", signature: "0xaaaa",
  }, cookieValue(challenge, CHALLENGE_COOKIE)));
  const identity = deriveNostrIdentity("0x" + "3".repeat(130));
  const bindingEvent = buildBindingEvent(identity.secretKey, WALLET, { createdAt: 1_787_659_199 });
  const event = buildNoteEvent(identity.secretKey, "@Mecky, was ist der nächste sinnvolle Schritt?", {
    createdAt: 1_787_659_200,
    tags: [["p", MECKY_PUBKEY], ["source-app-post", "10000000-0000-4000-8000-000000000001"], ["t", "roebel-app-conversation"]],
  });
  const body = {
    schemaVersion: "staging_participant_nostr_post_request_v1",
    requestId: "20000000-0000-4000-8000-000000000007",
    sourcePostId: "10000000-0000-4000-8000-000000000001",
    admissionProof: {
      schemaVersion: "roebel_citizen_admission_proof_v1",
      credential: { kind: "thirdweb_smart_account", address: WALLET, chainId: 100 },
      statement: bindingEvent.content, walletSignature: "0xaaaa", bindingEvent,
    }, event,
  };
  assert.equal((await setup.handler(jsonRequest("/api/staging-participant/v1/nostr-post", body, cookieValue(session, SESSION_COOKIE)))).status, 503);
  assert.equal((await setup.handler(jsonRequest("/api/staging-participant/v1/nostr-post", body, cookieValue(session, SESSION_COOKIE)))).status, 503);
  assert.equal(setup.mirrored.length, 2);
});

test("fails before the data adapter for missing session, non-text payloads, and civic-authority paths", async () => {
  const { handler, calls, sessionCookie } = await enrolledSession();
  assert.equal((await handler(jsonRequest("/api/staging-participant/v1/posts", {
    schemaVersion: "staging_participant_post_request_v1",
    requestId: POST_REQUEST_ID,
    content: "test",
  }))).status, 401);
  assert.equal((await handler(jsonRequest("/api/staging-participant/v1/posts", {
    schemaVersion: "staging_participant_post_request_v1",
    requestId: POST_REQUEST_ID,
    content: "test",
    poll: {},
  }, sessionCookie))).status, 400);
  assert.equal((await handler(jsonRequest("/api/staging-participant/v1/votes", {
    schemaVersion: "anything",
  }, sessionCookie))).status, 403);
  assert.equal((await handler(jsonRequest("/api/staging-participant/v1/promote-source-post", {
    schemaVersion: "wrong",
  }, sessionCookie))).status, 400);
  assert.equal((await handler(jsonRequest("/api/staging-participant/v1/posts", {
    schemaVersion: "staging_participant_post_request_v1",
    requestId: POST_REQUEST_ID,
    content: "x".repeat(251),
  }, sessionCookie))).status, 400);
  assert.equal((await handler(jsonRequest("/api/staging-participant/v1/comments", {
    schemaVersion: "staging_participant_comment_request_v1",
    requestId: COMMENT_REQUEST_ID,
    postId: "10000000-0000-4000-8000-000000000001",
    content: "https://example.invalid",
  }, sessionCookie))).status, 400);
  assert.equal(calls.length, 0);
});

test("admits the exact suggestion byte budget and rejects one UTF-8 byte over it", async () => {
  const { handler } = fixture();
  const envelope = (bytes: number) => {
    const prefix = '{"padding":"';
    const suffix = '"}';
    const body = `${prefix}${"x".repeat(bytes - Buffer.byteLength(prefix) - Buffer.byteLength(suffix))}${suffix}`;
    assert.equal(Buffer.byteLength(body, "utf8"), bytes);
    return request("/api/staging-participant/v1/sign-topic-suggestion", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
  };

  // Parsing succeeds at the exact route budget, then the request reaches the
  // next boundary (session admission). The extra byte is rejected first.
  assert.equal((await handler(envelope(64 * 1024))).status, 401);
  assert.equal((await handler(envelope(64 * 1024 + 1))).status, 413);
});

test("expires sessions and exposes only the exact status route", async () => {
  const { handler, setNow, sessionCookie } = await enrolledSession();
  setNow(Date.parse("2026-08-25T14:01:00.000Z"));
  assert.equal((await handler(request("/api/staging-participant/v1/status", { headers: { cookie: sessionCookie } }))).status, 200);
  const expired = await handler(jsonRequest("/api/staging-participant/v1/posts", {
    schemaVersion: "staging_participant_post_request_v1",
    requestId: POST_REQUEST_ID,
    content: "test",
  }, sessionCookie));
  assert.equal(expired.status, 401);
  assert.equal((await handler(request("/api/staging-participant/v1/anything"))).status, 404);
  assert.equal((await handler(request("/api/staging-participant/v1/posts"))).status, 405);
});

test("internal readiness stays non-ingressed, rejects browser-shaped requests, and returns only bound pins", async () => {
  const closed = fixture();
  assert.equal((await closed.handler(new Request("http://gateway.internal/status"))).status, 503);
  const { handler } = fixture({ ready: true });
  const ready = await handler(new Request("http://gateway.internal/status"));
  assert.equal(ready.status, 200);
  assert.deepEqual(await ready.json(), {
    schemaVersion: "roebel_staging_participant_gateway_status_v1",
    status: "ready",
    sourceRevision: "a".repeat(40),
    manifestDigest: `sha256:${"b".repeat(64)}`,
    migrationSha256: `sha256:${"c".repeat(64)}`,
    databaseSchemaSha256: `sha256:${"d".repeat(64)}`,
    topicTracerMigrationSha256: `sha256:${"f".repeat(64)}`,
    topicTracerDatabaseSchemaSha256: `sha256:${"e".repeat(64)}`,
  });
  for (const request of [
    new Request("http://gateway.internal/status?x=1"),
    new Request("http://gateway.internal/status", { method: "POST" }),
    new Request("http://gateway.internal/status", { headers: { origin: ORIGIN } }),
    new Request("http://gateway.internal/status", { headers: { cookie: "x=y" } }),
  ]) {
    const response = await handler(request);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      schemaVersion: "roebel_staging_participant_gateway_status_v1",
      status: "not_ready",
    });
    assert.equal(response.headers.get("access-control-allow-origin"), null);
    assert.equal(response.headers.get("set-cookie"), null);
  }
});

test("prunes stale challenges and caps a leaked invite's in-memory footprint", () => {
  const store: ChallengeStore = new Map();
  for (let index = 0; index < MAX_PENDING_CHALLENGES; index += 1) {
    store.set(index.toString(16).padStart(32, "0"), {
      walletAddress: `0x${index.toString(16).padStart(40, "0")}`,
      expiresAt: 2_000,
      consumed: false,
    });
  }
  assert.throws(
    () => prepareChallengeStore(store, 1_000, "0xffffffffffffffffffffffffffffffffffffffff"),
    /capacity_reached/u,
  );
  const first = store.keys().next().value as string;
  store.set(first, { ...store.get(first)!, expiresAt: 999 });
  prepareChallengeStore(store, 1_000, "0xffffffffffffffffffffffffffffffffffffffff");
  assert.equal(store.size, MAX_PENDING_CHALLENGES - 1);
});
