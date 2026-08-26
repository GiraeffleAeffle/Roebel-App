import { createServer, type IncomingMessage, type Server } from "node:http";
import { createHash } from "node:crypto";
import {
  bindingStatement,
  isAppConversationMentionEvent,
  verifyAppConversationExchange,
  verifyCivicTopicPromotionEvent,
  verifyBindingEvent,
  verifyEvent,
  verifyParticipantTopicSuggestion,
  type NostrEvent,
} from "@netizen-labs/nostr";

import {
  CHALLENGE_COOKIE,
  PARTICIPANT_LABEL,
  SESSION_COOKIE,
  challengeMessage,
  clearCookie,
  consumeChallenge,
  cookie,
  decodeSignedChallenge,
  decodeSignedSession,
  issueChallenge,
  issueSession,
  normalizeWallet,
  prepareChallengeStore,
  readCookie,
  type ChallengeStore,
  validInvite,
} from "./protocol.ts";
import type {
  MeckyMirrorAdapter,
  StagingParticipantDataAdapter,
  StagingParticipantGatewayConfig,
  StagingParticipantMirrorReceipt,
  StagingParticipantReadinessAdapter,
  StagingParticipantReadinessPins,
  StagingParticipantTopicTracerAdapter,
  WalletSignatureVerifier,
} from "./types.ts";

const DEFAULT_MAX_REQUEST_BYTES = 8 * 1024;
const SOURCE_POST_PROMOTION_MAX_REQUEST_BYTES = 16 * 1024;
const TOPIC_SUGGESTION_MAX_REQUEST_BYTES = 64 * 1024;
const MAX_CONTENT_BYTES = 2_000;
const MAX_POST_CHARACTERS = 250;
const MAX_COMMENT_CHARACTERS = 500;
const CHALLENGE_SCHEMA = "staging_participant_challenge_request_v1";
const SESSION_SCHEMA = "staging_participant_session_request_v1";
const POST_SCHEMA = "staging_participant_post_request_v1";
const COMMENT_SCHEMA = "staging_participant_comment_request_v1";
const NOSTR_POST_SCHEMA = "staging_participant_nostr_post_request_v1";
const SOURCE_POST_PROMOTION_SCHEMA = "staging_source_post_promotion_v1";
const TOPIC_SUGGESTION_SCHEMA = "staging_topic_suggestion_signature_v1";

const STATUS_PATH = "/api/staging-participant/v1/status";
const INTERNAL_STATUS_PATH = "/status";
const INTERNAL_STATUS_SCHEMA = "roebel_staging_participant_gateway_status_v1";
const CHALLENGE_PATH = "/api/staging-participant/v1/challenge";
const SESSION_PATH = "/api/staging-participant/v1/session";
const POSTS_PATH = "/api/staging-participant/v1/posts";
const COMMENTS_PATH = "/api/staging-participant/v1/comments";
const NOSTR_POST_PATH = "/api/staging-participant/v1/nostr-post";
const PROMOTE_SOURCE_POST_PATH = "/api/staging-participant/v1/promote-source-post";
const SIGN_TOPIC_SUGGESTION_PATH = "/api/staging-participant/v1/sign-topic-suggestion";
const AUTHORITY_PATHS = new Set([
  "/api/staging-participant/v1/cases",
  "/api/staging-participant/v1/votes",
  "/api/staging-participant/v1/treasury",
  "/api/staging-participant/v1/municipal",
]);

export type StagingParticipantGatewayDependencies = Readonly<{
  config: StagingParticipantGatewayConfig;
  verifier: WalletSignatureVerifier;
  data: StagingParticipantDataAdapter;
  mirror: MeckyMirrorAdapter;
  /** Omitted until the separately reviewed ADR-0022 resolver is wired. */
  topicTracer?: StagingParticipantTopicTracerAdapter;
  now?: () => Date;
  randomId?: () => string;
  /**
   * The default is process-local and intentionally makes this first slice a
   * single-replica gateway. A multi-replica deployment must inject a durable,
   * atomically-consuming store before it is enabled.
   */
  challengeStore?: ChallengeStore;
  /** Omitted by unit-only embeddings; that leaves the private probe closed. */
  readiness?: StagingParticipantReadinessAdapter;
  readinessPins?: StagingParticipantReadinessPins;
}>;

function json(value: unknown, status = 200, origin?: string): Response {
  const headers = new Headers({
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
  });
  if (origin) {
    headers.set("access-control-allow-origin", origin);
    headers.set("access-control-allow-credentials", "true");
    headers.set("vary", "Origin");
  }
  return new Response(JSON.stringify(value), { status, headers });
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function parsedObject(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype) return null;
  const record = value as Record<string, unknown>;
  return exactKeys(record, keys) ? record : null;
}

function boundedText(value: unknown, maxCharacters: number): string | null {
  if (typeof value !== "string" || value !== value.trim() || !value) return null;
  if (Array.from(value).length > maxCharacters || Buffer.byteLength(value, "utf8") > MAX_CONTENT_BYTES) {
    return null;
  }
  if (/\p{Cc}/u.test(value) || /(?:https?:\/\/|www\.)/iu.test(value)) {
    return null;
  }
  return value;
}

function validPostId(value: unknown): string | null {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)
    ? value.toLowerCase()
    : null;
}

function validRequestId(value: unknown): string | null {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)
    ? value.toLowerCase()
    : null;
}

