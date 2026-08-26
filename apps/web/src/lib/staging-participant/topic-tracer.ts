import { verifyEvent, type NostrEvent } from "@netizen-labs/nostr";

import {
  openDurableJsonOperation,
  resumeDurableJsonOperation,
  type DurableJsonOperation,
} from "./durable-operation";

const API_ROOT = "/api/staging-participant/v1";
const PROMOTION_SCHEMA = "staging_source_post_promotion_v1";
const SUGGESTION_SCHEMA = "staging_topic_suggestion_signature_v1";
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const HEX64 = /^[0-9a-f]{64}$/iu;
export const STAGING_PARTICIPANT_PROMOTION_MAX_REQUEST_BYTES = 16 * 1024;
export const STAGING_PARTICIPANT_SUGGESTION_MAX_REQUEST_BYTES = 64 * 1024;

type PromotionRequestBody = Readonly<{
  schemaVersion: typeof PROMOTION_SCHEMA;
  requestId: string;
  idempotencyKey: string;
  sourcePostId: string;
  rootEvent: NostrEvent;
}>;

type SuggestionRequestBody = Readonly<{
  schemaVersion: typeof SUGGESTION_SCHEMA;
  requestId: string;
  idempotencyKey: string;
  discussionRootEvent: NostrEvent;
  meckyAnswerEvent: NostrEvent;
  suggestionEvent: NostrEvent;
}>;

export type StagingParticipantPromotionReceipt = Readonly<{
  schemaVersion: "staging_source_post_promotion_receipt_v1";
  status: "promoted" | "already_promoted";
  sourcePostId: string;
  discussionRootId: string;
  topicId: string;
  sourceConversation: null | Readonly<{
    sourceAppPostId: string;
    sourceAppCommentId?: string;
    mentionEventId: string;
    meckyReplyEventId: string;
    meckyReceiptId?: string;
  }>;
  authorityBinding: "none";
  policyVersion: string;
  receiptChecksum: string;
}>;

export type StagingParticipantSuggestionReceipt = Readonly<{
  schemaVersion: "staging_topic_suggestion_receipt_v1";
  status: "signed" | "already_signed";
  suggestionId: string;
  discussionRootId: string;
  meckyAnswerId: string;
  meckyReceiptId: string;
  topicId: string;
  entryState: "citizen_adoption_required";
  authorityBinding: "none";
  submittedToCivicWorkflow: false;
  policyVersion: string;
  receiptChecksum: string;
}>;

function exactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

function isHex64(value: unknown): value is string {
  return typeof value === "string" && HEX64.test(value);
}

function isMeckyReceipt(value: unknown): value is string {
  return typeof value === "string" &&
    /^urn:stadtstack:mecky-answer:[0-9a-f]{64}$/iu.test(value);
}

function nextRequest(kind: "promotion" | "suggestion") {
  const requestId = globalThis.crypto?.randomUUID?.();
  if (!isUuid(requestId)) throw new Error("staging_participant_request_id_unavailable");
  return Object.freeze({ requestId, idempotencyKey: `${kind}-${requestId}` });
}

function validIdempotencyKey(value: unknown): value is string {
  return typeof value === "string" && value.length >= 8 && value.length <= 128;
}

function validPromotionRequest(value: unknown): value is PromotionRequestBody {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const body = value as Record<string, unknown>;
  return exactKeys(body, [
    "schemaVersion", "requestId", "idempotencyKey", "sourcePostId", "rootEvent",
  ]) && body.schemaVersion === PROMOTION_SCHEMA && isUuid(body.requestId) &&
    validIdempotencyKey(body.idempotencyKey) && isUuid(body.sourcePostId) &&
    Boolean(body.rootEvent && typeof body.rootEvent === "object" &&
      verifyEvent(body.rootEvent as NostrEvent));
}

