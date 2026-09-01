import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";

import { buildNoteEvent, verifyEvent, type NostrEvent } from "./events";
import { verifyAppConversationExchange } from "./conversation";
import { getPublicKeyHex } from "./keys";

const MAX_EVIDENCE_URL_CHARACTERS = 2_048;
const MAX_AGENT_TAG_CHARACTERS = 120;

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

/**
 * A participant suggestion is deliberately not a citizen suggestion. It is a
 * signed, topic-bound hand-off that still requires a separately verified
 * citizen adoption before it can enter the civic workflow.
 */
export type PublicParticipantTopicSuggestionDraftV1 = {
  schemaVersion: "public_participant_topic_suggestion_draft_v1";
  draftId: string;
  sourceAnswerId: string;
  sourceAnswerRef: string;
  sourceAnswerReceiptId: string;
  sourceDiscussionId: string;
  sourceDiscussionRef: string;
  municipalityId: string;
  topicId: string;
  participantPubkey: string;
  title: string;
  summary: string;
  entryState: "citizen_adoption_required";
  authorityBinding: "none";
  submittedToCivicWorkflow: false;
};

export type ParticipantTopicSuggestionV1 = {
  schemaVersion: "staging_participant_signed_topic_suggestion_v1";
  suggestionId: string;
  /** Compatibility identifier for callers that consume signed candidates. */
  candidateId: string;
  signerPubkey: string;
  draft: PublicParticipantTopicSuggestionDraftV1;
  event: NostrEvent;
  verification: { kind: "nostr_nip01"; verified: true };
  entryState: "citizen_adoption_required";
  authorityBinding: "none";
  submittedToCivicWorkflow: false;
};

export type ParticipantTopicSuggestionInput = {
  binding: CivicTopicBinding;
  sourcePost: NostrEvent;
  sourceDiscussion: NostrEvent;
  sourceAnswer: NostrEvent;
  conversationWitnesses?: CivicConversationWitnesses;
  agentPubkey: string;
  title: string;
  summary: string;
  createdAt: number;
};

export type CivicConversationWitnesses = {
  /** Deployment-pinned Nostr `t` value for the source app conversation. */
  conversationTopic: string;
  mentionEvent: NostrEvent;
  replyEvent: NostrEvent;
};

export type VerifyParticipantTopicSuggestionInput = Omit<
  ParticipantTopicSuggestionInput,
  "title" | "summary" | "createdAt"
> & {
  event: NostrEvent;
};

/**
 * Public-safe municipal receipt defined by ADR 0023. The issuer proof is
 * verified by the deployment-pinned policy below; neither a wallet nor a
 * residency record is ever carried by this public envelope.
 */
export type MunicipalCivicEligibilityReceiptV1 = {
  schemaVersion: "municipal_civic_eligibility_receipt_v1";
  eligibilityCore: {
    municipalityId: string;
    eligibilityClass: "municipal_civic_participation";
    subjectPubkey: string;
    participantSuggestionId: string;
    topicId: string;
    policyVersion: string;
    issuer: string;
    issuedAt: number;
    expiresAt: number;
    authorityBinding: "civic_eligibility_only";
  };
  receiptId: string;
  payloadChecksum: string;
  statusRef: string;
  proof: {
    algorithm: string;
    keyId: string;
    signature: string;
  };
};

export type MunicipalCivicEligibilityReceiptProofInputV1 = {
  domain: "municipal-civic-eligibility-receipt/v1";
  schemaVersion: "municipal_civic_eligibility_receipt_v1";
  receiptId: string;
  payloadChecksum: string;
  statusRef: string;
};

/**
 * This is deployment configuration, not an event payload. The gateway must
 * obtain it from its reviewed municipality policy, never from browser input.
 */
export type MunicipalCivicEligibilityPolicyV1 = {
  municipalityId: string;
  policyVersion: string;
  issuer: string;
  statusBaseUrl: string;
  verifiedAt: number;
  verifyReceiptProof: (
    input: MunicipalCivicEligibilityReceiptProofInputV1,
    proof: MunicipalCivicEligibilityReceiptV1["proof"]
  ) => boolean;
};

export type PublicCitizenTopicSuggestionAdoptionV1 = {
  schemaVersion: "public_citizen_topic_suggestion_adoption_v1";
  adoptionId: string;
  municipalityId: string;
  topicId: string;
  participantSuggestionId: string;
  participantSuggestionRef: string;
  participantPubkey: string;
  sourceDiscussionId: string;
  sourceAnswerReceiptId: string;
  adopterPubkey: string;
  eligibilityReceiptId: string;
  eligibilityReceiptChecksum: string;
  title: string;
  summary: string;
  entryState: "case_steward_review_required";
  authorityBinding: "civic_eligibility_only";
  submittedToCivicWorkflow: false;
};

export type CitizenTopicSuggestionAdoptionV1 = {
  schemaVersion: "citizen_adopted_topic_suggestion_v1";
  adoptionId: string;
  signerPubkey: string;
  participantSuggestionId: string;
  eligibilityReceiptId: string;
  adoption: PublicCitizenTopicSuggestionAdoptionV1;
  event: NostrEvent;
  verification: { kind: "nostr_nip01"; verified: true };
  entryState: "case_steward_review_required";
  authorityBinding: "civic_eligibility_only";
  submittedToCivicWorkflow: false;
};

export type CitizenTopicSuggestionAdoptionInput = {
  participantSuggestion: ParticipantTopicSuggestionV1;
  eligibilityReceipt: MunicipalCivicEligibilityReceiptV1;
  eligibilityPolicy: MunicipalCivicEligibilityPolicyV1;
  createdAt: number;
};

export type VerifyCitizenTopicSuggestionAdoptionInput = Omit<
  CitizenTopicSuggestionAdoptionInput,
  "createdAt"
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

const NOSTR_EVENT_KEYS = [
  "id",
  "pubkey",
  "created_at",
  "kind",
  "tags",
  "content",
  "sig",
] as const;

/**
 * Snapshot an untrusted closed record without invoking property accessors.
 * A Proxy may participate only by yielding this one plain data snapshot; no
 * later validation reads through the original object again.
 */
function snapshotClosedDataRecord(
  value: unknown,
  keys: readonly string[]
): Record<string, unknown> | null {
  try {
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype
    ) {
      return null;
    }
    const ownKeys = Reflect.ownKeys(value);
    if (
      ownKeys.length !== keys.length ||
      !ownKeys.every((key) => typeof key === "string" && keys.includes(key))
    ) {
      return null;
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const snapshot: Record<string, unknown> = {};
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        return null;
      }
      Object.defineProperty(snapshot, key, {
        value: descriptor.value,
        enumerable: true,
        writable: false,
        configurable: false,
      });
    }
    return Object.freeze(snapshot);
  } catch {
    return null;
  }
}

