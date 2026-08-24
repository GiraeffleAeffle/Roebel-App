import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";

import { buildNoteEvent, verifyEvent, type NostrEvent } from "./events";
import { getPublicKeyHex } from "./keys";

export type CivicCaseBinding = {
  municipalityId: string;
  sourceCaseId: string;
  canonicalCaseId: string;
};

export type CivicDiscussionInput = CivicCaseBinding & {
  agentPubkey: string;
  content: string;
  createdAt?: number;
};

export type CivicPromotionInput = CivicDiscussionInput & {
  sourcePost: NostrEvent;
  topicId: string;
};

export type CivicTopicBinding = {
  municipalityId: string;
  topicId: string;
};

/**
 * Provenance selected by the author from one ordinary Röbel conversation.
 *
 * The discriminator is deliberately required: an omitted `conversationSource`
 * means that no app conversation was selected, while a present value must
 * describe the complete mention/reply chain.
 */
export type CivicSelectedConversationSource = {
  kind: "selected_conversation";
  sourceAppPostId: string;
  sourceAppCommentId?: string;
  mentionEventId: string;
  replyEventId: string;
  receiptId?: string;
};

export type CivicTopicPromotionInput = CivicTopicBinding & {
  sourcePost: NostrEvent;
  topicTitle: string;
  agentPubkey: string;
  content: string;
  conversationSource?: CivicSelectedConversationSource;
  createdAt?: number;
};

export type CivicArgumentInput = CivicTopicBinding & {
  rootEvent: NostrEvent;
  parentEvent: NostrEvent;
  stance: "pro" | "con";
  content: string;
  createdAt?: number;
};

export type PublicMeckySuggestionDraftV1 = {
  schemaVersion: "public_mecky_suggestion_draft_v1";
  draftId: string;
  sourceAnswerReceiptId: string;
  sourceDiscussionId: string;
  sourceDiscussionRef: string;
  municipalityId: string;
  sourceCaseId: string;
  caseId: string;
  citizenPubkey: string;
  title: string;
  summary: string;
  entryState: "citizen_signature_required";
  authorityBinding: "none";
  submittedToCivicWorkflow: false;
};

export type CitizenSignedSuggestionV1 = {
  schemaVersion: "citizen_signed_suggestion_v1";
  candidateId: string;
  signerPubkey: string;
  draft: PublicMeckySuggestionDraftV1;
  event: {
    id: string;
    pubkey: string;
    createdAt: number;
    kind: 1;
    tags: string[][];
    content: string;
    signature: string;
  };
  verification: { kind: "nostr_nip01"; verified: true };
  entryState: "awaiting_human_case_admission";
  authorityBinding: "none";
  submittedToCivicWorkflow: false;
};

export type CitizenSignedSuggestionInput = {
  binding: CivicCaseBinding;
  sourceDiscussion: NostrEvent;
  sourceAnswer: NostrEvent;
  agentPubkey: string;
  title: string;
  summary: string;
  createdAt: number;
};

export type PublicMeckyTopicSuggestionDraftV1 = {
  schemaVersion: "public_mecky_topic_suggestion_draft_v1";
  draftId: string;
  sourceAnswerReceiptId: string;
  sourceDiscussionId: string;
  sourceDiscussionRef: string;
  municipalityId: string;
  topicId: string;
  citizenPubkey: string;
  title: string;
  summary: string;
  entryState: "citizen_signature_required";
  authorityBinding: "none";
  submittedToCivicWorkflow: false;
};

export type CitizenSignedTopicSuggestionV1 = {
  schemaVersion: "citizen_signed_topic_suggestion_v1";
  candidateId: string;
  signerPubkey: string;
  draft: PublicMeckyTopicSuggestionDraftV1;
  event: NostrEvent;
  verification: { kind: "nostr_nip01"; verified: true };
  entryState: "awaiting_human_case_admission";
  authorityBinding: "none";
  submittedToCivicWorkflow: false;
};

export type CitizenSignedTopicSuggestionInput = {
  binding: CivicTopicBinding;
  sourceDiscussion: NostrEvent;
  sourceAnswer: NostrEvent;
  agentPubkey: string;
  title: string;
  summary: string;
  createdAt: number;
};

export type VerifyCitizenSignedTopicSuggestionInput = Omit<
  CitizenSignedTopicSuggestionInput,
  "title" | "summary" | "createdAt"
> & {
  event: NostrEvent;
};