function validSuggestionRequest(value: unknown): value is SuggestionRequestBody {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const body = value as Record<string, unknown>;
  return exactKeys(body, [
    "schemaVersion", "requestId", "idempotencyKey", "discussionRootEvent",
    "meckyAnswerEvent", "suggestionEvent",
  ]) && body.schemaVersion === SUGGESTION_SCHEMA && isUuid(body.requestId) &&
    validIdempotencyKey(body.idempotencyKey) &&
    Boolean(body.discussionRootEvent && typeof body.discussionRootEvent === "object" &&
      verifyEvent(body.discussionRootEvent as NostrEvent)) &&
    Boolean(body.meckyAnswerEvent && typeof body.meckyAnswerEvent === "object" &&
      verifyEvent(body.meckyAnswerEvent as NostrEvent)) &&
    Boolean(body.suggestionEvent && typeof body.suggestionEvent === "object" &&
      verifyEvent(body.suggestionEvent as NostrEvent));
}

async function request(
  path: "promote-source-post" | "sign-topic-suggestion",
  serializedBody: string,
): Promise<unknown> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(`${API_ROOT}/${path}`, {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: serializedBody,
      });
    } catch {
      if (attempt === 0) continue;
      throw new Error("staging_participant_topic_tracer_unavailable");
    }
    if (!response.ok && attempt === 0 && [502, 503, 504].includes(response.status)) {
      continue;
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new Error("staging_participant_topic_tracer_invalid_response");
    }
    if (response.ok) return payload;
    const error = payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as { error?: unknown }).error
      : undefined;
    throw new Error(typeof error === "string" && error ? error : "staging_participant_topic_tracer_rejected");
  }
  throw new Error("staging_participant_topic_tracer_unavailable");
}

async function submitPromotionOperation(
  operation: DurableJsonOperation<PromotionRequestBody>,
): Promise<StagingParticipantPromotionReceipt> {
  const active = operation.body;
  const rootTopicId = exactTopicId(active.rootEvent);
  if (!rootTopicId) {
    throw new Error("staging_participant_durable_operation_invalid");
  }
  const receipt = parsePromotionReceipt(
    await request("promote-source-post", operation.serializedBody),
  );
  if (
    receipt.sourcePostId !== active.sourcePostId ||
    receipt.discussionRootId !== active.rootEvent.id ||
    receipt.topicId !== rootTopicId
  ) {
    throw new Error("staging_participant_promotion_receipt_mismatch");
  }
  operation.complete();
  return receipt;
}

async function submitSuggestionOperation(
  operation: DurableJsonOperation<SuggestionRequestBody>,
): Promise<StagingParticipantSuggestionReceipt> {
  const active = operation.body;
  const rootTopicId = exactTopicId(active.discussionRootEvent);
  if (!rootTopicId) {
    throw new Error("staging_participant_durable_operation_invalid");
  }
  const receipt = parseSuggestionReceipt(
    await request("sign-topic-suggestion", operation.serializedBody),
  );
  if (
    receipt.discussionRootId !== active.discussionRootEvent.id ||
    receipt.meckyAnswerId !== active.meckyAnswerEvent.id ||
    receipt.suggestionId !== active.suggestionEvent.id ||
    receipt.topicId !== rootTopicId
  ) {
    throw new Error("staging_participant_suggestion_receipt_mismatch");
  }
  operation.complete();
  return receipt;
}

function validSourceConversation(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const conversation = value as Record<string, unknown>;
  const keys = Object.keys(conversation).sort();
  const allowed = new Set([
    "sourceAppPostId",
    "sourceAppCommentId",
    "mentionEventId",
    "meckyReplyEventId",
    "meckyReceiptId",
  ]);
  if (
    keys.length < 3 || keys.some((key) => !allowed.has(key)) ||
    !isUuid(conversation.sourceAppPostId) ||
    !isHex64(conversation.mentionEventId) || !isHex64(conversation.meckyReplyEventId)
  ) {
    return false;
  }
  if ("sourceAppCommentId" in conversation && !isUuid(conversation.sourceAppCommentId)) {
    return false;
  }
  return !("meckyReceiptId" in conversation) || isMeckyReceipt(conversation.meckyReceiptId);
}