function snapshotStringArray(value: unknown): string[] | null {
  try {
    if (!Array.isArray(value)) return null;
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
    if (
      !lengthDescriptor ||
      !("value" in lengthDescriptor) ||
      !Number.isSafeInteger(lengthDescriptor.value) ||
      lengthDescriptor.value < 0
    ) {
      return null;
    }
    const length = lengthDescriptor.value;
    const ownKeys = Reflect.ownKeys(value);
    if (
      ownKeys.length !== length + 1 ||
      !ownKeys.includes("length") ||
      !ownKeys
        .filter((key) => key !== "length")
        .every((key) => typeof key === "string" && /^(0|[1-9][0-9]*)$/.test(key))
    ) {
      return null;
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const snapshot: string[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (
        !descriptor ||
        !("value" in descriptor) ||
        !descriptor.enumerable ||
        typeof descriptor.value !== "string"
      ) {
        return null;
      }
      snapshot.push(descriptor.value);
    }
    return Object.freeze(snapshot) as string[];
  } catch {
    return null;
  }
}

function snapshotNostrEvent(value: unknown): NostrEvent | null {
  const record = snapshotClosedDataRecord(value, NOSTR_EVENT_KEYS);
  if (
    !record ||
    typeof record.id !== "string" ||
    typeof record.pubkey !== "string" ||
    typeof record.created_at !== "number" ||
    !Number.isSafeInteger(record.created_at) ||
    typeof record.kind !== "number" ||
    !Number.isSafeInteger(record.kind) ||
    typeof record.content !== "string" ||
    typeof record.sig !== "string" ||
    !Array.isArray(record.tags)
  ) {
    return null;
  }
  try {
    const outerKeys = Reflect.ownKeys(record.tags);
    const lengthDescriptor = Object.getOwnPropertyDescriptor(record.tags, "length");
    if (
      !lengthDescriptor ||
      !("value" in lengthDescriptor) ||
      !Number.isSafeInteger(lengthDescriptor.value) ||
      lengthDescriptor.value < 0 ||
      outerKeys.length !== lengthDescriptor.value + 1 ||
      !outerKeys.includes("length")
    ) {
      return null;
    }
    const descriptors = Object.getOwnPropertyDescriptors(record.tags);
    const tags: string[][] = [];
    for (let index = 0; index < lengthDescriptor.value; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        return null;
      }
      const tag = snapshotStringArray(descriptor.value);
      if (!tag) return null;
      tags.push(tag);
    }
    return cloneAndFreezeNostrEvent({
      id: record.id,
      pubkey: record.pubkey,
      created_at: record.created_at,
      kind: record.kind,
      tags,
      content: record.content,
      sig: record.sig,
    });
  } catch {
    return null;
  }
}

function exactNostrEvent(value: unknown): value is NostrEvent {
  if (!exactRecord(value, NOSTR_EVENT_KEYS)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.pubkey === "string" &&
    Number.isSafeInteger(value.created_at) &&
    Number.isSafeInteger(value.kind) &&
    Array.isArray(value.tags) &&
    value.tags.every(
      (tag) =>
        Array.isArray(tag) &&
        tag.every((part) => typeof part === "string")
    ) &&
    typeof value.content === "string" &&
    typeof value.sig === "string"
  );
}

function cloneAndFreezeNostrEvent(event: NostrEvent): NostrEvent {
  const clone: NostrEvent = {
    id: event.id,
    pubkey: event.pubkey,
    created_at: event.created_at,
    kind: event.kind,
    tags: event.tags.map((tag) => [...tag]),
    content: event.content,
    sig: event.sig,
  };
  for (const tag of clone.tags) Object.freeze(tag);
  Object.freeze(clone.tags);
  return Object.freeze(clone) as NostrEvent;
}

