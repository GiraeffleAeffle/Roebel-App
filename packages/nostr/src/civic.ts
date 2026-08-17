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

export type CivicTopicPromotionInput = CivicTopicBinding & {
  sourcePost: NostrEvent;
  topicTitle: string;
  agentPubkey: string;
  content: string;
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

const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const PUBKEY = /^[0-9a-f]{64}$/;
const UUID_V7 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

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
      ["t", "stadtstack-civic-discussion"],
      ["municipality", input.municipalityId],
      ["topic", input.topicId],
      ["topic-title", input.topicTitle],
      ["stance", "root"],
      ["argument-root", "self"],
    ],
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