function exactTopicId(event: NostrEvent): string | null {
  const tags = event.tags.filter((tag) => tag[0] === "topic");
  if (tags.length !== 1 || tags[0]?.length !== 2) return null;
  const topicId = tags[0][1];
  return typeof topicId === "string" && topicId.length > 0 ? topicId : null;
}

function parsePromotionReceipt(value: unknown): StagingParticipantPromotionReceipt {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("staging_participant_promotion_receipt_invalid");
  }
  const receipt = value as Record<string, unknown>;
  const conversation = receipt.sourceConversation;
  const conversationValid = conversation === null || validSourceConversation(conversation);
  if (
    !exactKeys(receipt, [
      "schemaVersion", "status", "sourcePostId", "discussionRootId", "topicId",
      "sourceConversation", "authorityBinding", "policyVersion", "receiptChecksum",
    ]) ||
    receipt.schemaVersion !== "staging_source_post_promotion_receipt_v1" ||
    (receipt.status !== "promoted" && receipt.status !== "already_promoted") ||
    !isUuid(receipt.sourcePostId) || !isHex64(receipt.discussionRootId) ||
    typeof receipt.topicId !== "string" || receipt.topicId.length < 1 ||
    !conversationValid || receipt.authorityBinding !== "none" ||
    typeof receipt.policyVersion !== "string" || !isHex64(receipt.receiptChecksum)
  ) {
    throw new Error("staging_participant_promotion_receipt_invalid");
  }
  return receipt as StagingParticipantPromotionReceipt;
}

function parseSuggestionReceipt(value: unknown): StagingParticipantSuggestionReceipt {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("staging_participant_suggestion_receipt_invalid");
  }
  const receipt = value as Record<string, unknown>;
  if (
    !exactKeys(receipt, [
      "schemaVersion", "status", "suggestionId", "discussionRootId", "meckyAnswerId",
      "meckyReceiptId", "topicId", "entryState", "authorityBinding",
      "submittedToCivicWorkflow", "policyVersion", "receiptChecksum",
    ]) ||
    receipt.schemaVersion !== "staging_topic_suggestion_receipt_v1" ||
    (receipt.status !== "signed" && receipt.status !== "already_signed") ||
    !isHex64(receipt.suggestionId) || !isHex64(receipt.discussionRootId) ||
    !isHex64(receipt.meckyAnswerId) || !isMeckyReceipt(receipt.meckyReceiptId) ||
    typeof receipt.topicId !== "string" || receipt.topicId.length < 1 ||
    receipt.entryState !== "citizen_adoption_required" ||
    receipt.authorityBinding !== "none" || receipt.submittedToCivicWorkflow !== false ||
    typeof receipt.policyVersion !== "string" || !isHex64(receipt.receiptChecksum)
  ) {
    throw new Error("staging_participant_suggestion_receipt_invalid");
  }
  return receipt as StagingParticipantSuggestionReceipt;
}

/**
 * Submit only an already author-signed ADR-0022 root. The participant gateway
 * independently resolves the wallet-owned source post and its Nostr binding;
 * this browser module never supplies wallet, municipality, source provenance,
 * Case, vote, treasury, or an arbitrary workbench intent.
 */
export async function promoteStagingParticipantSourcePost(input: Readonly<{
  sourcePostId: string;
  rootEvent: NostrEvent;
}>): Promise<StagingParticipantPromotionReceipt> {
  const rootTopicId = exactTopicId(input.rootEvent);
  if (!isUuid(input.sourcePostId) || !verifyEvent(input.rootEvent) || !rootTopicId) {
    throw new Error("staging_participant_promotion_input_invalid");
  }
  const requestInfo = nextRequest("promotion");
  const operation = openDurableJsonOperation({
    key: `promotion:${input.sourcePostId.toLowerCase()}`,
    candidate: {
      schemaVersion: PROMOTION_SCHEMA,
      requestId: requestInfo.requestId,
      idempotencyKey: requestInfo.idempotencyKey,
      sourcePostId: input.sourcePostId,
      rootEvent: input.rootEvent,
    },
    validate: validPromotionRequest,
    maxSerializedBodyBytes: STAGING_PARTICIPANT_PROMOTION_MAX_REQUEST_BYTES,
  });
  if (operation.body.sourcePostId.toLowerCase() !== input.sourcePostId.toLowerCase()) {
    throw new Error("staging_participant_durable_operation_invalid");
  }
  return submitPromotionOperation(operation);
}

