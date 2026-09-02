import type {
  StagingParticipantComment,
  StagingParticipantDataAdapter,
  StagingParticipantMirrorReceipt,
  StagingParticipantPost,
  StagingParticipantPromotionReceipt,
  StagingParticipantReadinessAdapter,
  StagingParticipantSourceMirrorBinding,
  StagingParticipantSuggestionReceipt,
} from "./types.ts";
import {
  parseRestrictedPostgrestOrigin,
  type RestrictedPostgrestOrigin,
} from "./restricted-postgrest-origin.ts";

const POST_RPC = "staging_participant_gateway_create_main_text_post";
const COMMENT_RPC = "staging_participant_gateway_create_main_text_comment";
const OWNED_POST_RPC = "staging_participant_gateway_read_owned_main_text_post";
const RESERVE_MIRROR_RPC = "staging_participant_gateway_reserve_nostr_post_mirror";
const COMPLETE_MIRROR_RPC = "staging_participant_gateway_complete_nostr_post_mirror";
const BIND_MIRROR_RPC = "staging_participant_gateway_bind_published_nostr_post_mirror";
const RESOLVE_MIRROR_RPC = "staging_participant_gateway_resolve_published_nostr_post_mirror";
const RESERVE_PROMOTION_RPC = "staging_participant_gateway_reserve_source_post_promotion";
const COMPLETE_PROMOTION_RPC = "staging_participant_gateway_complete_source_post_promotion";
// PostgreSQL truncates identifiers to 63 bytes. The migration's longer source
// spelling is therefore exposed by pg_proc and PostgREST under this exact name.
const RESOLVE_PROMOTION_RPC = "staging_participant_gateway_resolve_published_source_post_promo";
const RESERVE_SUGGESTION_RPC = "staging_participant_gateway_reserve_topic_suggestion";
const COMPLETE_SUGGESTION_RPC = "staging_participant_gateway_complete_topic_suggestion";
const PREFLIGHT_RPC = "staging_participant_gateway_preflight";
const TOPIC_TRACER_PREFLIGHT_RPC = "staging_participant_gateway_topic_tracer_preflight";
const CITIZEN_ADOPTION_PREFLIGHT_RPC =
  "staging_participant_gateway_citizen_adoption_preflight";
const SYNTHETIC_CITIZEN_ADOPTION_PREFLIGHT_RPC =
  "staging_participant_gateway_synthetic_adoption_preflight";

export type RestrictedSupabaseRpcConfig = Readonly<{
  url: string;
  /** Browser-public anon/publishable key used only for PostgREST routing. */
  anonKey: string;
  /** Gateway-only capability matched against Supabase Vault by the two RPCs. */
  rpcSecret: string;
  fetch?: typeof fetch;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function decodeJwtPayload(value: string): Record<string, unknown> | null {
  const parts = value.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as unknown;
    return isRecord(payload) ? payload : null;
  } catch {
    return null;
  }
}

function unsafeAnonKey(value: string): boolean {
  if (value.startsWith("sb_secret_")) return true;
  const payload = decodeJwtPayload(value);
  return payload !== null && payload.role !== "anon";
}

function validateConfig(
  config: RestrictedSupabaseRpcConfig,
): RestrictedPostgrestOrigin {
  const endpoint = parseRestrictedPostgrestOrigin(config.url);
  if (!endpoint || config.anonKey.length < 16 ||
    unsafeAnonKey(config.anonKey) || config.rpcSecret.length < 32) {
    throw new Error("staging_participant_supabase_rpc_config_invalid");
  }
  return endpoint;
}

function rpcUrl(endpoint: RestrictedPostgrestOrigin, rpc: string): URL {
  const prefix = endpoint.directPostgrest ? "/rpc" : "/rest/v1/rpc";
  return new URL(`${prefix}/${rpc}`, endpoint.base);
}

/**
 * Calls only the two write RPCs and one exact owned-source read that the
 * staging migration exposes to anon. The anon key is already browser-public;
 * the additional header is a gateway-only capability checked against Vault.
 * No service-role or custom-role bearer exists in this process.
 */