function validNostrEvent(value: unknown): NostrEvent | null {
  const record = parsedObject(value, ["id", "pubkey", "created_at", "kind", "tags", "content", "sig"]);
  if (!record || typeof record.id !== "string" || !/^[a-f0-9]{64}$/iu.test(record.id) ||
    typeof record.pubkey !== "string" || !/^[a-f0-9]{64}$/iu.test(record.pubkey) ||
    typeof record.created_at !== "number" || !Number.isSafeInteger(record.created_at) || record.created_at < 0 ||
    typeof record.kind !== "number" || !Number.isSafeInteger(record.kind) || record.kind < 0 ||
    typeof record.content !== "string" || typeof record.sig !== "string" ||
    !/^[a-f0-9]{128}$/iu.test(record.sig) || !Array.isArray(record.tags) ||
    record.tags.some((tag) => !Array.isArray(tag) || tag.some((item) => typeof item !== "string"))) return null;
  const event = {
    id: record.id.toLowerCase(), pubkey: record.pubkey.toLowerCase(), created_at: record.created_at,
    kind: record.kind, tags: record.tags.map((tag) => [...tag]), content: record.content, sig: record.sig.toLowerCase(),
  } as NostrEvent;
  return verifyEvent(event) ? event : null;
}

function exactMeckyConversationEvent(event: NostrEvent, meckyPubkey: string, sourcePostId: string, conversationTopic: string): boolean {
  return isAppConversationMentionEvent(event, {
    agentPubkey: meckyPubkey,
    sourceAppPostId: sourcePostId,
    conversationTopic,
  });
}

function containsExplicitMeckyMention(content: string): boolean {
  // Keep the same boundary semantics as the Röbel composer. The tags remain
  // the authority at this HTTP boundary; this check merely rejects a signed
  // event that does not faithfully mirror an explicit source mention.
  return /(^|[^\p{L}\p{N}_])@mecky(?![\p{L}\p{N}_])/iu.test(content);
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function eventSha256(event: NostrEvent): string {
  // Fixed field order avoids any dependence on caller object insertion order.
  return sha256Hex(JSON.stringify([
    event.id, event.pubkey, event.created_at, event.kind, event.tags,
    event.content, event.sig,
  ]));
}

function exactTagValue(event: NostrEvent, name: string): string | null {
  const matches = event.tags.filter((tag) => tag.length === 2 && tag[0] === name);
  return matches.length === 1 && typeof matches[0]?.[1] === "string" ? matches[0][1] : null;
}

function validIdempotencyKey(value: unknown): string | null {
  return typeof value === "string" && value === value.trim() &&
    /^[A-Za-z0-9._~-]{16,128}$/u.test(value) ? value : null;
}

function topicPolicyValid(config: StagingParticipantGatewayConfig): boolean {
  const policy = config.topicPolicy;
  return /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/u.test(policy.municipalityId) &&
    policy.topicNamespace === `urn:stadtstack:topic:municipality:${policy.municipalityId}` &&
    /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/u.test(policy.sourceConversationTopic) &&
    /^[a-z0-9][a-z0-9._-]{2,99}$/u.test(policy.policyVersion);
}

function policyTopic(config: StagingParticipantGatewayConfig, topicId: string): boolean {
  return topicId.startsWith(`${config.topicPolicy.topicNamespace}:`) &&
    topicId.length > config.topicPolicy.topicNamespace.length + 1;
}

function sameEvent(left: NostrEvent, right: NostrEvent): boolean {
  return eventSha256(left) === eventSha256(right);
}

function resolvedConversationMatches(input: Readonly<{
  sourcePostId: string;
  sourcePost: NostrEvent;
  mentionEvent: NostrEvent;
  meckyReplyEvent: NostrEvent;
  meckyReceiptId?: string;
  rootConversation: Readonly<{
    sourceAppPostId: string;
    sourceAppCommentId?: string;
    mentionEventId: string;
    replyEventId: string;
    receiptId?: string;
  }>;
  topicId: string;
  config: StagingParticipantGatewayConfig;
}>): boolean {
  const { sourcePost, mentionEvent, meckyReplyEvent, rootConversation, config } = input;
  const forbiddenAuthorityTag = (event: NostrEvent) => event.tags.some((tag) =>
    ["case", "stadtstack-case", "vote", "treasury", "municipal-publication"].includes(tag[0] ?? ""),
  );
  const exchange = verifyAppConversationExchange(mentionEvent, meckyReplyEvent, {
    agentPubkey: config.meckyPubkey,
    sourceAppPostId: input.sourcePostId,
    sourceAppCommentId: rootConversation.sourceAppCommentId,
    conversationTopic: config.topicPolicy.sourceConversationTopic,
    municipalityId: config.topicPolicy.municipalityId,
    topicId: input.topicId,
  });
  return sameEvent(sourcePost, mentionEvent) && !forbiddenAuthorityTag(sourcePost) &&
    !forbiddenAuthorityTag(meckyReplyEvent) && exchange !== null &&
    rootConversation.sourceAppPostId === input.sourcePostId &&
    rootConversation.mentionEventId === mentionEvent.id &&
    rootConversation.replyEventId === meckyReplyEvent.id &&
    rootConversation.receiptId === input.meckyReceiptId &&
    (input.meckyReceiptId === undefined
      ? exchange.receiptId === undefined
      : exchange.receiptId === input.meckyReceiptId);
}

function admissionProof(value: unknown, walletAddress: string): Readonly<{
  credential: { kind: "thirdweb_smart_account" | "passkey_safe"; address: string; chainId: 100 };
  statement: string;
  walletSignature: string;
  bindingEvent: NostrEvent;
  nostrPubkey: string;
  workbenchProof: unknown;
}> | null {
  const record = parsedObject(value, ["schemaVersion", "credential", "statement", "walletSignature", "bindingEvent"]);
  const credential = record && parsedObject(record.credential, ["kind", "address", "chainId"]);
  if (!record || record.schemaVersion !== "roebel_citizen_admission_proof_v1" || !credential ||
    (credential.kind !== "thirdweb_smart_account" && credential.kind !== "passkey_safe") ||
    normalizeWallet(credential.address) !== walletAddress || credential.chainId !== 100 ||
    typeof record.statement !== "string" || typeof record.walletSignature !== "string" ||
    !/^0x[0-9a-f]+$/iu.test(record.walletSignature) || (record.walletSignature.length - 2) % 2 !== 0) return null;
  const bindingEvent = validNostrEvent(record.bindingEvent);
  if (!bindingEvent) return null;
  const binding = verifyBindingEvent(bindingEvent, walletAddress);
  if (!binding.valid || bindingEvent.content !== record.statement ||
    record.statement !== bindingStatement({ account: walletAddress, npub: binding.npub })) return null;
  return {
    credential: { kind: credential.kind, address: walletAddress, chainId: 100 },
    statement: record.statement,
    walletSignature: record.walletSignature,
    bindingEvent,
    nostrPubkey: binding.pubkey,
    workbenchProof: {
      schemaVersion: "roebel_citizen_admission_proof_v1",
      credential: { kind: credential.kind, address: walletAddress, chainId: 100 },
      statement: record.statement,
      walletSignature: record.walletSignature,
      bindingEvent,
    },
  };
}

function nodeResponseHeaders(headers: Headers): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {};
  headers.forEach((value, name) => { result[name] = value; });
  return result;
}