export async function resumeStagingParticipantSourcePostPromotion(
  sourcePostId: string,
): Promise<StagingParticipantPromotionReceipt | null> {
  if (!isUuid(sourcePostId)) {
    throw new Error("staging_participant_promotion_input_invalid");
  }
  const operation = resumeDurableJsonOperation({
    key: `promotion:${sourcePostId.toLowerCase()}`,
    validate: validPromotionRequest,
    maxSerializedBodyBytes: STAGING_PARTICIPANT_PROMOTION_MAX_REQUEST_BYTES,
  });
  if (!operation) return null;
  if (operation.body.sourcePostId.toLowerCase() !== sourcePostId.toLowerCase()) {
    throw new Error("staging_participant_durable_operation_invalid");
  }
  return submitPromotionOperation(operation);
}

/**
 * Submit only the complete source-author-signed participant suggestion. The
 * gateway resolves and verifies the root, source mirror, Mecky answer and
 * receipt server-side before publishing its one idempotent result.
 */
export async function signStagingParticipantTopicSuggestion(input: Readonly<{
  discussionRootEvent: NostrEvent;
  meckyAnswerEvent: NostrEvent;
  suggestionEvent: NostrEvent;
}>): Promise<StagingParticipantSuggestionReceipt> {
  const rootTopicId = exactTopicId(input.discussionRootEvent);
  if (
    !verifyEvent(input.discussionRootEvent) || !verifyEvent(input.meckyAnswerEvent) ||
    !verifyEvent(input.suggestionEvent) || !rootTopicId
  ) {
    throw new Error("staging_participant_suggestion_input_invalid");
  }
  const requestInfo = nextRequest("suggestion");
  const operation = openDurableJsonOperation({
    key: `suggestion:${input.discussionRootEvent.id}`,
    candidate: {
      schemaVersion: SUGGESTION_SCHEMA,
      requestId: requestInfo.requestId,
      idempotencyKey: requestInfo.idempotencyKey,
      discussionRootEvent: input.discussionRootEvent,
      meckyAnswerEvent: input.meckyAnswerEvent,
      suggestionEvent: input.suggestionEvent,
    },
    validate: validSuggestionRequest,
    maxSerializedBodyBytes: STAGING_PARTICIPANT_SUGGESTION_MAX_REQUEST_BYTES,
  });
  if (operation.body.discussionRootEvent.id !== input.discussionRootEvent.id) {
    throw new Error("staging_participant_durable_operation_invalid");
  }
  return submitSuggestionOperation(operation);
}

export async function resumeStagingParticipantTopicSuggestion(
  discussionRootId: string,
): Promise<StagingParticipantSuggestionReceipt | null> {
  if (!isHex64(discussionRootId)) {
    throw new Error("staging_participant_suggestion_input_invalid");
  }
  const operation = resumeDurableJsonOperation({
    key: `suggestion:${discussionRootId.toLowerCase()}`,
    validate: validSuggestionRequest,
    maxSerializedBodyBytes: STAGING_PARTICIPANT_SUGGESTION_MAX_REQUEST_BYTES,
  });
  if (!operation) return null;
  if (operation.body.discussionRootEvent.id !== discussionRootId.toLowerCase()) {
    throw new Error("staging_participant_durable_operation_invalid");
  }
  return submitSuggestionOperation(operation);
}

export function hasPendingStagingParticipantTopicSuggestion(
  discussionRootId: string,
): boolean {
  if (!isHex64(discussionRootId)) return false;
  return resumeDurableJsonOperation({
    key: `suggestion:${discussionRootId.toLowerCase()}`,
    validate: validSuggestionRequest,
    maxSerializedBodyBytes: STAGING_PARTICIPANT_SUGGESTION_MAX_REQUEST_BYTES,
  }) !== null;
}