export function createRestrictedSupabaseDataAdapter(
  config: RestrictedSupabaseRpcConfig,
): StagingParticipantDataAdapter {
  const endpoint = validateConfig(config);
  const request = config.fetch ?? globalThis.fetch;
  if (typeof request !== "function") throw new Error("staging_participant_fetch_unavailable");

  const invoke = async (rpc: string, body: Record<string, string>): Promise<unknown> => {
    const response = await request(rpcUrl(endpoint, rpc), {
      method: "POST",
      headers: {
        apikey: config.anonKey,
        authorization: `Bearer ${config.anonKey}`,
        "x-staging-participant-rpc-secret": config.rpcSecret,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) {
      const failure = await response.text();
      if (rpc === RESERVE_MIRROR_RPC && /STAGING_PARTICIPANT_MIRROR_EVENT_STALE/u.test(failure)) {
        throw new Error("staging_participant_mirror_stale");
      }
      if ((rpc === RESERVE_MIRROR_RPC || rpc === COMPLETE_MIRROR_RPC) &&
        /STAGING_PARTICIPANT_MIRROR_(?:SOURCE|REQUEST|RECEIPT)_/u.test(failure)) {
        throw new Error("staging_participant_mirror_conflict");
      }
      if ((rpc === RESERVE_PROMOTION_RPC || rpc === COMPLETE_PROMOTION_RPC) &&
        /STAGING_PARTICIPANT_PROMOTION_(?:SOURCE|REQUEST|CLAIM|RECEIPT)_/u.test(failure)) {
        throw new Error("staging_participant_promotion_conflict");
      }
      if ((rpc === RESERVE_SUGGESTION_RPC || rpc === COMPLETE_SUGGESTION_RPC) &&
        /STAGING_PARTICIPANT_SUGGESTION_(?:SOURCE|REQUEST|CLAIM|RECEIPT)_/u.test(failure)) {
        throw new Error("staging_participant_suggestion_conflict");
      }
      throw new Error("staging_participant_restricted_rpc_failed");
    }
    return await response.json() as unknown;
  };

  return {
    async createMainTextPost({ walletAddress, content, requestId }): Promise<StagingParticipantPost> {
      const value = await invoke(POST_RPC, {
        p_wallet_address: walletAddress,
        p_content: content,
        p_request_id: requestId,
      });
      if (!isStagingParticipantPost(value)) throw new Error("staging_participant_restricted_rpc_response_invalid");
      if (value.wallet_address.toLowerCase() !== walletAddress.toLowerCase() ||
        value.content !== content) {
        throw new Error("staging_participant_restricted_rpc_response_mismatch");
      }
      return value;
    },
    async createMainTextComment({ walletAddress, postId, content, requestId }): Promise<StagingParticipantComment> {
      const value = await invoke(COMMENT_RPC, {
        p_wallet_address: walletAddress,
        p_post_id: postId,
        p_content: content,
        p_request_id: requestId,
      });
      if (!isStagingParticipantComment(value)) throw new Error("staging_participant_restricted_rpc_response_invalid");
      if (value.wallet_address.toLowerCase() !== walletAddress.toLowerCase() ||
        value.post_id.toLowerCase() !== postId.toLowerCase() || value.content !== content) {
        throw new Error("staging_participant_restricted_rpc_response_mismatch");
      }
      return value;
    },
    async readOwnedMainTextPost({ walletAddress, postId }): Promise<StagingParticipantPost | null> {
      const value = await invoke(OWNED_POST_RPC, {
        p_wallet_address: walletAddress,
        p_post_id: postId,
      });
      if (value === null) return null;
      if (!isStagingParticipantPost(value)) {
        throw new Error("staging_participant_restricted_rpc_response_invalid");
      }
      if (
        value.wallet_address.toLowerCase() !== walletAddress.toLowerCase() ||
        value.id.toLowerCase() !== postId.toLowerCase()
      ) {
        throw new Error("staging_participant_restricted_rpc_response_mismatch");
      }
      return value;
    },
    async reserveNostrPostMirror(input): Promise<StagingParticipantMirrorReceipt> {
      return readMirrorReceipt(await invoke(RESERVE_MIRROR_RPC, reserveMirrorBody(input)), input);
    },
    async completeNostrPostMirror(input): Promise<StagingParticipantMirrorReceipt> {
      const receipt = readMirrorReceipt(await invoke(COMPLETE_MIRROR_RPC, mirrorBody(input)), input);
      if (receipt.state !== "published") {
        throw new Error("staging_participant_mirror_receipt_invalid");
      }
      return receipt;
    },
    async bindPublishedNostrPostMirror(input): Promise<StagingParticipantSourceMirrorBinding> {
      return readSourceMirrorBinding(await invoke(BIND_MIRROR_RPC, {
        p_wallet_address: input.walletAddress,
        p_source_post_id: input.sourcePostId,
        p_event_id: input.eventId,
        p_nostr_pubkey: input.nostrPubkey,
      }), input);
    },
    async resolvePublishedNostrPostMirror(input): Promise<StagingParticipantSourceMirrorBinding | null> {
      const value = await invoke(RESOLVE_MIRROR_RPC, {
        p_wallet_address: input.walletAddress,
        p_source_post_id: input.sourcePostId,
      });
      if (value === null) return null;
      return readSourceMirrorBinding(value, input);
    },
    async reserveSourcePostPromotion(input): Promise<StagingParticipantPromotionReceipt> {
      return readPromotionReceipt(await invoke(RESERVE_PROMOTION_RPC, promotionBody(input)), input);
    },
    async completeSourcePostPromotion(input): Promise<StagingParticipantPromotionReceipt> {
      const receipt = readPromotionReceipt(await invoke(COMPLETE_PROMOTION_RPC, promotionCompletionBody(input)), input);
      if (receipt.state !== "published") throw new Error("staging_participant_promotion_receipt_invalid");
      return receipt;
    },
    async resolvePublishedSourcePostPromotion(input): Promise<StagingParticipantPromotionReceipt | null> {
      const value = await invoke(RESOLVE_PROMOTION_RPC, {
        p_wallet_address: input.walletAddress,
        p_namespace: input.namespace,
        p_discussion_root_id: input.discussionRootId,
        p_source_author_pubkey: input.sourceAuthorPubkey,
      });
      if (value === null) return null;
      if (!isPromotionReceipt(value) || value.state !== "published" ||
        value.wallet_address.toLowerCase() !== input.walletAddress.toLowerCase() ||
        value.namespace !== input.namespace || value.discussion_root_id !== input.discussionRootId.toLowerCase()) {
        throw new Error("staging_participant_promotion_receipt_mismatch");
      }
      return value;
    },
    async reserveTopicSuggestion(input): Promise<StagingParticipantSuggestionReceipt> {
      return readSuggestionReceipt(await invoke(RESERVE_SUGGESTION_RPC, suggestionBody(input)), input);
    },
    async completeTopicSuggestion(input): Promise<StagingParticipantSuggestionReceipt> {
      const receipt = readSuggestionReceipt(await invoke(COMPLETE_SUGGESTION_RPC, suggestionCompletionBody(input)), input);
      if (receipt.state !== "published") throw new Error("staging_participant_suggestion_receipt_invalid");
      return receipt;
    },
  };
}

/**
 * Readiness has a separate adapter so it holds exactly one empty-POST
 * capability. It has no caller-selected RPC, table, URL, or service role.
 */
export function createStagingParticipantReadinessAdapter(
  config: RestrictedSupabaseRpcConfig,
): StagingParticipantReadinessAdapter {
  const endpoint = validateConfig(config);
  const request = config.fetch ?? globalThis.fetch;
  if (typeof request !== "function") throw new Error("staging_participant_fetch_unavailable");
  const preflight = async (rpc: string) => {
      const response = await request(rpcUrl(endpoint, rpc), {
        method: "POST",
        headers: {
          apikey: config.anonKey,
          authorization: `Bearer ${config.anonKey}`,
          "x-staging-participant-rpc-secret": config.rpcSecret,
          "content-type": "application/json",
          accept: "application/json",
        },
        body: "{}",
        signal: AbortSignal.timeout(4_000),
      });
      if (!response.ok) throw new Error("staging_participant_preflight_failed");
      const value = await response.json() as unknown;
      if (!isRecord(value) || !exactKeys(value, ["migration_id", "database_schema_sha256"]) ||
        typeof value.migration_id !== "string" ||
        typeof value.database_schema_sha256 !== "string" ||
        !/^sha256:[0-9a-f]{64}$/u.test(value.database_schema_sha256)) {
        throw new Error("staging_participant_preflight_response_invalid");
      }
      return { migrationId: value.migration_id, databaseSchemaSha256: value.database_schema_sha256 };
  };
  return {
    preflight: () => preflight(PREFLIGHT_RPC),
    preflightTopicTracer: () => preflight(TOPIC_TRACER_PREFLIGHT_RPC),
    preflightCitizenAdoption: () => preflight(CITIZEN_ADOPTION_PREFLIGHT_RPC),
    preflightSyntheticCitizenAdoption: () =>
      preflight(SYNTHETIC_CITIZEN_ADOPTION_PREFLIGHT_RPC),
  };
}

function mirrorBody(input: Readonly<{
  walletAddress: string; sourcePostId: string; requestId: string; eventId: string; contentSha256: string;
}>): Record<string, string> {
  return {
    p_wallet_address: input.walletAddress,
    p_source_post_id: input.sourcePostId,
    p_request_id: input.requestId,
    p_event_id: input.eventId,
    p_content_sha256: input.contentSha256,
  };
}

function reserveMirrorBody(input: Readonly<{
  walletAddress: string; sourcePostId: string; requestId: string; eventId: string; eventCreatedAt: number; contentSha256: string;
}>): Record<string, string> {
  return { ...mirrorBody(input), p_event_created_at: String(input.eventCreatedAt) };
}

type PromotionInput = Parameters<StagingParticipantDataAdapter["reserveSourcePostPromotion"]>[0];
type PromotionCompletionInput = Parameters<StagingParticipantDataAdapter["completeSourcePostPromotion"]>[0];
type SuggestionInput = Parameters<StagingParticipantDataAdapter["reserveTopicSuggestion"]>[0];
type SuggestionCompletionInput = Parameters<StagingParticipantDataAdapter["completeTopicSuggestion"]>[0];

function promotionBody(input: PromotionInput): Record<string, string> {
  return {
    p_wallet_address: input.walletAddress,
    p_namespace: input.namespace,
    p_source_post_id: input.sourcePostId,
    p_request_id: input.requestId,
    p_idempotency_key_sha256: input.idempotencyKeySha256,
    p_discussion_root_id: input.discussionRootId,
    p_discussion_root_sha256: input.discussionRootSha256,
    p_topic_id: input.topicId,
    p_policy_version: input.policyVersion,
  };
}

function promotionCompletionBody(input: PromotionCompletionInput): Record<string, string> {
  return {
    p_wallet_address: input.walletAddress,
    p_namespace: input.namespace,
    p_source_post_id: input.sourcePostId,
    p_request_id: input.requestId,
    p_idempotency_key_sha256: input.idempotencyKeySha256,
    p_discussion_root_id: input.discussionRootId,
    p_discussion_root_sha256: input.discussionRootSha256,
  };
}

function suggestionBody(input: SuggestionInput): Record<string, string> {
  return {
    p_wallet_address: input.walletAddress,
    p_namespace: input.namespace,
    p_discussion_root_id: input.discussionRootId,
    p_source_author_pubkey: input.sourceAuthorPubkey,
    p_request_id: input.requestId,
    p_idempotency_key_sha256: input.idempotencyKeySha256,
    p_suggestion_id: input.suggestionId,
    p_suggestion_sha256: input.suggestionSha256,
    p_mecky_answer_id: input.meckyAnswerId,
    p_mecky_receipt_id: input.meckyReceiptId,
    p_topic_id: input.topicId,
    p_policy_version: input.policyVersion,
  };
}

function suggestionCompletionBody(input: SuggestionCompletionInput): Record<string, string> {
  return {
    p_wallet_address: input.walletAddress,
    p_namespace: input.namespace,
    p_discussion_root_id: input.discussionRootId,
    p_source_author_pubkey: input.sourceAuthorPubkey,
    p_request_id: input.requestId,
    p_idempotency_key_sha256: input.idempotencyKeySha256,
    p_suggestion_id: input.suggestionId,
    p_suggestion_sha256: input.suggestionSha256,
  };
}

function readMirrorReceipt(
  value: unknown,
  expected: Readonly<{ walletAddress: string; sourcePostId: string; requestId: string; eventId: string; eventCreatedAt?: number; contentSha256: string }>,
): StagingParticipantMirrorReceipt {
  if (!isStagingParticipantMirrorReceipt(value) ||
    value.wallet_address.toLowerCase() !== expected.walletAddress.toLowerCase() ||
    value.source_post_id.toLowerCase() !== expected.sourcePostId.toLowerCase() ||
    value.request_id.toLowerCase() !== expected.requestId.toLowerCase() ||
    value.event_id !== expected.eventId.toLowerCase() ||
    (expected.eventCreatedAt !== undefined && value.event_created_at !== expected.eventCreatedAt) ||
    value.content_sha256 !== expected.contentSha256.toLowerCase()) {
    throw new Error("staging_participant_mirror_receipt_mismatch");
  }
  return value;
}

function readSourceMirrorBinding(
  value: unknown,
  expected: Readonly<{ walletAddress: string; sourcePostId: string; eventId?: string; nostrPubkey?: string }>,
): StagingParticipantSourceMirrorBinding {
  if (!isRecord(value) || !exactKeys(value, ["wallet_address", "source_post_id", "event_id", "nostr_pubkey"]) ||
    typeof value.wallet_address !== "string" || typeof value.source_post_id !== "string" ||
    typeof value.event_id !== "string" || !/^[a-f0-9]{64}$/u.test(value.event_id) ||
    typeof value.nostr_pubkey !== "string" || !/^[a-f0-9]{64}$/u.test(value.nostr_pubkey) ||
    value.wallet_address.toLowerCase() !== expected.walletAddress.toLowerCase() ||
    value.source_post_id.toLowerCase() !== expected.sourcePostId.toLowerCase() ||
    (expected.eventId !== undefined && value.event_id !== expected.eventId.toLowerCase()) ||
    (expected.nostrPubkey !== undefined && value.nostr_pubkey !== expected.nostrPubkey.toLowerCase())) {
    throw new Error("staging_participant_source_mirror_binding_mismatch");
  }
  return value as StagingParticipantSourceMirrorBinding;
}

function receiptHex(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function readPromotionReceipt(value: unknown, expected: PromotionInput | PromotionCompletionInput): StagingParticipantPromotionReceipt {
  if (!isPromotionReceipt(value) ||
    value.namespace !== expected.namespace ||
    value.wallet_address.toLowerCase() !== expected.walletAddress.toLowerCase() ||
    value.source_post_id.toLowerCase() !== expected.sourcePostId.toLowerCase() ||
    value.request_id.toLowerCase() !== expected.requestId.toLowerCase() ||
    value.idempotency_key_sha256 !== expected.idempotencyKeySha256.toLowerCase() ||
    value.discussion_root_id !== expected.discussionRootId.toLowerCase() ||
    value.discussion_root_sha256 !== expected.discussionRootSha256.toLowerCase() ||
    ("topicId" in expected && (value.topic_id !== expected.topicId || value.policy_version !== expected.policyVersion))) {
    throw new Error("staging_participant_promotion_receipt_mismatch");
  }
  return value;
}

function readSuggestionReceipt(value: unknown, expected: SuggestionInput | SuggestionCompletionInput): StagingParticipantSuggestionReceipt {
  if (!isSuggestionReceipt(value) ||
    value.namespace !== expected.namespace ||
    value.wallet_address.toLowerCase() !== expected.walletAddress.toLowerCase() ||
    value.discussion_root_id !== expected.discussionRootId.toLowerCase() ||
    value.source_author_pubkey !== expected.sourceAuthorPubkey.toLowerCase() ||
    value.request_id.toLowerCase() !== expected.requestId.toLowerCase() ||
    value.idempotency_key_sha256 !== expected.idempotencyKeySha256.toLowerCase() ||
    value.suggestion_id !== expected.suggestionId.toLowerCase() ||
    value.suggestion_sha256 !== expected.suggestionSha256.toLowerCase() ||
    ("topicId" in expected &&
      (value.mecky_answer_id !== expected.meckyAnswerId.toLowerCase() ||
        value.mecky_receipt_id !== expected.meckyReceiptId ||
        value.topic_id !== expected.topicId || value.policy_version !== expected.policyVersion))) {
    throw new Error("staging_participant_suggestion_receipt_mismatch");
  }
  return value;
}

function stringField(record: Record<string, unknown>, key: string): boolean {
  return typeof record[key] === "string" && Boolean(record[key]);
}

function isStagingParticipantPost(value: unknown): value is StagingParticipantPost {
  if (!isRecord(value)) return false;
  return stringField(value, "id") && stringField(value, "wallet_address") && stringField(value, "content") &&
    value.account_id === null && Array.isArray(value.media_urls) && value.media_urls.length === 0 &&
    value.video_url === null && value.category === "generell" && value.status === "published" &&
    typeof value.likes_count === "number" && typeof value.comments_count === "number" &&
    stringField(value, "created_at") && stringField(value, "updated_at") && value.post_type === "user" &&
    value.feed_type === "main" && value.linked_event_id === null && value.linked_experience_id === null;
}

function isStagingParticipantComment(value: unknown): value is StagingParticipantComment {
  if (!isRecord(value)) return false;
  return stringField(value, "id") && stringField(value, "post_id") && stringField(value, "wallet_address") &&
    stringField(value, "content") && value.account_id === null && Array.isArray(value.media_urls) &&
    value.media_urls.length === 0 && value.video_url === null && value.status === "published" &&
    stringField(value, "created_at") && value.author_username === null && value.author_profile_picture_url === null;
}

function isStagingParticipantMirrorReceipt(value: unknown): value is StagingParticipantMirrorReceipt {
  if (!isRecord(value)) return false;
  return stringField(value, "wallet_address") && stringField(value, "source_post_id") &&
    stringField(value, "request_id") && typeof value.event_id === "string" && /^[a-f0-9]{64}$/u.test(value.event_id) &&
    typeof value.event_created_at === "number" && Number.isSafeInteger(value.event_created_at) && value.event_created_at >= 0 &&
    typeof value.content_sha256 === "string" && /^[a-f0-9]{64}$/u.test(value.content_sha256) &&
    (value.state === "reserved" || value.state === "published");
}

function isPromotionReceipt(value: unknown): value is StagingParticipantPromotionReceipt {
  if (!isRecord(value)) return false;
  return stringField(value, "namespace") && stringField(value, "wallet_address") &&
    stringField(value, "source_post_id") && stringField(value, "request_id") &&
    receiptHex(value.idempotency_key_sha256) && receiptHex(value.discussion_root_id) &&
    receiptHex(value.discussion_root_sha256) && stringField(value, "topic_id") &&
    stringField(value, "policy_version") && receiptHex(value.receipt_checksum) &&
    (value.state === "reserved" || value.state === "published");
}

function isSuggestionReceipt(value: unknown): value is StagingParticipantSuggestionReceipt {
  if (!isRecord(value)) return false;
  return stringField(value, "namespace") && stringField(value, "wallet_address") &&
    receiptHex(value.discussion_root_id) && receiptHex(value.source_author_pubkey) &&
    stringField(value, "request_id") && receiptHex(value.idempotency_key_sha256) &&
    receiptHex(value.suggestion_id) && receiptHex(value.suggestion_sha256) &&
    receiptHex(value.mecky_answer_id) && stringField(value, "mecky_receipt_id") &&
    stringField(value, "topic_id") && stringField(value, "policy_version") &&
    receiptHex(value.receipt_checksum) &&
    (value.state === "reserved" || value.state === "published");
}

export const restrictedStagingParticipantRpcNames = {
  createMainTextPost: POST_RPC,
  createMainTextComment: COMMENT_RPC,
  readOwnedMainTextPost: OWNED_POST_RPC,
  reserveNostrPostMirror: RESERVE_MIRROR_RPC,
  completeNostrPostMirror: COMPLETE_MIRROR_RPC,
  bindPublishedNostrPostMirror: BIND_MIRROR_RPC,
  resolvePublishedNostrPostMirror: RESOLVE_MIRROR_RPC,
  reserveSourcePostPromotion: RESERVE_PROMOTION_RPC,
  completeSourcePostPromotion: COMPLETE_PROMOTION_RPC,
  resolvePublishedSourcePostPromotion: RESOLVE_PROMOTION_RPC,
  reserveTopicSuggestion: RESERVE_SUGGESTION_RPC,
  completeTopicSuggestion: COMPLETE_SUGGESTION_RPC,
  preflight: PREFLIGHT_RPC,
  topicTracerPreflight: TOPIC_TRACER_PREFLIGHT_RPC,
  citizenAdoptionPreflight: CITIZEN_ADOPTION_PREFLIGHT_RPC,
  syntheticCitizenAdoptionPreflight: SYNTHETIC_CITIZEN_ADOPTION_PREFLIGHT_RPC,
} as const;