function freezeParticipantDraft(
  draft: PublicParticipantTopicSuggestionDraftV1
): PublicParticipantTopicSuggestionDraftV1 {
  return Object.freeze({ ...draft }) as PublicParticipantTopicSuggestionDraftV1;
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
    return isSafeHttpsUrl(tag[2] ?? "");
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

function participantTopicSuggestionCandidate(
  event: NostrEvent,
  draft: PublicParticipantTopicSuggestionDraftV1
): ParticipantTopicSuggestionV1 {
  const sanitizedEvent = cloneAndFreezeNostrEvent(event);
  const sanitizedDraft = freezeParticipantDraft(draft);
  return Object.freeze({
    schemaVersion: "staging_participant_signed_topic_suggestion_v1",
    suggestionId: sanitizedEvent.id,
    candidateId: `urn:stadtstack:participant-topic-suggestion:${sanitizedEvent.id}`,
    signerPubkey: sanitizedEvent.pubkey,
    draft: sanitizedDraft,
    event: sanitizedEvent,
    verification: Object.freeze({ kind: "nostr_nip01", verified: true }),
    entryState: "citizen_adoption_required",
    authorityBinding: "none",
    submittedToCivicWorkflow: false,
  });
}

function freezeCitizenTopicSuggestionAdoption(
  adoption: PublicCitizenTopicSuggestionAdoptionV1
): PublicCitizenTopicSuggestionAdoptionV1 {
  return Object.freeze({ ...adoption }) as PublicCitizenTopicSuggestionAdoptionV1;
}

function invalidCitizenAdoption(error: string): never {
  throw new Error(error);
}

function participantSuggestionForAdoption(
  value: unknown
): ParticipantTopicSuggestionV1 {
  const candidateKeys = [
    "schemaVersion",
    "suggestionId",
    "candidateId",
    "signerPubkey",
    "draft",
    "event",
    "verification",
    "entryState",
    "authorityBinding",
    "submittedToCivicWorkflow",
  ] as const;
  const draftKeys = [
    "schemaVersion",
    "draftId",
    "sourceAnswerId",
    "sourceAnswerRef",
    "sourceAnswerReceiptId",
    "sourceDiscussionId",
    "sourceDiscussionRef",
    "municipalityId",
    "topicId",
    "participantPubkey",
    "title",
    "summary",
    "entryState",
    "authorityBinding",
    "submittedToCivicWorkflow",
  ] as const;
  const candidateRecord = snapshotClosedDataRecord(value, candidateKeys);
  const draftRecord = candidateRecord
    ? snapshotClosedDataRecord(candidateRecord.draft, draftKeys)
    : null;
  const verificationRecord = candidateRecord
    ? snapshotClosedDataRecord(candidateRecord.verification, ["kind", "verified"])
    : null;
  const event = candidateRecord ? snapshotNostrEvent(candidateRecord.event) : null;
  if (!candidateRecord || !draftRecord || !verificationRecord || !event) {
    invalidCitizenAdoption("civic_participant_suggestion_invalid");
  }
  const candidate = {
    schemaVersion: candidateRecord.schemaVersion,
    suggestionId: candidateRecord.suggestionId,
    candidateId: candidateRecord.candidateId,
    signerPubkey: candidateRecord.signerPubkey,
    draft: draftRecord,
    event,
    verification: verificationRecord,
    entryState: candidateRecord.entryState,
    authorityBinding: candidateRecord.authorityBinding,
    submittedToCivicWorkflow: candidateRecord.submittedToCivicWorkflow,
  } as ParticipantTopicSuggestionV1;
  const topicMatch = TOPIC_ID.exec(candidate.draft.topicId);
  if (
    candidate.schemaVersion !== "staging_participant_signed_topic_suggestion_v1" ||
    candidate.suggestionId !== candidate.event.id ||
    candidate.candidateId !==
      `urn:stadtstack:participant-topic-suggestion:${candidate.event.id}` ||
    candidate.signerPubkey !== candidate.event.pubkey ||
    !PUBKEY.test(candidate.signerPubkey) ||
    candidate.verification.kind !== "nostr_nip01" ||
    candidate.verification.verified !== true ||
    candidate.entryState !== "citizen_adoption_required" ||
    candidate.authorityBinding !== "none" ||
    candidate.submittedToCivicWorkflow !== false ||
    !verifyEvent(candidate.event) ||
    candidate.event.kind !== 1 ||
    candidate.event.created_at < 0 ||
    candidate.draft.schemaVersion !==
      "public_participant_topic_suggestion_draft_v1" ||
    candidate.draft.participantPubkey !== candidate.signerPubkey ||
    !PUBKEY.test(candidate.draft.participantPubkey) ||
    !SLUG.test(candidate.draft.municipalityId) ||
    !topicMatch ||
    topicMatch[1] !== candidate.draft.municipalityId ||
    !NOSTR_EVENT_ID.test(candidate.draft.sourceAnswerId) ||
    candidate.draft.sourceAnswerRef !== `nostr://event/${candidate.draft.sourceAnswerId}` ||
    !NOSTR_EVENT_ID.test(candidate.draft.sourceDiscussionId) ||
    candidate.draft.sourceDiscussionRef !==
      `nostr://event/${candidate.draft.sourceDiscussionId}` ||
    !MECKY_RECEIPT.test(candidate.draft.sourceAnswerReceiptId) ||
    candidate.draft.entryState !== "citizen_adoption_required" ||
    candidate.draft.authorityBinding !== "none" ||
    candidate.draft.submittedToCivicWorkflow !== false ||
    typeof candidate.draft.title !== "string" ||
    typeof candidate.draft.summary !== "string"
  ) {
    invalidCitizenAdoption("civic_participant_suggestion_invalid");
  }
  const { title, summary } = normalizedSuggestionContent(candidate.draft);
  const draftCore = {
    sourceAnswerId: candidate.draft.sourceAnswerId,
    sourceAnswerRef: candidate.draft.sourceAnswerRef,
    sourceAnswerReceiptId: candidate.draft.sourceAnswerReceiptId,
    sourceDiscussionId: candidate.draft.sourceDiscussionId,
    sourceDiscussionRef: candidate.draft.sourceDiscussionRef,
    municipalityId: candidate.draft.municipalityId,
    topicId: candidate.draft.topicId,
    participantPubkey: candidate.draft.participantPubkey,
    title,
    summary,
  };
  const expectedDraft: PublicParticipantTopicSuggestionDraftV1 = {
    schemaVersion: "public_participant_topic_suggestion_draft_v1",
    draftId: `urn:stadtstack:participant-topic-suggestion-draft:${digest(draftCore).slice("sha256:".length)}`,
    ...draftCore,
    entryState: "citizen_adoption_required",
    authorityBinding: "none",
    submittedToCivicWorkflow: false,
  };
  const expectedTags = [
    ["schema", "staging_participant_signed_topic_suggestion_v1"],
    ["municipality", expectedDraft.municipalityId],
    ["topic", expectedDraft.topicId],
    ["e", expectedDraft.sourceDiscussionId, "", "root"],
    ["mecky-receipt", expectedDraft.sourceAnswerReceiptId],
    ["credential-class", "staging-participant"],
  ];
  if (
    canonical(candidate.draft) !== canonical(expectedDraft) ||
    canonical(candidate.event.tags) !== canonical(expectedTags) ||
    candidate.event.content !== canonical(expectedDraft)
  ) {
    invalidCitizenAdoption("civic_participant_suggestion_invalid");
  }
  return participantTopicSuggestionCandidate(candidate.event, expectedDraft);
}

/**
 * Verify the self-contained ADR-0022 participant envelope before an issuer
 * spends private eligibility checks on it. Source/Mecky provenance was checked
 * when the gateway published this immutable suggestion; this guard rechecks
 * its closed draft, signature, tags and internal hashes without relabelling it.
 */
export function verifyParticipantTopicSuggestionForAdoption(
  value: unknown,
): ParticipantTopicSuggestionV1 {
  return participantSuggestionForAdoption(value);
}

function eligibilityReceiptForAdoption(input: {
  receipt: unknown;
  policy: MunicipalCivicEligibilityPolicyV1;
  participantSuggestion: ParticipantTopicSuggestionV1;
  adopterPubkey: string;
}): MunicipalCivicEligibilityReceiptV1 {
  const receiptKeys = [
    "schemaVersion",
    "eligibilityCore",
    "receiptId",
    "payloadChecksum",
    "statusRef",
    "proof",
  ] as const;
  const coreKeys = [
    "municipalityId",
    "eligibilityClass",
    "subjectPubkey",
    "participantSuggestionId",
    "topicId",
    "policyVersion",
    "issuer",
    "issuedAt",
    "expiresAt",
    "authorityBinding",
  ] as const;
  const proofKeys = ["algorithm", "keyId", "signature"] as const;
  const { receipt, policy, participantSuggestion, adopterPubkey } = input;
  const receiptRecord = snapshotClosedDataRecord(receipt, receiptKeys);
  const coreRecord = receiptRecord
    ? snapshotClosedDataRecord(receiptRecord.eligibilityCore, coreKeys)
    : null;
  const proofRecord = receiptRecord
    ? snapshotClosedDataRecord(receiptRecord.proof, proofKeys)
    : null;
  if (!receiptRecord || !coreRecord || !proofRecord) {
    invalidCitizenAdoption("civic_eligibility_receipt_invalid");
  }
  const suppliedReceipt = {
    schemaVersion: receiptRecord.schemaVersion,
    eligibilityCore: coreRecord,
    receiptId: receiptRecord.receiptId,
    payloadChecksum: receiptRecord.payloadChecksum,
    statusRef: receiptRecord.statusRef,
    proof: proofRecord,
  } as MunicipalCivicEligibilityReceiptV1;
  if (
    !exactRecord(policy, [
      "municipalityId",
      "policyVersion",
      "issuer",
      "statusBaseUrl",
      "verifiedAt",
      "verifyReceiptProof",
    ]) ||
    !SLUG.test(policy.municipalityId) ||
    typeof policy.policyVersion !== "string" ||
    policy.policyVersion.length === 0 ||
    typeof policy.issuer !== "string" ||
    policy.issuer.length === 0 ||
    typeof policy.statusBaseUrl !== "string" ||
    !isExactHttpsStatusBaseUrl(policy.statusBaseUrl) ||
    !Number.isSafeInteger(policy.verifiedAt) ||
    policy.verifiedAt < 0 ||
    typeof policy.verifyReceiptProof !== "function" ||
    suppliedReceipt.schemaVersion !== "municipal_civic_eligibility_receipt_v1" ||
    suppliedReceipt.eligibilityCore.municipalityId !== policy.municipalityId ||
    suppliedReceipt.eligibilityCore.municipalityId !==
      participantSuggestion.draft.municipalityId ||
    suppliedReceipt.eligibilityCore.eligibilityClass !==
      "municipal_civic_participation" ||
    suppliedReceipt.eligibilityCore.subjectPubkey !== adopterPubkey ||
    suppliedReceipt.eligibilityCore.participantSuggestionId !==
      participantSuggestion.suggestionId ||
    suppliedReceipt.eligibilityCore.topicId !== participantSuggestion.draft.topicId ||
    suppliedReceipt.eligibilityCore.policyVersion !== policy.policyVersion ||
    suppliedReceipt.eligibilityCore.issuer !== policy.issuer ||
    !Number.isSafeInteger(suppliedReceipt.eligibilityCore.issuedAt) ||
    !Number.isSafeInteger(suppliedReceipt.eligibilityCore.expiresAt) ||
    suppliedReceipt.eligibilityCore.issuedAt < 0 ||
    suppliedReceipt.eligibilityCore.issuedAt > policy.verifiedAt ||
    policy.verifiedAt >= suppliedReceipt.eligibilityCore.expiresAt ||
    suppliedReceipt.eligibilityCore.authorityBinding !== "civic_eligibility_only" ||
    !/^[0-9a-f]{64}$/.test(suppliedReceipt.payloadChecksum) ||
    suppliedReceipt.payloadChecksum !== digest(suppliedReceipt.eligibilityCore).slice("sha256:".length) ||
    suppliedReceipt.receiptId !==
      `urn:stadtstack:municipal-civic-eligibility-receipt:${suppliedReceipt.payloadChecksum}` ||
    suppliedReceipt.statusRef !== `${policy.statusBaseUrl}/${suppliedReceipt.payloadChecksum}` ||
    typeof suppliedReceipt.proof.algorithm !== "string" ||
    suppliedReceipt.proof.algorithm.length === 0 ||
    suppliedReceipt.proof.algorithm !== suppliedReceipt.proof.algorithm.trim() ||
    typeof suppliedReceipt.proof.keyId !== "string" ||
    suppliedReceipt.proof.keyId.length === 0 ||
    suppliedReceipt.proof.keyId !== suppliedReceipt.proof.keyId.trim() ||
    typeof suppliedReceipt.proof.signature !== "string" ||
    !/^[A-Za-z0-9_-]+$/.test(suppliedReceipt.proof.signature)
  ) {
    invalidCitizenAdoption("civic_eligibility_receipt_invalid");
  }
  const sanitizedReceipt = Object.freeze({
    schemaVersion: suppliedReceipt.schemaVersion,
    eligibilityCore: Object.freeze({ ...suppliedReceipt.eligibilityCore }),
    receiptId: suppliedReceipt.receiptId,
    payloadChecksum: suppliedReceipt.payloadChecksum,
    statusRef: suppliedReceipt.statusRef,
    proof: Object.freeze({ ...suppliedReceipt.proof }),
  }) as MunicipalCivicEligibilityReceiptV1;
  const proofInput: MunicipalCivicEligibilityReceiptProofInputV1 = Object.freeze({
    domain: "municipal-civic-eligibility-receipt/v1",
    schemaVersion: "municipal_civic_eligibility_receipt_v1",
    receiptId: sanitizedReceipt.receiptId,
    payloadChecksum: sanitizedReceipt.payloadChecksum,
    statusRef: sanitizedReceipt.statusRef,
  });
  try {
    if (!policy.verifyReceiptProof(proofInput, sanitizedReceipt.proof)) {
      invalidCitizenAdoption("civic_eligibility_receipt_invalid");
    }
  } catch {
    invalidCitizenAdoption("civic_eligibility_receipt_invalid");
  }
  return sanitizedReceipt;
}

function citizenTopicSuggestionAdoption(
  event: NostrEvent,
  participantSuggestion: ParticipantTopicSuggestionV1,
  receipt: MunicipalCivicEligibilityReceiptV1
): CitizenTopicSuggestionAdoptionV1 {
  let parsed: unknown;
  try {
    parsed = JSON.parse(event.content) as unknown;
  } catch {
    invalidCitizenAdoption("civic_topic_suggestion_adoption_invalid");
  }
  const adoptionKeys = [
    "schemaVersion",
    "adoptionId",
    "municipalityId",
    "topicId",
    "participantSuggestionId",
    "participantSuggestionRef",
    "participantPubkey",
    "sourceDiscussionId",
    "sourceAnswerReceiptId",
    "adopterPubkey",
    "eligibilityReceiptId",
    "eligibilityReceiptChecksum",
    "title",
    "summary",
    "entryState",
    "authorityBinding",
    "submittedToCivicWorkflow",
  ] as const;
  const parsedAdoption = parsed as PublicCitizenTopicSuggestionAdoptionV1;
  if (
    !exactRecord(parsed, adoptionKeys) ||
    typeof parsedAdoption.title !== "string" ||
    typeof parsedAdoption.summary !== "string"
  ) {
    invalidCitizenAdoption("civic_topic_suggestion_adoption_invalid");
  }
  const { title, summary } = normalizedSuggestionContent(
    participantSuggestion.draft
  );
  const adoptionCore = {
    municipalityId: participantSuggestion.draft.municipalityId,
    topicId: participantSuggestion.draft.topicId,
    participantSuggestionId: participantSuggestion.suggestionId,
    participantSuggestionRef: `nostr://event/${participantSuggestion.suggestionId}`,
    participantPubkey: participantSuggestion.signerPubkey,
    sourceDiscussionId: participantSuggestion.draft.sourceDiscussionId,
    sourceAnswerReceiptId: participantSuggestion.draft.sourceAnswerReceiptId,
    adopterPubkey: event.pubkey,
    eligibilityReceiptId: receipt.receiptId,
    eligibilityReceiptChecksum: receipt.payloadChecksum,
    title,
    summary,
  };
  const expected: PublicCitizenTopicSuggestionAdoptionV1 = {
    schemaVersion: "public_citizen_topic_suggestion_adoption_v1",
    adoptionId: `urn:stadtstack:citizen-topic-suggestion-adoption:${digest(adoptionCore).slice("sha256:".length)}`,
    ...adoptionCore,
    entryState: "case_steward_review_required",
    authorityBinding: "civic_eligibility_only",
    submittedToCivicWorkflow: false,
  };
  const expectedTags = [
    ["schema", "citizen_adopted_topic_suggestion_v1"],
    ["municipality", expected.municipalityId],
    ["topic", expected.topicId],
    ["e", expected.participantSuggestionId, "", "adopted-suggestion"],
    ["e", expected.sourceDiscussionId, "", "root"],
    ["p", expected.participantPubkey],
    ["eligibility-receipt", expected.eligibilityReceiptId],
    ["credential-class", "municipal-civic-eligibility"],
  ];
  if (
    canonical(parsed) !== canonical(expected) ||
    event.content !== canonical(expected) ||
    canonical(event.tags) !== canonical(expectedTags)
  ) {
    invalidCitizenAdoption("civic_topic_suggestion_adoption_invalid");
  }
  const sanitizedEvent = cloneAndFreezeNostrEvent(event);
  const sanitizedAdoption = freezeCitizenTopicSuggestionAdoption(expected);
  return Object.freeze({
    schemaVersion: "citizen_adopted_topic_suggestion_v1",
    adoptionId: sanitizedAdoption.adoptionId,
    signerPubkey: sanitizedEvent.pubkey,
    participantSuggestionId: participantSuggestion.suggestionId,
    eligibilityReceiptId: receipt.receiptId,
    adoption: sanitizedAdoption,
    event: sanitizedEvent,
    verification: Object.freeze({ kind: "nostr_nip01", verified: true }),
    entryState: "case_steward_review_required",
    authorityBinding: "civic_eligibility_only",
    submittedToCivicWorkflow: false,
  });
}

function exactTag(
  tags: readonly string[][],
  index: number,
  name: string,
  length: number
): string[] | null {
  const tag = tags[index];
  return tag && tag[0] === name && tag.length === length ? tag : null;
}

function exactSingleTag(
  tags: readonly string[][],
  name: string,
  length: number
): string[] | null {
  const matches = tags.filter((tag) => tag[0] === name);
  return matches.length === 1 && matches[0]!.length === length
    ? matches[0]!
    : null;
}

function rejectParticipantProtocol(error: string): never {
  throw new Error(error);
}

function validateParticipantConversationWitnesses(input: {
  binding: CivicTopicBinding;
  sourcePost: NostrEvent;
  sourceDiscussion: NostrEvent;
  promotion: Readonly<{
    topicId: string;
    topicTitle: string;
    conversationSource?: CivicSelectedConversationSource;
  }>;
  agentPubkey: string;
  witnesses: CivicConversationWitnesses;
}): void {
  const selected = input.promotion.conversationSource;
  if (!selected) rejectParticipantProtocol("civic_topic_suggestion_conversation_invalid");
  if (
    !SLUG.test(input.witnesses.conversationTopic) ||
    !exactNostrEvent(input.witnesses.mentionEvent) ||
    !exactNostrEvent(input.witnesses.replyEvent)
  ) {
    rejectParticipantProtocol("civic_topic_suggestion_conversation_invalid");
  }
  const sourcePostTag = exactSingleTag(input.sourcePost.tags, "source-app-post", 2);
  const expectedMentionTags = [
    ["p", input.agentPubkey],
    ["source-app-post", selected.sourceAppPostId],
    ...(selected.sourceAppCommentId === undefined
      ? []
      : [["source-app-comment", selected.sourceAppCommentId]]),
    ["t", input.witnesses.conversationTopic],
  ];
  if (
    input.sourcePost.id !== input.witnesses.mentionEvent.id ||
    !sourcePostTag ||
    sourcePostTag[1] !== selected.sourceAppPostId ||
    !verifyEvent(input.witnesses.mentionEvent) ||
    input.witnesses.mentionEvent.kind !== 1 ||
    input.witnesses.mentionEvent.content !==
      input.witnesses.mentionEvent.content.trim() ||
    input.witnesses.mentionEvent.content.length === 0 ||
    input.witnesses.mentionEvent.content.length > 2_000 ||
    canonical(input.witnesses.mentionEvent.tags) !==
      canonical(expectedMentionTags) ||
    input.witnesses.mentionEvent.pubkey !== input.sourcePost.pubkey ||
    input.sourcePost.created_at > input.witnesses.mentionEvent.created_at ||
    input.witnesses.mentionEvent.id !== selected.mentionEventId
  ) {
    rejectParticipantProtocol("civic_topic_suggestion_conversation_invalid");
  }

  const reply = input.witnesses.replyEvent;
  const sharedExchange = verifyAppConversationExchange(
    input.witnesses.mentionEvent,
    reply,
    {
      agentPubkey: input.agentPubkey,
      sourceAppPostId: selected.sourceAppPostId,
      sourceAppCommentId: selected.sourceAppCommentId,
      conversationTopic: input.witnesses.conversationTopic,
      municipalityId: input.binding.municipalityId,
      topicId: input.binding.topicId,
    },
  );
  if (!exactNostrEvent(reply)) {
    rejectParticipantProtocol("civic_topic_suggestion_conversation_invalid");
  }
  const replyAgent = exactTag(reply.tags, 0, "netizen_agent", 3);
  const replyParent = exactTag(reply.tags, 1, "e", 4);
  const replyAuthor = exactTag(reply.tags, 2, "p", 2);
  const replySourcePost = exactTag(reply.tags, 3, "source-app-post", 2);
  let index = 4;
  const replySourceComment =
    selected.sourceAppCommentId === undefined
      ? null
      : exactTag(reply.tags, index++, "source-app-comment", 2);
  const expectedReceipt = selected.receiptId ?? null;
  const replyReceipt =
    expectedReceipt === null
      ? null
      : exactTag(reply.tags, index++, "mecky-receipt", 2);
  const replyMunicipality =
    reply.tags[index]?.[0] === "municipality"
      ? exactTag(reply.tags, index++, "municipality", 2)
      : null;
  const replyTopic =
    reply.tags[index]?.[0] === "topic"
      ? exactTag(reply.tags, index++, "topic", 2)
      : null;
  const evidence = reply.tags.slice(index);
  if (
    sharedExchange === null ||
    !verifyEvent(reply) ||
    reply.kind !== 1 ||
    !replyAgent ||
    !replyAgent[1] ||
    replyAgent[1] !== replyAgent[1].trim() ||
    replyAgent[1].length > MAX_AGENT_TAG_CHARACTERS ||
    !replyAgent[2] ||
    replyAgent[2] !== replyAgent[2].trim() ||
    replyAgent[2].length > MAX_AGENT_TAG_CHARACTERS ||
    !replyParent ||
    replyParent[1] !== input.witnesses.mentionEvent.id ||
    replyParent[2] !== "" ||
    replyParent[3] !== "reply" ||
    !replyAuthor ||
    replyAuthor[1] !== input.witnesses.mentionEvent.pubkey ||
    reply.pubkey !== input.agentPubkey ||
    !replySourcePost ||
    replySourcePost[1] !== selected.sourceAppPostId ||
    (selected.sourceAppCommentId !== undefined &&
      (!replySourceComment ||
        replySourceComment[1] !== selected.sourceAppCommentId)) ||
    (selected.sourceAppCommentId === undefined &&
      reply.tags.some((tag) => tag[0] === "source-app-comment")) ||
    (expectedReceipt !== null &&
      (!replyReceipt || replyReceipt[1] !== expectedReceipt)) ||
    (expectedReceipt === null && reply.tags.some((tag) => tag[0] === "mecky-receipt")) ||
    (replyMunicipality !== null &&
      replyMunicipality[1] !== input.binding.municipalityId) ||
    (replyTopic !== null && replyTopic[1] !== input.binding.topicId) ||
    (replyMunicipality === null) !== (replyTopic === null) ||
    evidence.some((tag) => tag[0] !== "evidence") ||
    evidence.length < 1 ||
    evidence.length > 3 ||
    evidence.some(
      (tag) =>
        tag.length !== 3 ||
        !/^sha256:[0-9a-f]{64}$/.test(tag[1] ?? "") ||
        !isSafeHttpsUrl(tag[2] ?? "")
    ) ||
    new Set(evidence.map((tag) => tag[1])).size !== evidence.length ||
    reply.content !== reply.content.trim() ||
    reply.content.length === 0 ||
    reply.content.length > 2_000 ||
    reply.created_at < 0 ||
    reply.created_at < input.witnesses.mentionEvent.created_at ||
    reply.created_at > input.sourceDiscussion.created_at ||
    reply.id !== selected.replyEventId ||
    reply.tags.filter((tag) => tag[0] === "mecky-receipt").length !==
      (expectedReceipt === null ? 0 : 1)
  ) {
    rejectParticipantProtocol("civic_topic_suggestion_conversation_invalid");
  }
}

function validateParticipantSources(
  input: Pick<
    ParticipantTopicSuggestionInput,
    | "binding"
    | "sourcePost"
    | "sourceDiscussion"
    | "conversationWitnesses"
    | "agentPubkey"
  >,
  participantPubkey: string
): string {
  validateTopicBinding(input.binding);
  if (
    !PUBKEY.test(input.agentPubkey) ||
    !exactNostrEvent(input.sourcePost) ||
    !exactNostrEvent(input.sourceDiscussion) ||
    input.sourcePost.created_at < 0 ||
    input.sourceDiscussion.created_at < 0 ||
    !verifyEvent(input.sourcePost) ||
    !verifyEvent(input.sourceDiscussion)
  ) {
    rejectParticipantProtocol("civic_topic_suggestion_discussion_invalid");
  }
  const promotion = verifyCivicTopicPromotionEvent({
    event: input.sourceDiscussion,
    sourcePost: input.sourcePost,
    municipalityId: input.binding.municipalityId,
    agentPubkey: input.agentPubkey,
  });
  if (
    !promotion ||
    promotion.topicId !== input.binding.topicId ||
    input.sourceDiscussion.pubkey !== participantPubkey
  ) {
    rejectParticipantProtocol("civic_topic_suggestion_discussion_invalid");
  }
  if (promotion.conversationSource) {
    const witnesses = input.conversationWitnesses;
    if (!witnesses) {
      rejectParticipantProtocol("civic_topic_suggestion_conversation_invalid");
    }
    validateParticipantConversationWitnesses({
      binding: input.binding,
      sourcePost: input.sourcePost,
      sourceDiscussion: input.sourceDiscussion,
      promotion,
      agentPubkey: input.agentPubkey,
      witnesses,
    });
  } else if (input.conversationWitnesses) {
    rejectParticipantProtocol("civic_topic_suggestion_conversation_invalid");
  }
  return input.sourceDiscussion.pubkey;
}

function isSafeHttpsUrl(value: string): boolean {
  if (
    value.length < 1 ||
    value.length > MAX_EVIDENCE_URL_CHARACTERS ||
    value !== value.trim() ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    return false;
  }
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

function isExactHttpsStatusBaseUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      !url.pathname.endsWith("/")
    );
  } catch {
    return false;
  }
}