function isAllowedOrigin(request: Request, config: StagingParticipantGatewayConfig): boolean {
  return request.headers.get("origin") === config.origin;
}

function maxRequestBytesForPath(pathname: string): number {
  if (pathname === PROMOTE_SOURCE_POST_PATH) return SOURCE_POST_PROMOTION_MAX_REQUEST_BYTES;
  if (pathname === SIGN_TOPIC_SUGGESTION_PATH) return TOPIC_SUGGESTION_MAX_REQUEST_BYTES;
  return DEFAULT_MAX_REQUEST_BYTES;
}

async function readJson(request: Request, maxRequestBytes: number): Promise<unknown> {
  const declaredLengthHeader = request.headers.get("content-length");
  const declaredLength = Number(declaredLengthHeader ?? 0);
  if (declaredLengthHeader !== null &&
    (!Number.isSafeInteger(declaredLength) || declaredLength < 0 || declaredLength > maxRequestBytes)) {
    throw new Error(declaredLength > maxRequestBytes ? "too_large" : "invalid");
  }
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim() !== "application/json") {
    throw new Error("content_type");
  }
  const raw = await request.text();
  if (Buffer.byteLength(raw, "utf8") > maxRequestBytes) throw new Error("too_large");
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new Error("invalid");
  }
}

function clearChallenge(response: Response, secure: boolean): Response {
  response.headers.append("set-cookie", clearCookie(CHALLENGE_COOKIE, secure));
  return response;
}

function internalStatus(value: unknown, status: number): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
    },
  });
}

/**
 * Exact, staging-only write surface. This handler has no generic proxy, no
 * caller-selected table/RPC, and no civic-authority verbs. It is designed to
 * sit behind one narrow ingress path rather than widening the read-only web
 * presentation ingress.
 */