const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const PUBKEY = /^[0-9a-f]{64}$/;
const TOPIC_ID =
  /^urn:stadtstack:topic:municipality:([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?):([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)$/;
const UUID_V7 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const APP_SOURCE_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const NOSTR_EVENT_ID = /^[0-9a-f]{64}$/;
const MECKY_RECEIPT = /^urn:stadtstack:mecky-answer:[0-9a-f]{64}$/;

function validateBinding(input: CivicCaseBinding): void {
  const parts = input.canonicalCaseId.split(":");
  if (
    !SLUG.test(input.municipalityId) ||
    !SLUG.test(input.sourceCaseId) ||
    parts.length !== 6 ||
    parts.slice(0, 4).join(":") !== "urn:stadtstack:case:municipality" ||
    parts[4] !== input.municipalityId ||
    !UUID_V7.test(parts[5] ?? "")
  ) {
    throw new Error("civic_case_binding_invalid");
  }
}

function validateTopicBinding(input: CivicTopicBinding): void {
  const match = TOPIC_ID.exec(input.topicId);
  if (
    !SLUG.test(input.municipalityId) ||
    !match ||
    match[1] !== input.municipalityId
  ) {
    throw new Error("civic_topic_binding_invalid");
  }
}

function validateSelectedConversationSource(
  value: unknown
): CivicSelectedConversationSource | undefined {
  if (value === undefined) return undefined;
  if (
    !exactRecord(value, [
      "kind",
      "sourceAppPostId",
      "sourceAppCommentId",
      "mentionEventId",
      "replyEventId",
      "receiptId",
    ]) &&
    !exactRecord(value, [
      "kind",
      "sourceAppPostId",
      "mentionEventId",
      "replyEventId",
      "receiptId",
    ]) &&
    !exactRecord(value, [
      "kind",
      "sourceAppPostId",
      "sourceAppCommentId",
      "mentionEventId",
      "replyEventId",
    ]) &&
    !exactRecord(value, [
      "kind",
      "sourceAppPostId",
      "mentionEventId",
      "replyEventId",
    ])
  ) {
    throw new Error("civic_conversation_source_invalid");
  }
  const source = value as Record<string, unknown>;
  if (
    source.kind !== "selected_conversation" ||
    typeof source.sourceAppPostId !== "string" ||
    !APP_SOURCE_ID.test(source.sourceAppPostId) ||
    (source.sourceAppCommentId !== undefined &&
      (typeof source.sourceAppCommentId !== "string" ||
        !APP_SOURCE_ID.test(source.sourceAppCommentId))) ||
    typeof source.mentionEventId !== "string" ||
    !NOSTR_EVENT_ID.test(source.mentionEventId) ||
    typeof source.replyEventId !== "string" ||
    !NOSTR_EVENT_ID.test(source.replyEventId) ||
    (source.receiptId !== undefined &&
      (typeof source.receiptId !== "string" ||
        !MECKY_RECEIPT.test(source.receiptId))) ||
    source.mentionEventId === source.replyEventId ||
    source.sourceAppCommentId === source.sourceAppPostId
  ) {
    throw new Error("civic_conversation_source_invalid");
  }
  return source as CivicSelectedConversationSource;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function digest(value: unknown): string {
  return `sha256:${bytesToHex(sha256(utf8ToBytes(canonical(value))))}`;
}

function singleTag(event: NostrEvent, name: string): string | null {
  const values = event.tags
    .filter((tag) => tag[0] === name && typeof tag[1] === "string")
    .map((tag) => tag[1]!);
  return values.length === 1 ? values[0]! : null;
}

function exactRecord(
  value: unknown,
  keys: readonly string[]
): value is Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    return false;
  }
  const actual = Reflect.ownKeys(value);
  return (
    actual.length === keys.length &&
    actual.every((key) => typeof key === "string" && keys.includes(key))
  );
}

function validSuggestionEvidence(event: NostrEvent): boolean {
  const evidence = event.tags.filter((tag) => tag[0] === "evidence");
  if (
    evidence.length < 1 ||
    evidence.length > 3 ||
    new Set(evidence.map((tag) => tag[1])).size !== evidence.length
  ) {
    return false;
  }
  return evidence.every((tag) => {
    if (tag.length !== 3 || !/^sha256:[0-9a-f]{64}$/.test(tag[1] ?? "")) {
      return false;
    }
    try {
      const url = new URL(tag[2]!);
      return url.protocol === "https:" && !url.username && !url.password;
    } catch {
      return false;
    }
  });
}

function normalizedSuggestionContent(input: {
  title: string;
  summary: string;
}): { title: string; summary: string } {
  const title = input.title.trim();
  const summary = input.summary.trim();
  if (
    !title ||
    title.length > 240 ||
    !summary ||
    summary.length > 2_000 ||
    /[\u0000-\u001f\u007f]/.test(title) ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(summary)
  ) {
    throw new Error("civic_suggestion_content_invalid");
  }
  return { title, summary };
}

function validateTopicSuggestionSources(
  input: Pick<
    CitizenSignedTopicSuggestionInput,
    "binding" | "sourceDiscussion" | "sourceAnswer" | "agentPubkey"
  >,
  citizenPubkey: string
): string {
  validateTopicBinding(input.binding);
  if (
    !PUBKEY.test(citizenPubkey) ||
    !verifyEvent(input.sourceDiscussion) ||
    input.sourceDiscussion.kind !== 1 ||
    input.sourceDiscussion.pubkey !== citizenPubkey ||
    singleTag(input.sourceDiscussion, "t") !==
      "stadtstack-civic-discussion" ||
    singleTag(input.sourceDiscussion, "municipality") !==
      input.binding.municipalityId ||
    singleTag(input.sourceDiscussion, "topic") !== input.binding.topicId ||
    singleTag(input.sourceDiscussion, "stance") !== "root" ||
    singleTag(input.sourceDiscussion, "argument-root") !== "self" ||
    singleTag(input.sourceDiscussion, "case") !== null ||
    singleTag(input.sourceDiscussion, "stadtstack-case") !== null
  ) {
    throw new Error("civic_topic_suggestion_discussion_invalid");
  }

  const receiptId = singleTag(input.sourceAnswer, "mecky-receipt");
  const replyParents = input.sourceAnswer.tags.filter(
    (tag) =>
      tag[0] === "e" &&
      tag[1] === input.sourceDiscussion.id &&
      tag[3] === "reply"
  );
  if (
    !PUBKEY.test(input.agentPubkey) ||
    !verifyEvent(input.sourceAnswer) ||
    input.sourceAnswer.kind !== 1 ||
    input.sourceAnswer.pubkey !== input.agentPubkey ||
    input.sourceAnswer.created_at < input.sourceDiscussion.created_at ||
    replyParents.length !== 1 ||
    singleTag(input.sourceAnswer, "p") !== citizenPubkey ||
    singleTag(input.sourceAnswer, "municipality") !==
      input.binding.municipalityId ||
    singleTag(input.sourceAnswer, "topic") !== input.binding.topicId ||
    singleTag(input.sourceAnswer, "case") !== null ||
    singleTag(input.sourceAnswer, "stadtstack-case") !== null ||
    !receiptId ||
    !/^urn:stadtstack:mecky-answer:[0-9a-f]{64}$/.test(receiptId) ||
    !validSuggestionEvidence(input.sourceAnswer)
  ) {
    throw new Error("civic_topic_suggestion_answer_invalid");
  }
  return receiptId;
}

function topicSuggestionDraft(input: {
  binding: CivicTopicBinding;
  citizenPubkey: string;
  receiptId: string;
  sourceDiscussionId: string;
  title: string;
  summary: string;
}): PublicMeckyTopicSuggestionDraftV1 {
  const draftCore = {
    sourceAnswerReceiptId: input.receiptId,
    sourceDiscussionId: input.sourceDiscussionId,
    sourceDiscussionRef: `nostr://event/${input.sourceDiscussionId}`,
    municipalityId: input.binding.municipalityId,
    topicId: input.binding.topicId,
    citizenPubkey: input.citizenPubkey,
    title: input.title,
    summary: input.summary,
  };
  return {
    schemaVersion: "public_mecky_topic_suggestion_draft_v1",
    draftId: `urn:stadtstack:topic-suggestion-draft:${digest(draftCore).slice("sha256:".length)}`,
    ...draftCore,
    entryState: "citizen_signature_required",
    authorityBinding: "none",
    submittedToCivicWorkflow: false,
  };
}

function topicSuggestionCandidate(
  event: NostrEvent,
  draft: PublicMeckyTopicSuggestionDraftV1
): CitizenSignedTopicSuggestionV1 {
  return {
    schemaVersion: "citizen_signed_topic_suggestion_v1",
    candidateId: `urn:stadtstack:signed-topic-suggestion:${event.id}`,
    signerPubkey: event.pubkey,
    draft,
    event,
    verification: { kind: "nostr_nip01", verified: true },
    entryState: "awaiting_human_case_admission",
    authorityBinding: "none",
    submittedToCivicWorkflow: false,
  };
}

export function buildCivicDiscussionEvent(
  secretKey: Uint8Array,
  input: CivicDiscussionInput
): NostrEvent {
  validateBinding(input);
  if (!PUBKEY.test(input.agentPubkey))
    throw new Error("civic_agent_pubkey_invalid");
  if (
    typeof input.content !== "string" ||
    input.content !== input.content.trim() ||
    input.content.length === 0 ||
    input.content.length > 2_000 ||
    !/@mecky\b/i.test(input.content)
  ) {
    throw new Error("civic_discussion_content_invalid");
  }
  if (
    input.createdAt !== undefined &&
    (!Number.isSafeInteger(input.createdAt) || input.createdAt < 0)
  ) {
    throw new Error("civic_discussion_timestamp_invalid");
  }
  return buildNoteEvent(secretKey, input.content, {
    ...(input.createdAt === undefined ? {} : { createdAt: input.createdAt }),
    tags: [
      ["p", input.agentPubkey],
      ["t", "stadtstack-civic-discussion"],
      ["municipality", input.municipalityId],
      ["case", input.sourceCaseId],
      ["stadtstack-case", input.canonicalCaseId],
    ],
  });
}

/**
 * Promote an immutable, ordinary top-level note into a new civic discussion.
 *
 * Nostr events cannot be edited after signing. Promotion therefore creates a
 * second signed event and carries both the standard NIP-18 quote and an
 * explicit source-post tag. The original post remains a normal feed entry.
 */
export function buildCivicPromotionEvent(
  secretKey: Uint8Array,
  input: CivicPromotionInput
): NostrEvent {
  validateBinding(input);
  const expectedTopicId = `urn:stadtstack:topic:municipality:${input.municipalityId}:${input.sourceCaseId}`;
  const sourceIsOrdinaryTopLevelPost =
    verifyEvent(input.sourcePost) &&
    input.sourcePost.kind === 1 &&
    input.sourcePost.pubkey === getPublicKeyHex(secretKey) &&
    !input.sourcePost.tags.some((tag) => tag[0] === "e") &&
    !input.sourcePost.tags.some(
      (tag) => tag[0] === "t" && tag[1] === "stadtstack-civic-discussion"
    );
  if (!sourceIsOrdinaryTopLevelPost) {
    throw new Error("civic_promotion_source_invalid");
  }
  if (input.topicId !== expectedTopicId) {
    throw new Error("civic_promotion_topic_invalid");
  }
  if (!PUBKEY.test(input.agentPubkey)) {
    throw new Error("civic_agent_pubkey_invalid");
  }
  if (
    typeof input.content !== "string" ||
    input.content !== input.content.trim() ||
    input.content.length === 0 ||
    input.content.length > 2_000 ||
    !/@mecky\b/i.test(input.content)
  ) {
    throw new Error("civic_discussion_content_invalid");
  }
  if (
    input.createdAt !== undefined &&
    (!Number.isSafeInteger(input.createdAt) ||
      input.createdAt <= input.sourcePost.created_at)
  ) {
    throw new Error("civic_promotion_timestamp_invalid");
  }
  return buildNoteEvent(secretKey, input.content, {
    ...(input.createdAt === undefined ? {} : { createdAt: input.createdAt }),
    tags: [
      ["p", input.agentPubkey],
      ["q", input.sourcePost.id, "", input.sourcePost.pubkey],
      ["source-post", input.sourcePost.id],
      ["t", "stadtstack-civic-discussion"],
      ["municipality", input.municipalityId],
      ["case", input.sourceCaseId],
      ["topic", input.topicId],
      ["stadtstack-case", input.canonicalCaseId],
      ["stance", "root"],
      ["argument-root", "self"],
    ],
  });
}

/**
 * Start a human-confirmed topic discussion without pre-allocating a CivicCase.
 *
 * The case identifier deliberately does not exist at this stage. A later
 * citizen-signed proposal and human admission create that separate record.
 */
export function buildCivicTopicPromotionEvent(
  secretKey: Uint8Array,
  input: CivicTopicPromotionInput
): NostrEvent {
  const conversationSource = validateSelectedConversationSource(
    input.conversationSource
  );
  const topicParts = input.topicId.split(":");
  const topicSlug = topicParts[5] ?? "";
  const sourceIsOrdinaryTopLevelPost =
    verifyEvent(input.sourcePost) &&
    input.sourcePost.kind === 1 &&
    input.sourcePost.pubkey === getPublicKeyHex(secretKey) &&
    !input.sourcePost.tags.some((tag) => tag[0] === "e") &&
    !input.sourcePost.tags.some(
      (tag) => tag[0] === "t" && tag[1] === "stadtstack-civic-discussion"
    );
  if (!sourceIsOrdinaryTopLevelPost) {
    throw new Error("civic_promotion_source_invalid");
  }
  if (
    conversationSource !== undefined &&
    singleTag(input.sourcePost, "source-app-post") !==
      conversationSource.sourceAppPostId
  ) {
    throw new Error("civic_conversation_source_invalid");
  }
  if (
    !SLUG.test(input.municipalityId) ||
    topicParts.length !== 6 ||
    topicParts.slice(0, 4).join(":") !==
      "urn:stadtstack:topic:municipality" ||
    topicParts[4] !== input.municipalityId ||
    !SLUG.test(topicSlug)
  ) {
    throw new Error("civic_promotion_topic_invalid");
  }
  if (
    typeof input.topicTitle !== "string" ||
    input.topicTitle !== input.topicTitle.trim() ||
    input.topicTitle.length < 3 ||
    input.topicTitle.length > 120 ||
    /[\u0000-\u001f\u007f]/.test(input.topicTitle)
  ) {
    throw new Error("civic_promotion_topic_title_invalid");
  }
  if (!PUBKEY.test(input.agentPubkey)) {
    throw new Error("civic_agent_pubkey_invalid");
  }
  if (
    typeof input.content !== "string" ||
    input.content !== input.content.trim() ||
    input.content.length === 0 ||
    input.content.length > 2_000 ||
    !/@mecky\b/i.test(input.content)
  ) {
    throw new Error("civic_discussion_content_invalid");
  }
  if (
    input.createdAt !== undefined &&
    (!Number.isSafeInteger(input.createdAt) ||
      input.createdAt <= input.sourcePost.created_at)
  ) {
    throw new Error("civic_promotion_timestamp_invalid");
  }
  return buildNoteEvent(secretKey, input.content, {
    ...(input.createdAt === undefined ? {} : { createdAt: input.createdAt }),
    tags: [
      ["p", input.agentPubkey],
      ["q", input.sourcePost.id, "", input.sourcePost.pubkey],
      ["source-post", input.sourcePost.id],
      ...(conversationSource
        ? [
            ["source-app-post", conversationSource.sourceAppPostId],
            ...(conversationSource.sourceAppCommentId === undefined
              ? []
              : [["source-app-comment", conversationSource.sourceAppCommentId]]),
            ["source-conversation-mention", conversationSource.mentionEventId],
            ["source-mecky-reply", conversationSource.replyEventId],
            ...(conversationSource.receiptId === undefined
              ? []
              : [["source-mecky-receipt", conversationSource.receiptId]]),
          ]
        : []),
      ["t", "stadtstack-civic-discussion"],
      ["municipality", input.municipalityId],
      ["topic", input.topicId],
      ["topic-title", input.topicTitle],
      ["stance", "root"],
      ["argument-root", "self"],
    ],
  });
}

function selectedConversationSourceFromTags(
  candidate: NostrEvent
): CivicSelectedConversationSource | undefined {
  const names = new Set([
    "source-app-post",
    "source-app-comment",
    "source-conversation-mention",
    "source-mecky-reply",
    "source-mecky-receipt",
  ]);
  if (!candidate.tags.some((tag) => names.has(tag[0] ?? ""))) return undefined;
  const required = (name: string): string => {
    const value = singleTag(candidate, name);
    if (value === null) throw new Error("civic_conversation_source_invalid");
    return value;
  };
  const optional = (name: string): string | undefined => {
    const matches = candidate.tags.filter((tag) => tag[0] === name);
    if (matches.length === 0) return undefined;
    if (matches.length !== 1 || matches[0]!.length !== 2) {
      throw new Error("civic_conversation_source_invalid");
    }
    return matches[0]![1];
  };
  const sourceAppCommentId = optional("source-app-comment");
  const receiptId = optional("source-mecky-receipt");
  return validateSelectedConversationSource({
    kind: "selected_conversation",
    sourceAppPostId: required("source-app-post"),
    ...(sourceAppCommentId === undefined ? {} : { sourceAppCommentId }),
    mentionEventId: required("source-conversation-mention"),
    replyEventId: required("source-mecky-reply"),
    ...(receiptId === undefined ? {} : { receiptId }),
  });
}

/**
 * Verify the complete no-authority promotion envelope used by writers and
 * stale-read recovery. A subset check is intentionally insufficient because
 * extra case tags would otherwise turn a citizen post into false civic state.
 */
export function verifyCivicTopicPromotionEvent(input: {
  event: NostrEvent;
  sourcePost: NostrEvent;
  municipalityId: string;
  agentPubkey: string;
}): Readonly<{
  topicId: string;
  topicTitle: string;
  conversationSource?: CivicSelectedConversationSource;
}> | null {
  const { event, sourcePost, municipalityId, agentPubkey } = input;
  let conversationSource: CivicSelectedConversationSource | undefined;
  try {
    conversationSource = selectedConversationSourceFromTags(event);
  } catch {
    return null;
  }
  const topicId = singleTag(event, "topic");
  const topicTitle = singleTag(event, "topic-title");
  const topicParts = topicId?.split(":") ?? [];
  const sourceIsOrdinaryTopLevelPost =
    verifyEvent(sourcePost) &&
    sourcePost.kind === 1 &&
    !sourcePost.tags.some((tag) => tag[0] === "e") &&
    !sourcePost.tags.some(
      (tag) => tag[0] === "t" && tag[1] === "stadtstack-civic-discussion"
    );
  if (
    !sourceIsOrdinaryTopLevelPost ||
    !verifyEvent(event) ||
    event.kind !== 1 ||
    event.pubkey !== sourcePost.pubkey ||
    !SLUG.test(municipalityId) ||
    !PUBKEY.test(agentPubkey) ||
    topicParts.length !== 6 ||
    topicParts.slice(0, 4).join(":") !==
      "urn:stadtstack:topic:municipality" ||
    topicParts[4] !== municipalityId ||
    !SLUG.test(topicParts[5] ?? "") ||
    topicTitle === null ||
    topicTitle !== topicTitle.trim() ||
    topicTitle.length < 3 ||
    topicTitle.length > 120 ||
    /[\u0000-\u001f\u007f]/.test(topicTitle) ||
    event.content !== event.content.trim() ||
    event.content.length < 1 ||
    event.content.length > 2_000 ||
    !/@mecky\b/i.test(event.content) ||
    event.created_at <= sourcePost.created_at ||
    (conversationSource !== undefined &&
      singleTag(sourcePost, "source-app-post") !==
        conversationSource.sourceAppPostId)
  ) {
    return null;
  }
  const expectedTags = [
    ["p", agentPubkey],
    ["q", sourcePost.id, "", sourcePost.pubkey],
    ["source-post", sourcePost.id],
    ...(conversationSource === undefined
      ? []
      : [
          ["source-app-post", conversationSource.sourceAppPostId],
          ...(conversationSource.sourceAppCommentId === undefined
            ? []
            : [["source-app-comment", conversationSource.sourceAppCommentId]]),
          ["source-conversation-mention", conversationSource.mentionEventId],
          ["source-mecky-reply", conversationSource.replyEventId],
          ...(conversationSource.receiptId === undefined
            ? []
            : [["source-mecky-receipt", conversationSource.receiptId]]),
        ]),
    ["t", "stadtstack-civic-discussion"],
    ["municipality", municipalityId],
    ["topic", topicId!],
    ["topic-title", topicTitle],
    ["stance", "root"],
    ["argument-root", "self"],
  ];
  if (JSON.stringify(event.tags) !== JSON.stringify(expectedTags)) return null;
  return Object.freeze({
    topicId: topicId!,
    topicTitle,
    ...(conversationSource === undefined ? {} : { conversationSource }),
  });
}

/** Sign one citizen argument inside an existing topic-only discussion tree. */
export function buildCivicArgumentEvent(
  secretKey: Uint8Array,
  input: CivicArgumentInput,
): NostrEvent {
  const expectedTopicId = `urn:stadtstack:topic:municipality:${input.municipalityId}:${input.topicId.split(":").at(-1) ?? ""}`;
  const rootValid =
    verifyEvent(input.rootEvent) &&
    input.rootEvent.kind === 1 &&
    singleTag(input.rootEvent, "t") === "stadtstack-civic-discussion" &&
    singleTag(input.rootEvent, "municipality") === input.municipalityId &&
    singleTag(input.rootEvent, "topic") === input.topicId &&
    singleTag(input.rootEvent, "stance") === "root" &&
    singleTag(input.rootEvent, "argument-root") === "self" &&
    singleTag(input.rootEvent, "case") === null &&
    singleTag(input.rootEvent, "stadtstack-case") === null;
  const parentIsRoot = input.parentEvent.id === input.rootEvent.id;
  const parentValid =
    verifyEvent(input.parentEvent) &&
    input.parentEvent.kind === 1 &&
    (parentIsRoot ||
      (singleTag(input.parentEvent, "argument-root") === input.rootEvent.id &&
        singleTag(input.parentEvent, "municipality") === input.municipalityId &&
        singleTag(input.parentEvent, "topic") === input.topicId &&
        (singleTag(input.parentEvent, "stance") === "pro" ||
          singleTag(input.parentEvent, "stance") === "con")));
  if (
    !SLUG.test(input.municipalityId) ||
    expectedTopicId !== input.topicId ||
    !rootValid ||
    !parentValid
  ) {
    throw new Error("civic_argument_thread_invalid");
  }
  if (
    typeof input.content !== "string" ||
    input.content !== input.content.trim() ||
    input.content.length < 1 ||
    input.content.length > 1_000 ||
    /[\u0000-\u001f\u007f]/.test(input.content)
  ) {
    throw new Error("civic_argument_content_invalid");
  }
  if (
    input.createdAt !== undefined &&
    (!Number.isSafeInteger(input.createdAt) ||
      input.createdAt <= input.rootEvent.created_at ||
      input.createdAt <= input.parentEvent.created_at)
  ) {
    throw new Error("civic_argument_timestamp_invalid");
  }
  return buildNoteEvent(secretKey, input.content, {
    ...(input.createdAt === undefined ? {} : { createdAt: input.createdAt }),
    tags: [
      ["e", input.rootEvent.id, "", "root"],
      ["e", input.parentEvent.id, "", "reply"],
      ["argument-root", input.rootEvent.id],
      ["stance", input.stance],
      ["t", "stadtstack-argument"],
      ["municipality", input.municipalityId],
      ["topic", input.topicId],
    ],
  });
}

export function buildCitizenSignedSuggestion(
  secretKey: Uint8Array,
  input: CitizenSignedSuggestionInput
): CitizenSignedSuggestionV1 {
  validateBinding(input.binding);
  if (
    !verifyEvent(input.sourceDiscussion) ||
    input.sourceDiscussion.pubkey !== getPublicKeyHex(secretKey) ||
    input.sourceDiscussion.kind !== 1 ||
    singleTag(input.sourceDiscussion, "municipality") !==
      input.binding.municipalityId ||
    singleTag(input.sourceDiscussion, "case") !== input.binding.sourceCaseId ||
    singleTag(input.sourceDiscussion, "stadtstack-case") !==
      input.binding.canonicalCaseId
  ) {
    throw new Error("civic_source_discussion_invalid");
  }

  const receiptId = singleTag(input.sourceAnswer, "mecky-receipt");
  const replyParents = input.sourceAnswer.tags.filter(
    (tag) =>
      tag[0] === "e" &&
      tag[1] === input.sourceDiscussion.id &&
      tag[3] === "reply"
  );
  const evidence = input.sourceAnswer.tags.filter(
    (tag) => tag[0] === "evidence"
  );
  let evidenceValid = evidence.length >= 1 && evidence.length <= 3;
  for (const tag of evidence) {
    if (tag.length !== 3 || !/^sha256:[0-9a-f]{64}$/.test(tag[1] ?? "")) {
      evidenceValid = false;
      continue;
    }
    try {
      const url = new URL(tag[2]!);
      if (url.protocol !== "https:" || url.username || url.password) {
        evidenceValid = false;
      }
    } catch {
      evidenceValid = false;
    }
  }
  if (
    !PUBKEY.test(input.agentPubkey) ||
    !verifyEvent(input.sourceAnswer) ||
    input.sourceAnswer.kind !== 1 ||
    input.sourceAnswer.pubkey !== input.agentPubkey ||
    input.sourceAnswer.created_at < input.sourceDiscussion.created_at ||
    replyParents.length !== 1 ||
    singleTag(input.sourceAnswer, "p") !== input.sourceDiscussion.pubkey ||
    singleTag(input.sourceAnswer, "municipality") !==
      input.binding.municipalityId ||
    singleTag(input.sourceAnswer, "case") !== input.binding.sourceCaseId ||
    singleTag(input.sourceAnswer, "stadtstack-case") !==
      input.binding.canonicalCaseId ||
    !receiptId ||
    !/^urn:stadtstack:mecky-answer:[0-9a-f]{64}$/.test(receiptId) ||
    !evidenceValid
  ) {
    throw new Error("civic_source_answer_invalid");
  }
  const title = input.title.trim();
  const summary = input.summary.trim();
  if (!title || title.length > 240 || !summary || summary.length > 2_000) {
    throw new Error("civic_suggestion_content_invalid");
  }
  if (!Number.isSafeInteger(input.createdAt) || input.createdAt < 0) {
    throw new Error("civic_suggestion_timestamp_invalid");
  }
  const draftCore = {
    sourceAnswerReceiptId: receiptId,
    sourceDiscussionId: input.sourceDiscussion.id,
    sourceDiscussionRef: `nostr://event/${input.sourceDiscussion.id}`,
    municipalityId: input.binding.municipalityId,
    sourceCaseId: input.binding.sourceCaseId,
    caseId: input.binding.canonicalCaseId,
    citizenPubkey: input.sourceDiscussion.pubkey,
    title,
    summary,
  };
  const draft: PublicMeckySuggestionDraftV1 = {
    schemaVersion: "public_mecky_suggestion_draft_v1",
    draftId: `urn:stadtstack:suggestion-draft:${digest(draftCore).slice("sha256:".length)}`,
    ...draftCore,
    entryState: "citizen_signature_required",
    authorityBinding: "none",
    submittedToCivicWorkflow: false,
  };
  const event = buildNoteEvent(secretKey, JSON.stringify(draft), {
    createdAt: input.createdAt,
    tags: [
      ["schema", "citizen_signed_suggestion_v1"],
      ["municipality", draft.municipalityId],
      ["case", draft.sourceCaseId],
      ["e", draft.sourceDiscussionId, "", "root"],
      ["mecky-receipt", draft.sourceAnswerReceiptId],
    ],
  });
  return {
    schemaVersion: "citizen_signed_suggestion_v1",
    candidateId: `urn:stadtstack:signed-suggestion:${event.id}`,
    signerPubkey: event.pubkey,
    draft,
    event: {
      id: event.id,
      pubkey: event.pubkey,
      createdAt: event.created_at,
      kind: 1,
      tags: event.tags.map((tag) => [...tag]),
      content: event.content,
      signature: event.sig,
    },
    verification: { kind: "nostr_nip01", verified: true },
    entryState: "awaiting_human_case_admission",
    authorityBinding: "none",
    submittedToCivicWorkflow: false,
  };
}

/**
 * Sign a proposal candidate while the journey is still topic-bound.
 *
 * A CivicCase deliberately does not exist here. The event can be admitted by
 * a later human-owned transition, but this function cannot create or submit
 * that case on the citizen's behalf.
 */
export function buildCitizenSignedTopicSuggestion(
  secretKey: Uint8Array,
  input: CitizenSignedTopicSuggestionInput
): CitizenSignedTopicSuggestionV1 {
  const citizenPubkey = getPublicKeyHex(secretKey);
  const receiptId = validateTopicSuggestionSources(input, citizenPubkey);
  const { title, summary } = normalizedSuggestionContent(input);
  if (
    !Number.isSafeInteger(input.createdAt) ||
    input.createdAt <= input.sourceDiscussion.created_at ||
    input.createdAt <= input.sourceAnswer.created_at
  ) {
    throw new Error("civic_suggestion_timestamp_invalid");
  }
  const draft = topicSuggestionDraft({
    binding: input.binding,
    citizenPubkey,
    receiptId,
    sourceDiscussionId: input.sourceDiscussion.id,
    title,
    summary,
  });
  const event = buildNoteEvent(secretKey, JSON.stringify(draft), {
    createdAt: input.createdAt,
    tags: [
      ["schema", "citizen_signed_topic_suggestion_v1"],
      ["municipality", draft.municipalityId],
      ["topic", draft.topicId],
      ["e", draft.sourceDiscussionId, "", "root"],
      ["mecky-receipt", draft.sourceAnswerReceiptId],
    ],
  });
  return topicSuggestionCandidate(event, draft);
}

/**
 * Independently verify a signed topic proposal at the publication seam.
 *
 * Callers supply the already verified source discussion and Mecky answer. The
 * result is reconstructed from those sources, so untrusted JSON inside the
 * candidate cannot add authority, a different topic, or a hidden CivicCase.
 */
export function verifyCitizenSignedTopicSuggestion(
  input: VerifyCitizenSignedTopicSuggestionInput
): CitizenSignedTopicSuggestionV1 {
  if (
    !verifyEvent(input.event) ||
    input.event.kind !== 1 ||
    input.event.pubkey !== input.sourceDiscussion.pubkey
  ) {
    throw new Error("civic_topic_suggestion_event_invalid");
  }
  const receiptId = validateTopicSuggestionSources(
    input,
    input.event.pubkey
  );
  if (
    input.event.created_at <= input.sourceDiscussion.created_at ||
    input.event.created_at <= input.sourceAnswer.created_at
  ) {
    throw new Error("civic_suggestion_timestamp_invalid");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(input.event.content) as unknown;
  } catch {
    throw new Error("civic_topic_suggestion_draft_invalid");
  }
  const keys = [
    "schemaVersion",
    "draftId",
    "sourceAnswerReceiptId",
    "sourceDiscussionId",
    "sourceDiscussionRef",
    "municipalityId",
    "topicId",
    "citizenPubkey",
    "title",
    "summary",
    "entryState",
    "authorityBinding",
    "submittedToCivicWorkflow",
  ] as const;
  if (
    !exactRecord(parsed, keys) ||
    parsed.schemaVersion !== "public_mecky_topic_suggestion_draft_v1" ||
    typeof parsed.title !== "string" ||
    typeof parsed.summary !== "string" ||
    parsed.entryState !== "citizen_signature_required" ||
    parsed.authorityBinding !== "none" ||
    parsed.submittedToCivicWorkflow !== false
  ) {
    throw new Error("civic_topic_suggestion_draft_invalid");
  }
  const { title, summary } = normalizedSuggestionContent({
    title: parsed.title,
    summary: parsed.summary,
  });
  const expectedDraft = topicSuggestionDraft({
    binding: input.binding,
    citizenPubkey: input.event.pubkey,
    receiptId,
    sourceDiscussionId: input.sourceDiscussion.id,
    title,
    summary,
  });
  const expectedTags = [
    ["schema", "citizen_signed_topic_suggestion_v1"],
    ["municipality", expectedDraft.municipalityId],
    ["topic", expectedDraft.topicId],
    ["e", expectedDraft.sourceDiscussionId, "", "root"],
    ["mecky-receipt", expectedDraft.sourceAnswerReceiptId],
  ];
  if (
    canonical(parsed) !== canonical(expectedDraft) ||
    canonical(input.event.tags) !== canonical(expectedTags)
  ) {
    throw new Error("civic_topic_suggestion_draft_invalid");
  }
  return topicSuggestionCandidate(input.event, expectedDraft);
}