function validateParticipantAnswer(
  sourceAnswer: NostrEvent,
  sourceDiscussion: NostrEvent,
  binding: CivicTopicBinding,
  agentPubkey: string,
  participantPubkey: string
): string {
  if (!exactNostrEvent(sourceAnswer) || !verifyEvent(sourceAnswer)) {
    rejectParticipantProtocol("civic_topic_suggestion_answer_invalid");
  }
  const agent = exactTag(sourceAnswer.tags, 0, "netizen_agent", 3);
  const parent = exactTag(sourceAnswer.tags, 1, "e", 4);
  const author = exactTag(sourceAnswer.tags, 2, "p", 2);
  const conversationSource = selectedConversationSourceFromTags(sourceDiscussion);
  let index = 3;
  const sourceAppPost =
    conversationSource === undefined
      ? null
      : exactTag(sourceAnswer.tags, index++, "source-app-post", 2);
  const sourceAppComment =
    conversationSource?.sourceAppCommentId === undefined
      ? null
      : exactTag(sourceAnswer.tags, index++, "source-app-comment", 2);
  const receipt = exactTag(sourceAnswer.tags, index++, "mecky-receipt", 2);
  const municipality = exactTag(sourceAnswer.tags, index++, "municipality", 2);
  const topic = exactTag(sourceAnswer.tags, index++, "topic", 2);
  const evidence = sourceAnswer.tags.slice(index);
  if (
    sourceAnswer.kind !== 1 ||
    sourceAnswer.pubkey !== agentPubkey ||
    !PUBKEY.test(agentPubkey) ||
    !PUBKEY.test(participantPubkey) ||
    !agent ||
    !agent[1] ||
    agent[1] !== agent[1].trim() ||
    agent[1].length > MAX_AGENT_TAG_CHARACTERS ||
    !agent[2] ||
    agent[2] !== agent[2].trim() ||
    agent[2].length > MAX_AGENT_TAG_CHARACTERS ||
    !parent ||
    parent[1] !== sourceDiscussion.id ||
    parent[2] !== "" ||
    parent[3] !== "reply" ||
    !author ||
    author[1] !== participantPubkey ||
    (conversationSource !== undefined &&
      (!sourceAppPost ||
        sourceAppPost[1] !== conversationSource.sourceAppPostId)) ||
    (conversationSource?.sourceAppCommentId !== undefined &&
      (!sourceAppComment ||
        sourceAppComment[1] !== conversationSource.sourceAppCommentId)) ||
    !receipt ||
    !MECKY_RECEIPT.test(receipt[1] ?? "") ||
    !municipality ||
    municipality[1] !== binding.municipalityId ||
    !topic ||
    topic[1] !== binding.topicId ||
    evidence.length < 1 ||
    evidence.length > 3 ||
    evidence.some(
      (tag) =>
        tag[0] !== "evidence" ||
        tag.length !== 3 ||
        !/^sha256:[0-9a-f]{64}$/.test(tag[1] ?? "") ||
        !isSafeHttpsUrl(tag[2] ?? "")
    ) ||
    new Set(evidence.map((tag) => tag[1])).size !== evidence.length ||
    sourceAnswer.content !== sourceAnswer.content.trim() ||
    sourceAnswer.content.length === 0 ||
    sourceAnswer.content.length > 2_000 ||
    sourceAnswer.created_at < 0 ||
    sourceAnswer.created_at < sourceDiscussion.created_at
  ) {
    rejectParticipantProtocol("civic_topic_suggestion_answer_invalid");
  }
  return receipt[1]!;
}