export function createStagingParticipantGatewayHandler(
  dependencies: StagingParticipantGatewayDependencies,
): (request: Request) => Promise<Response> {
  const { config } = dependencies;
  if (config.sessionHmacKey.length < 32 ||
    !/^[a-f0-9]{64}$/iu.test(config.inviteSha256) ||
    config.allowedWallets.length < 1 || config.allowedWallets.length > 8 ||
    config.allowedWallets.some((wallet) => !/^0x[0-9a-f]{40}$/u.test(wallet)) ||
    !/^[0-9a-f]{64}$/u.test(config.meckyPubkey) || !topicPolicyValid(config)) {
    throw new Error("staging_participant_gateway_config_invalid");
  }
  let origin: string;
  try {
    origin = new URL(config.origin).origin;
  } catch {
    throw new Error("staging_participant_gateway_origin_invalid");
  }
  if (origin !== config.origin) throw new Error("staging_participant_gateway_origin_invalid");
  const now = dependencies.now ?? (() => new Date());
  const store = dependencies.challengeStore ?? new Map();

  return async (request) => {
    const url = new URL(request.url);
    if (url.pathname === INTERNAL_STATUS_PATH) {
      // No CORS, browser origin or cookies are accepted on this non-ingressed
      // probe. A network policy/service boundary is still required in deploy.
      if (url.search || request.method !== "GET" || request.headers.has("origin") || request.headers.has("cookie")) {
        return internalStatus({ schemaVersion: INTERNAL_STATUS_SCHEMA, status: "not_ready" }, 503);
      }
      const pins = dependencies.readinessPins;
      if (!dependencies.readiness || !pins) {
        return internalStatus({ schemaVersion: INTERNAL_STATUS_SCHEMA, status: "not_ready" }, 503);
      }
      try {
        const [preflight, topicPreflight] = await Promise.all([
          dependencies.readiness.preflight(), dependencies.readiness.preflightTopicTracer(),
        ]);
        if (preflight.migrationId !== "20260825_staging_participant_gateway" ||
          preflight.databaseSchemaSha256 !== pins.databaseSchemaSha256 ||
          topicPreflight.migrationId !== "20260825_staging_participant_topic_tracer" ||
          topicPreflight.databaseSchemaSha256 !== pins.topicTracerDatabaseSchemaSha256) {
          return internalStatus({ schemaVersion: INTERNAL_STATUS_SCHEMA, status: "not_ready" }, 503);
        }
        return internalStatus({
          schemaVersion: INTERNAL_STATUS_SCHEMA,
          status: "ready",
          sourceRevision: pins.sourceRevision,
          manifestDigest: pins.manifestDigest,
          migrationSha256: pins.migrationSha256,
          databaseSchemaSha256: pins.databaseSchemaSha256,
          topicTracerMigrationSha256: pins.topicTracerMigrationSha256,
          topicTracerDatabaseSchemaSha256: pins.topicTracerDatabaseSchemaSha256,
        }, 200);
      } catch {
        return internalStatus({ schemaVersion: INTERNAL_STATUS_SCHEMA, status: "not_ready" }, 503);
      }
    }
    if (url.search) return json({ error: "not_found" }, 404);
    const requestOrigin = request.headers.get("origin");
    if (requestOrigin !== null && !isAllowedOrigin(request, config)) {
      return json({ error: "origin_forbidden" }, 403);
    }

    if (AUTHORITY_PATHS.has(url.pathname)) {
      return json({ error: "authority_action_forbidden" }, 403, origin);
    }
    if (request.method === "OPTIONS" &&
      [
        STATUS_PATH, CHALLENGE_PATH, SESSION_PATH, POSTS_PATH, COMMENTS_PATH,
        NOSTR_POST_PATH, PROMOTE_SOURCE_POST_PATH, SIGN_TOPIC_SUGGESTION_PATH,
      ].includes(url.pathname)) {
      const response = new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": origin,
          "access-control-allow-credentials": "true",
          "cache-control": "no-store",
          "vary": "Origin",
          "x-content-type-options": "nosniff",
        },
      });
      response.headers.set("access-control-allow-methods", url.pathname === STATUS_PATH ? "GET" : "POST");
      response.headers.set("access-control-allow-headers", "content-type");
      response.headers.set("access-control-max-age", "600");
      return response;
    }
    if (url.pathname === STATUS_PATH) {
      if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405, origin);
      const time = now();
      const session = Number.isFinite(time.getTime())
        ? decodeSignedSession(readCookie(request.headers.get("cookie"), SESSION_COOKIE), config.sessionHmacKey, Math.floor(time.getTime() / 1_000))
        : null;
      return json({
        available: true,
        active: Boolean(session),
        walletAddress: session?.walletAddress ?? null,
        label: PARTICIPANT_LABEL,
        scope: session ? "main_text_post_comment" : null,
        authority: "none",
      }, 200, origin);
    }
    if (url.pathname !== CHALLENGE_PATH && url.pathname !== SESSION_PATH &&
      url.pathname !== POSTS_PATH && url.pathname !== COMMENTS_PATH && url.pathname !== NOSTR_POST_PATH &&
      url.pathname !== PROMOTE_SOURCE_POST_PATH && url.pathname !== SIGN_TOPIC_SUGGESTION_PATH) {
      return json({ error: "not_found" }, 404, origin);
    }
    // Same-origin browser GET requests commonly omit Origin. Every mutating
    // request must still carry the exact configured origin as a CSRF boundary.
    if (!isAllowedOrigin(request, config)) {
      return json({ error: "origin_forbidden" }, 403, origin);
    }
    if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405, origin);

    let body: unknown;
    try {
      body = await readJson(request, maxRequestBytesForPath(url.pathname));
    } catch (error) {
      const code = error instanceof Error ? error.message : "invalid";
      return json({ error: code === "too_large" ? "request_too_large" : code === "content_type" ? "content_type_invalid" : "request_invalid" }, code === "too_large" ? 413 : code === "content_type" ? 415 : 400, origin);
    }
    const time = now();
    if (!Number.isFinite(time.getTime())) return json({ error: "service_unavailable" }, 503, origin);
    const nowMs = time.getTime();

    if (url.pathname === CHALLENGE_PATH) {
      const record = parsedObject(body, ["schemaVersion", "walletAddress", "inviteToken"]);
      const walletAddress = record && record.schemaVersion === CHALLENGE_SCHEMA ? normalizeWallet(record.walletAddress) : null;
      if (!record || !walletAddress ||
        !config.allowedWallets.includes(walletAddress) ||
        !validInvite(record.inviteToken, config.inviteSha256)) {
        return json({ error: "admission_invalid" }, 401, origin);
      }
      let issued: ReturnType<typeof issueChallenge>;
      try {
        prepareChallengeStore(store, Math.floor(nowMs / 1_000), walletAddress);
        issued = issueChallenge({ walletAddress, nowMs, randomId: dependencies.randomId, key: config.sessionHmacKey, store });
      } catch {
        return json({ error: "service_unavailable" }, 503, origin);
      }
      const response = json({
        message: challengeMessage(issued.claim),
        expiresAt: issued.claim.expiresAt,
        label: PARTICIPANT_LABEL,
        authority: "none",
      }, 200, origin);
      response.headers.append("set-cookie", cookie(CHALLENGE_COOKIE, issued.token, issued.claim.expiresAt - issued.claim.issuedAt, config.cookieSecure));
      return response;
    }

    if (url.pathname === SESSION_PATH) {
      const record = parsedObject(body, ["schemaVersion", "signature"]);
      const signature = record && record.schemaVersion === SESSION_SCHEMA && typeof record.signature === "string" &&
        /^0x[0-9a-f]+$/iu.test(record.signature) && Buffer.byteLength(record.signature, "utf8") <= DEFAULT_MAX_REQUEST_BYTES
        ? record.signature
        : null;
      const claim = decodeSignedChallenge(
        readCookie(request.headers.get("cookie"), CHALLENGE_COOKIE),
        config.sessionHmacKey,
        Math.floor(nowMs / 1_000),
      );
      if (!signature || !claim || !consumeChallenge({ claim, store, nowSeconds: Math.floor(nowMs / 1_000) })) {
        return clearChallenge(json({ error: "challenge_invalid" }, 401, origin), config.cookieSecure);
      }
      let valid = false;
      try {
        valid = await dependencies.verifier.verifyWalletSignature({
          address: claim.walletAddress,
          message: challengeMessage(claim),
          signature,
        });
      } catch {
        return clearChallenge(json({ error: "verification_unavailable" }, 503, origin), config.cookieSecure);
      }
      if (!valid) return clearChallenge(json({ error: "signature_invalid" }, 401, origin), config.cookieSecure);
      const issued = issueSession(claim.walletAddress, nowMs, config.sessionHmacKey);
      const response = clearChallenge(json({
        active: true,
        walletAddress: issued.claim.walletAddress,
        expiresAt: new Date(issued.claim.expiresAt * 1_000).toISOString(),
        label: PARTICIPANT_LABEL,
        scope: issued.claim.scope,
        authority: "none",
      }, 200, origin), config.cookieSecure);
      response.headers.append("set-cookie", cookie(SESSION_COOKIE, issued.token, issued.claim.expiresAt - issued.claim.issuedAt, config.cookieSecure));
      return response;
    }

    const session = decodeSignedSession(
      readCookie(request.headers.get("cookie"), SESSION_COOKIE),
      config.sessionHmacKey,
      Math.floor(nowMs / 1_000),
    );
    if (!session) return json({ error: "session_required" }, 401, origin);

    if (url.pathname === NOSTR_POST_PATH) {
      const record = parsedObject(body, ["schemaVersion", "requestId", "sourcePostId", "admissionProof", "event"]);
      const requestId = record && record.schemaVersion === NOSTR_POST_SCHEMA
        ? validRequestId(record.requestId) : null;
      const sourcePostId = record && record.schemaVersion === NOSTR_POST_SCHEMA
        ? validPostId(record.sourcePostId) : null;
      const proof = record && record.schemaVersion === NOSTR_POST_SCHEMA
        ? admissionProof(record.admissionProof, session.walletAddress) : null;
      const event = record && record.schemaVersion === NOSTR_POST_SCHEMA
        ? validNostrEvent(record.event) : null;
      if (!requestId || !sourcePostId || !proof || !event || event.kind !== 1 ||
        event.pubkey !== proof.nostrPubkey ||
        !exactMeckyConversationEvent(event, config.meckyPubkey, sourcePostId, config.topicPolicy.sourceConversationTopic)) {
        return json({ error: "nostr_post_invalid" }, 400, origin);
      }
      let source;
      try {
        source = await dependencies.data.readOwnedMainTextPost({ walletAddress: session.walletAddress, postId: sourcePostId });
      } catch {
        return json({ error: "source_unavailable" }, 503, origin);
      }
      if (!source || source.content !== event.content || !containsExplicitMeckyMention(source.content) ||
        source.wallet_address.toLowerCase() !== session.walletAddress) {
        return json({ error: "source_mismatch" }, 409, origin);
      }
      let walletSignatureValid = false;
      try {
        walletSignatureValid = await dependencies.verifier.verifyWalletSignature({
          address: session.walletAddress, message: proof.statement, signature: proof.walletSignature,
        });
      } catch {
        return json({ error: "verification_unavailable" }, 503, origin);
      }
      if (!walletSignatureValid) return json({ error: "wallet_signature_invalid" }, 401, origin);
      const receiptInput = {
        walletAddress: session.walletAddress,
        sourcePostId,
        requestId,
        eventId: event.id,
        eventCreatedAt: event.created_at,
        contentSha256: sha256Hex(source.content),
      };
      let receipt: StagingParticipantMirrorReceipt;
      try {
        receipt = await dependencies.data.reserveNostrPostMirror(receiptInput);
      } catch (error) {
        if (error instanceof Error && error.message === "staging_participant_mirror_stale") {
          return json({ error: "nostr_post_stale" }, 400, origin);
        }
        if (error instanceof Error && error.message === "staging_participant_mirror_conflict") {
          return json({ error: "source_already_mirrored" }, 409, origin);
        }
        return json({ error: "mirror_receipt_unavailable" }, 503, origin);
      }
      if (receipt.state === "published") {
        try {
          await dependencies.data.bindPublishedNostrPostMirror({
            walletAddress: session.walletAddress, sourcePostId, eventId: receipt.event_id, nostrPubkey: proof.nostrPubkey,
          });
        } catch { return json({ error: "mirror_binding_unavailable" }, 503, origin); }
        return json({ status: "published", eventId: receipt.event_id, authority: "none" }, 200, origin);
      }
      try {
        const published = await dependencies.mirror.mirrorPost({ admissionProof: proof.workbenchProof, event });
        if (published.status !== "published" || published.eventId !== receipt.event_id) {
          return json({ error: "mirror_unavailable" }, 503, origin);
        }
        const completed = await dependencies.data.completeNostrPostMirror(receiptInput);
        await dependencies.data.bindPublishedNostrPostMirror({
          walletAddress: session.walletAddress, sourcePostId, eventId: completed.event_id, nostrPubkey: proof.nostrPubkey,
        });
        return json({ status: "published", eventId: completed.event_id, authority: "none" }, 201, origin);
      } catch (error) {
        if (error instanceof Error && error.message === "staging_participant_mirror_conflict") {
          return json({ error: "source_already_mirrored" }, 409, origin);
        }
        // The durable reservation deliberately remains. A retry can only ever
        // publish this exact event id; it cannot substitute a new signed note.
        return json({ error: "mirror_unavailable" }, 503, origin);
      }
    }

    if (url.pathname === PROMOTE_SOURCE_POST_PATH) {
      const record = parsedObject(body, ["schemaVersion", "requestId", "idempotencyKey", "sourcePostId", "rootEvent"]);
      const requestId = record?.schemaVersion === SOURCE_POST_PROMOTION_SCHEMA
        ? validRequestId(record.requestId) : null;
      const idempotencyKey = record?.schemaVersion === SOURCE_POST_PROMOTION_SCHEMA
        ? validIdempotencyKey(record.idempotencyKey) : null;
      const sourcePostId = record?.schemaVersion === SOURCE_POST_PROMOTION_SCHEMA
        ? validPostId(record.sourcePostId) : null;
      const rootEvent = record?.schemaVersion === SOURCE_POST_PROMOTION_SCHEMA
        ? validNostrEvent(record.rootEvent) : null;
      if (!requestId || !idempotencyKey || !sourcePostId || !rootEvent) {
        return json({ error: "source_post_promotion_invalid" }, 400, origin);
      }
      const tracer = dependencies.topicTracer;
      if (!tracer) return json({ error: "topic_tracer_unavailable" }, 503, origin);
      let mirrorBinding;
      try {
        mirrorBinding = await dependencies.data.resolvePublishedNostrPostMirror({ walletAddress: session.walletAddress, sourcePostId });
      } catch {
        return json({ error: "source_unavailable" }, 503, origin);
      }
      if (!mirrorBinding) return json({ error: "source_mismatch" }, 409, origin);
      let resolved;
      try {
        resolved = await tracer.resolvePromotionSource({
          sourceNoteEventId: mirrorBinding.event_id, sourceAuthorPubkey: mirrorBinding.nostr_pubkey, sourceAppPostId: mirrorBinding.source_post_id,
        });
      } catch { return json({ error: "source_unavailable" }, 503, origin); }
      if (!resolved) return json({ error: "source_mismatch" }, 409, origin);
      const promotion = verifyCivicTopicPromotionEvent({
        event: rootEvent,
        sourcePost: resolved.sourceNote,
        municipalityId: config.topicPolicy.municipalityId,
        agentPubkey: config.meckyPubkey,
      });
      if (!promotion || !promotion.conversationSource || !policyTopic(config, promotion.topicId) ||
        !resolvedConversationMatches({
          sourcePostId,
          sourcePost: resolved.sourceNote,
          mentionEvent: resolved.sourceNote,
          meckyReplyEvent: resolved.meckyReplyEvent,
          ...(resolved.meckyReceiptId === undefined ? {} : { meckyReceiptId: resolved.meckyReceiptId }),
          rootConversation: promotion.conversationSource,
          topicId: promotion.topicId,
          config,
        })) {
        return json({ error: "source_mismatch" }, 409, origin);
      }
      const receiptInput = {
        walletAddress: session.walletAddress,
        namespace: config.topicPolicy.topicNamespace,
        sourcePostId,
        requestId,
        idempotencyKeySha256: sha256Hex(idempotencyKey),
        discussionRootId: rootEvent.id,
        discussionRootSha256: eventSha256(rootEvent),
        topicId: promotion.topicId,
        policyVersion: config.topicPolicy.policyVersion,
      };
      let receipt;
      try {
        receipt = await dependencies.data.reserveSourcePostPromotion(receiptInput);
      } catch (error) {
        if (error instanceof Error && error.message === "staging_participant_promotion_conflict") {
          return json({ error: "idempotency_conflict" }, 409, origin);
        }
        return json({ error: "promotion_receipt_unavailable" }, 503, origin);
      }
      const envelope = {
        schemaVersion: "staging_source_post_promotion_receipt_v1",
        status: receipt.state === "published" ? "already_promoted" : "promoted",
        sourcePostId: receipt.source_post_id,
        discussionRootId: receipt.discussion_root_id,
        topicId: receipt.topic_id,
        sourceConversation: {
          sourceAppPostId: promotion.conversationSource.sourceAppPostId,
          ...(promotion.conversationSource.sourceAppCommentId === undefined ? {} : {
            sourceAppCommentId: promotion.conversationSource.sourceAppCommentId,
          }),
          mentionEventId: promotion.conversationSource.mentionEventId,
          meckyReplyEventId: promotion.conversationSource.replyEventId,
          ...(promotion.conversationSource.receiptId === undefined ? {} : {
            meckyReceiptId: promotion.conversationSource.receiptId,
          }),
        },
        authorityBinding: "none",
        policyVersion: receipt.policy_version,
        receiptChecksum: receipt.receipt_checksum,
      } as const;
      if (receipt.state === "published") return json(envelope, 200, origin);
      try {
        const published = await tracer.publishPromotion({ event: rootEvent });
        if (published.status !== "published" || published.eventId !== receipt.discussion_root_id) {
          return json({ error: "promotion_unavailable" }, 503, origin);
        }
        const completed = await dependencies.data.completeSourcePostPromotion(receiptInput);
        return json({ ...envelope, status: "promoted", receiptChecksum: completed.receipt_checksum }, 201, origin);
      } catch (error) {
        if (error instanceof Error && error.message === "staging_participant_promotion_conflict") {
          return json({ error: "idempotency_conflict" }, 409, origin);
        }
        return json({ error: "promotion_unavailable" }, 503, origin);
      }
    }

    if (url.pathname === SIGN_TOPIC_SUGGESTION_PATH) {
      const record = parsedObject(body, [
        "schemaVersion", "requestId", "idempotencyKey", "discussionRootEvent", "meckyAnswerEvent", "suggestionEvent",
      ]);
      const requestId = record?.schemaVersion === TOPIC_SUGGESTION_SCHEMA
        ? validRequestId(record.requestId) : null;
      const idempotencyKey = record?.schemaVersion === TOPIC_SUGGESTION_SCHEMA
        ? validIdempotencyKey(record.idempotencyKey) : null;
      const discussionRootEvent = record?.schemaVersion === TOPIC_SUGGESTION_SCHEMA
        ? validNostrEvent(record.discussionRootEvent) : null;
      const meckyAnswerEvent = record?.schemaVersion === TOPIC_SUGGESTION_SCHEMA
        ? validNostrEvent(record.meckyAnswerEvent) : null;
      const suggestionEvent = record?.schemaVersion === TOPIC_SUGGESTION_SCHEMA
        ? validNostrEvent(record.suggestionEvent) : null;
      if (!requestId || !idempotencyKey || !discussionRootEvent || !meckyAnswerEvent || !suggestionEvent) {
        return json({ error: "topic_suggestion_invalid" }, 400, origin);
      }
      const tracer = dependencies.topicTracer;
      if (!tracer) return json({ error: "topic_tracer_unavailable" }, 503, origin);
      let claimedPromotion;
      try {
        claimedPromotion = await dependencies.data.resolvePublishedSourcePostPromotion({
          walletAddress: session.walletAddress,
          namespace: config.topicPolicy.topicNamespace,
          discussionRootId: discussionRootEvent.id,
          sourceAuthorPubkey: suggestionEvent.pubkey,
        });
      } catch { return json({ error: "source_unavailable" }, 503, origin); }
      if (!claimedPromotion) return json({ error: "source_mismatch" }, 409, origin);
      let mirrorBinding;
      try {
        mirrorBinding = await dependencies.data.resolvePublishedNostrPostMirror({
          walletAddress: session.walletAddress, sourcePostId: claimedPromotion.source_post_id,
        });
      } catch { return json({ error: "source_unavailable" }, 503, origin); }
      if (!mirrorBinding || mirrorBinding.nostr_pubkey !== suggestionEvent.pubkey) return json({ error: "source_mismatch" }, 409, origin);
      let resolved;
      try {
        resolved = await tracer.resolveTopicSuggestionSources({
          discussionRootId: discussionRootEvent.id,
          sourceAuthorPubkey: suggestionEvent.pubkey,
          sourceNoteEventId: mirrorBinding.event_id,
          sourceAppPostId: mirrorBinding.source_post_id,
        });
      } catch {
        return json({ error: "source_unavailable" }, 503, origin);
      }
      if (!resolved || !sameEvent(discussionRootEvent, resolved.discussionRoot) ||
        !sameEvent(meckyAnswerEvent, resolved.meckyAnswer)) {
        return json({ error: "source_mismatch" }, 409, origin);
      }
      const promotion = verifyCivicTopicPromotionEvent({
        event: resolved.discussionRoot,
        sourcePost: resolved.sourceNote,
        municipalityId: config.topicPolicy.municipalityId,
        agentPubkey: config.meckyPubkey,
      });
      if (!promotion || !promotion.conversationSource || !policyTopic(config, promotion.topicId) ||
        !resolvedConversationMatches({
          sourcePostId: promotion.conversationSource.sourceAppPostId,
          sourcePost: resolved.sourceNote,
          mentionEvent: resolved.sourceNote,
          meckyReplyEvent: resolved.meckyReplyEvent,
          ...(resolved.meckyReceiptId === undefined ? {} : { meckyReceiptId: resolved.meckyReceiptId }),
          rootConversation: promotion.conversationSource,
          topicId: promotion.topicId,
          config,
        })) {
        return json({ error: "source_mismatch" }, 409, origin);
      }
      let suggestion;
      try {
        suggestion = verifyParticipantTopicSuggestion({
          binding: { municipalityId: config.topicPolicy.municipalityId, topicId: promotion.topicId },
          sourcePost: resolved.sourceNote,
          sourceDiscussion: resolved.discussionRoot,
          sourceAnswer: resolved.meckyAnswer,
          conversationWitnesses: {
            conversationTopic: config.topicPolicy.sourceConversationTopic,
            mentionEvent: resolved.sourceNote,
            replyEvent: resolved.meckyReplyEvent,
          },
          agentPubkey: config.meckyPubkey,
          event: suggestionEvent,
        });
      } catch {
        return json({ error: "topic_suggestion_invalid" }, 400, origin);
      }
      const receiptInput = {
        walletAddress: session.walletAddress,
        namespace: config.topicPolicy.topicNamespace,
        discussionRootId: resolved.discussionRoot.id,
        sourceAuthorPubkey: suggestion.signerPubkey,
        requestId,
        idempotencyKeySha256: sha256Hex(idempotencyKey),
        suggestionId: suggestion.suggestionId,
        suggestionSha256: eventSha256(suggestion.event),
        meckyAnswerId: resolved.meckyAnswer.id,
        meckyReceiptId: suggestion.draft.sourceAnswerReceiptId,
        topicId: suggestion.draft.topicId,
        policyVersion: config.topicPolicy.policyVersion,
      };
      let receipt;
      try {
        receipt = await dependencies.data.reserveTopicSuggestion(receiptInput);
      } catch (error) {
        if (error instanceof Error && error.message === "staging_participant_suggestion_conflict") {
          return json({ error: "suggestion_already_signed" }, 409, origin);
        }
        return json({ error: "suggestion_receipt_unavailable" }, 503, origin);
      }
      const envelope = {
        schemaVersion: "staging_topic_suggestion_receipt_v1",
        status: receipt.state === "published" ? "already_signed" : "signed",
        suggestionId: receipt.suggestion_id,
        discussionRootId: receipt.discussion_root_id,
        meckyAnswerId: receipt.mecky_answer_id,
        meckyReceiptId: receipt.mecky_receipt_id,
        topicId: receipt.topic_id,
        entryState: "citizen_adoption_required",
        authorityBinding: "none",
        submittedToCivicWorkflow: false,
        policyVersion: receipt.policy_version,
        receiptChecksum: receipt.receipt_checksum,
      } as const;
      if (receipt.state === "published") return json(envelope, 200, origin);
      try {
        const published = await tracer.publishTopicSuggestion({ event: suggestion.event });
        if (published.status !== "published" || published.eventId !== receipt.suggestion_id) {
          return json({ error: "suggestion_unavailable" }, 503, origin);
        }
        const completed = await dependencies.data.completeTopicSuggestion(receiptInput);
        return json({ ...envelope, status: "signed", receiptChecksum: completed.receipt_checksum }, 201, origin);
      } catch (error) {
        if (error instanceof Error && error.message === "staging_participant_suggestion_conflict") {
          return json({ error: "suggestion_already_signed" }, 409, origin);
        }
        return json({ error: "suggestion_unavailable" }, 503, origin);
      }
    }

    if (url.pathname === POSTS_PATH) {
      const record = parsedObject(body, ["schemaVersion", "requestId", "content"]);
      const content = record && record.schemaVersion === POST_SCHEMA
        ? boundedText(record.content, MAX_POST_CHARACTERS)
        : null;
      const requestId = record && record.schemaVersion === POST_SCHEMA ? validRequestId(record.requestId) : null;
      if (!content || !requestId) return json({ error: "request_invalid" }, 400, origin);
      try {
        const result = await dependencies.data.createMainTextPost({ walletAddress: session.walletAddress, content, requestId });
        return json({ data: result }, 201, origin);
      } catch {
        return json({ error: "write_unavailable" }, 503, origin);
      }
    }

    const record = parsedObject(body, ["schemaVersion", "requestId", "postId", "content"]);
    const postId = record && record.schemaVersion === COMMENT_SCHEMA ? validPostId(record.postId) : null;
    const content = record && record.schemaVersion === COMMENT_SCHEMA
      ? boundedText(record.content, MAX_COMMENT_CHARACTERS)
      : null;
    const requestId = record && record.schemaVersion === COMMENT_SCHEMA ? validRequestId(record.requestId) : null;
    if (!postId || !content || !requestId) return json({ error: "request_invalid" }, 400, origin);
    try {
      const result = await dependencies.data.createMainTextComment({ walletAddress: session.walletAddress, postId, content, requestId });
      return json({ data: result }, 201, origin);
    } catch {
      return json({ error: "write_unavailable" }, 503, origin);
    }
  };
}