function participantTopicSuggestionDraft(input: {
  binding: CivicTopicBinding;
  participantPubkey: string;
  receiptId: string;
  sourceDiscussionId: string;
  sourceAnswerId: string;
  title: string;
  summary: string;
}): PublicParticipantTopicSuggestionDraftV1 {
  const draftCore = {
    sourceAnswerId: input.sourceAnswerId,
    sourceAnswerRef: `nostr://event/${input.sourceAnswerId}`,
    sourceAnswerReceiptId: input.receiptId,
    sourceDiscussionId: input.sourceDiscussionId,
    sourceDiscussionRef: `nostr://event/${input.sourceDiscussionId}`,
    municipalityId: input.binding.municipalityId,
    topicId: input.binding.topicId,
    participantPubkey: input.participantPubkey,
    title: input.title,
    summary: input.summary,
  };
  return {
    schemaVersion: "public_participant_topic_suggestion_draft_v1",
    draftId: `urn:stadtstack:participant-topic-suggestion-draft:${digest(draftCore).slice("sha256:".length)}`,
    ...draftCore,
    entryState: "citizen_adoption_required",
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
    if (!isSafeHttpsUrl(tag[2] ?? "")) {
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

/**
 * Sign the staging participant hand-off defined by ADR 0022.
 *
 * This is intentionally a separate protocol from
 * `buildCitizenSignedTopicSuggestion`: the participant has not presented a
 * civic eligibility credential, so the resulting event can only be adopted by
 * a later, independently verified citizen transition.
 */
export function buildParticipantTopicSuggestion(
  secretKey: Uint8Array,
  input: ParticipantTopicSuggestionInput
): ParticipantTopicSuggestionV1 {
  const participantPubkey = getPublicKeyHex(secretKey);
  validateParticipantSources(input, participantPubkey);
  const receiptId = validateParticipantAnswer(
    input.sourceAnswer,
    input.sourceDiscussion,
    input.binding,
    input.agentPubkey,
    participantPubkey
  );
  const { title, summary } = normalizedSuggestionContent(input);
  if (
    !Number.isSafeInteger(input.createdAt) ||
    input.createdAt <= input.sourceDiscussion.created_at ||
    input.createdAt <= input.sourceAnswer.created_at
  ) {
    throw new Error("civic_suggestion_timestamp_invalid");
  }
  const draft = participantTopicSuggestionDraft({
    binding: input.binding,
    participantPubkey,
    receiptId,
    sourceDiscussionId: input.sourceDiscussion.id,
    sourceAnswerId: input.sourceAnswer.id,
    title,
    summary,
  });
  const event = buildNoteEvent(secretKey, canonical(draft), {
    createdAt: input.createdAt,
    tags: [
      ["schema", "staging_participant_signed_topic_suggestion_v1"],
      ["municipality", draft.municipalityId],
      ["topic", draft.topicId],
      ["e", draft.sourceDiscussionId, "", "root"],
      ["mecky-receipt", draft.sourceAnswerReceiptId],
      ["credential-class", "staging-participant"],
    ],
  });
  return participantTopicSuggestionCandidate(event, draft);
}

/**
 * Verify and reconstruct a participant suggestion from its signed sources.
 * Duplicated JSON in the event is never trusted: the expected draft and exact
 * tag arrays are derived from the verified discussion and Mecky answer.
 */
export function verifyParticipantTopicSuggestion(
  input: VerifyParticipantTopicSuggestionInput
): ParticipantTopicSuggestionV1 {
  if (
    !exactNostrEvent(input.event) ||
    !verifyEvent(input.event) ||
    input.event.kind !== 1 ||
    input.event.pubkey !== input.sourceDiscussion.pubkey
  ) {
    throw new Error("civic_topic_suggestion_event_invalid");
  }
  const participantPubkey = validateParticipantSources(input, input.event.pubkey);
  const receiptId = validateParticipantAnswer(
    input.sourceAnswer,
    input.sourceDiscussion,
    input.binding,
    input.agentPubkey,
    participantPubkey
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
    "sourceAnswerId",
    "sourceAnswerRef",
    "sourceAnswerReceiptId",
    "sourceDiscussionId",
    "sourceDiscussionRef",
    "municipalityId",
    "topicId",
    "participantPubkey",
    "title",
    "summary",
    "entryState",
    "authorityBinding",
    "submittedToCivicWorkflow",
  ] as const;
  if (
    !exactRecord(parsed, keys) ||
    parsed.schemaVersion !== "public_participant_topic_suggestion_draft_v1" ||
    typeof parsed.title !== "string" ||
    typeof parsed.summary !== "string" ||
    parsed.entryState !== "citizen_adoption_required" ||
    parsed.authorityBinding !== "none" ||
    parsed.submittedToCivicWorkflow !== false
  ) {
    throw new Error("civic_topic_suggestion_draft_invalid");
  }
  const { title, summary } = normalizedSuggestionContent({
    title: parsed.title,
    summary: parsed.summary,
  });
  const expectedDraft = participantTopicSuggestionDraft({
    binding: input.binding,
    participantPubkey,
    receiptId,
    sourceDiscussionId: input.sourceDiscussion.id,
    sourceAnswerId: input.sourceAnswer.id,
    title,
    summary,
  });
  const expectedTags = [
    ["schema", "staging_participant_signed_topic_suggestion_v1"],
    ["municipality", expectedDraft.municipalityId],
    ["topic", expectedDraft.topicId],
    ["e", expectedDraft.sourceDiscussionId, "", "root"],
    ["mecky-receipt", expectedDraft.sourceAnswerReceiptId],
    ["credential-class", "staging-participant"],
  ];
  if (
    input.event.content !== canonical(expectedDraft) ||
    canonical(parsed) !== canonical(expectedDraft) ||
    canonical(input.event.tags) !== canonical(expectedTags)
  ) {
    throw new Error("civic_topic_suggestion_draft_invalid");
  }
  return participantTopicSuggestionCandidate(input.event, expectedDraft);
}

/**
 * Sign the ADR 0023 citizen adoption of an immutable participant suggestion.
 *
 * `eligibilityPolicy` is trusted deployment configuration. This kernel checks
 * its exact receipt binding and invokes its proof verifier, but it neither
 * issues eligibility nor creates a Case, ballot, publication, or treasury
 * effect.
 */
export function buildCitizenTopicSuggestionAdoption(
  secretKey: Uint8Array,
  input: CitizenTopicSuggestionAdoptionInput
): CitizenTopicSuggestionAdoptionV1 {
  const adopterPubkey = getPublicKeyHex(secretKey);
  const participantSuggestion = participantSuggestionForAdoption(
    input.participantSuggestion
  );
  const receipt = eligibilityReceiptForAdoption({
    receipt: input.eligibilityReceipt,
    policy: input.eligibilityPolicy,
    participantSuggestion,
    adopterPubkey,
  });
  if (
    !Number.isSafeInteger(input.createdAt) ||
    input.createdAt < 0 ||
    input.createdAt < participantSuggestion.event.created_at
  ) {
    invalidCitizenAdoption("civic_topic_suggestion_adoption_timestamp_invalid");
  }
  if (
    input.createdAt < receipt.eligibilityCore.issuedAt ||
    input.createdAt >= receipt.eligibilityCore.expiresAt
  ) {
    invalidCitizenAdoption("civic_eligibility_receipt_invalid");
  }
  const adoptionCore = {
    municipalityId: participantSuggestion.draft.municipalityId,
    topicId: participantSuggestion.draft.topicId,
    participantSuggestionId: participantSuggestion.suggestionId,
    participantSuggestionRef: `nostr://event/${participantSuggestion.suggestionId}`,
    participantPubkey: participantSuggestion.signerPubkey,
    sourceDiscussionId: participantSuggestion.draft.sourceDiscussionId,
    sourceAnswerReceiptId: participantSuggestion.draft.sourceAnswerReceiptId,
    adopterPubkey,
    eligibilityReceiptId: receipt.receiptId,
    eligibilityReceiptChecksum: receipt.payloadChecksum,
    title: participantSuggestion.draft.title,
    summary: participantSuggestion.draft.summary,
  };
  const adoption: PublicCitizenTopicSuggestionAdoptionV1 = {
    schemaVersion: "public_citizen_topic_suggestion_adoption_v1",
    adoptionId: `urn:stadtstack:citizen-topic-suggestion-adoption:${digest(adoptionCore).slice("sha256:".length)}`,
    ...adoptionCore,
    entryState: "case_steward_review_required",
    authorityBinding: "civic_eligibility_only",
    submittedToCivicWorkflow: false,
  };
  const event = buildNoteEvent(secretKey, canonical(adoption), {
    createdAt: input.createdAt,
    tags: [
      ["schema", "citizen_adopted_topic_suggestion_v1"],
      ["municipality", adoption.municipalityId],
      ["topic", adoption.topicId],
      ["e", adoption.participantSuggestionId, "", "adopted-suggestion"],
      ["e", adoption.sourceDiscussionId, "", "root"],
      ["p", adoption.participantPubkey],
      ["eligibility-receipt", adoption.eligibilityReceiptId],
      ["credential-class", "municipal-civic-eligibility"],
    ],
  });
  return citizenTopicSuggestionAdoption(event, participantSuggestion, receipt);
}

/** Verify a fully signed adoption against the immutable suggestion and policy. */
export function verifyCitizenTopicSuggestionAdoption(
  input: VerifyCitizenTopicSuggestionAdoptionInput
): CitizenTopicSuggestionAdoptionV1 {
  const event = snapshotNostrEvent(input.event);
  if (
    !event ||
    !verifyEvent(event) ||
    event.kind !== 1 ||
    !PUBKEY.test(event.pubkey) ||
    event.created_at < 0
  ) {
    invalidCitizenAdoption("civic_topic_suggestion_adoption_event_invalid");
  }
  const participantSuggestion = participantSuggestionForAdoption(
    input.participantSuggestion
  );
  const receipt = eligibilityReceiptForAdoption({
    receipt: input.eligibilityReceipt,
    policy: input.eligibilityPolicy,
    participantSuggestion,
    adopterPubkey: event.pubkey,
  });
  if (event.created_at < participantSuggestion.event.created_at) {
    invalidCitizenAdoption("civic_topic_suggestion_adoption_timestamp_invalid");
  }
  if (
    event.created_at < receipt.eligibilityCore.issuedAt ||
    event.created_at >= receipt.eligibilityCore.expiresAt
  ) {
    invalidCitizenAdoption("civic_eligibility_receipt_invalid");
  }
  return citizenTopicSuggestionAdoption(event, participantSuggestion, receipt);
}