async function readIncomingBody(request: IncomingMessage, maxRequestBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const value of request) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    bytes += chunk.byteLength;
    if (bytes > maxRequestBytes) throw new Error("request_too_large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/** Node adapter: tests call the Fetch handler; the executable uses this adapter. */
export function createStagingParticipantGatewayServer(
  dependencies: StagingParticipantGatewayDependencies,
): Server {
  const handle = createStagingParticipantGatewayHandler(dependencies);
  return createServer(async (incoming, outgoing) => {
    try {
      const incomingUrl = new URL(incoming.url ?? "/", "http://staging-participant.internal");
      const incomingPath = incomingUrl.pathname;
      const body = incoming.method === "GET" || incoming.method === "HEAD" || incoming.method === "OPTIONS"
        ? undefined
        : await readIncomingBody(incoming, maxRequestBytesForPath(incomingPath));
      const headers = new Headers();
      for (const [name, value] of Object.entries(incoming.headers)) {
        if (Array.isArray(value)) value.forEach((entry) => headers.append(name, entry));
        else if (value !== undefined) headers.set(name, value);
      }
      const response = await handle(new Request(incomingUrl, {
        method: incoming.method,
        headers,
        ...(body ? { body: new Uint8Array(body) } : {}),
      }));
      const setCookie = response.headers.getSetCookie();
      const outputHeaders = nodeResponseHeaders(response.headers);
      if (setCookie.length) outputHeaders["set-cookie"] = setCookie;
      outgoing.writeHead(response.status, outputHeaders);
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      const tooLarge = error instanceof Error && error.message === "request_too_large";
      const response = json({ error: tooLarge ? "request_too_large" : "service_unavailable" }, tooLarge ? 413 : 503);
      outgoing.writeHead(response.status, nodeResponseHeaders(response.headers));
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    }
  });
}

export async function listenStagingParticipantGatewayServer(input: Readonly<{
  server: Server;
  host: string;
  port: number;
}>): Promise<void> {
  if (!['127.0.0.1', '0.0.0.0'].includes(input.host) || !Number.isSafeInteger(input.port) || input.port < 1 || input.port > 65535) {
    throw new Error("staging_participant_gateway_listener_invalid");
  }
  await new Promise<void>((resolve, reject) => {
    input.server.once("error", reject);
    input.server.listen(input.port, input.host, () => {
      input.server.off("error", reject);
      resolve();
    });
  });
}
