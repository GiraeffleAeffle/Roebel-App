import { createHash } from "node:crypto";

import {
  verifyEvent,
  type CivicCaseBinding,
  type CivicTopicBinding,
  type NostrEvent,
} from "@netizen-labs/nostr";

export interface PublicMeckyEvidenceRef {
  evidenceId: string;
  title: string;
  publicCaseUrl: string;
}

export interface PublicMeckyAnsweredResult {
  status: "answered";
  content: string;
  evidenceRefs: PublicMeckyEvidenceRef[];
}

export type PublicMeckyDiscussionBinding =
  | CivicCaseBinding
  | CivicTopicBinding;

export interface PublicMeckyRelayReply {
  content: string;
  receiptId: string;
  tags: string[][];
}

export interface PublicMeckyEvidenceReply {
  content: string;
  tags: string[][];
}

const TOPIC_ID =
  /^urn:stadtstack:topic:municipality:([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?):([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)$/;

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

function tagValue(event: NostrEvent, name: string): string | null {
  const matches = event.tags.filter(
    (tag) => tag[0] === name && typeof tag[1] === "string",
  );
  return matches.length === 1 ? matches[0]![1]! : null;
}

function isCaseBinding(
  binding: PublicMeckyDiscussionBinding,
): binding is CivicCaseBinding {
  return Object.hasOwn(binding, "canonicalCaseId");
}

function validateDiscussionBinding(
  discussion: NostrEvent,
  binding: PublicMeckyDiscussionBinding,
): void {
  if (
    !verifyEvent(discussion) ||
    discussion.kind !== 1 ||
    tagValue(discussion, "municipality") !== binding.municipalityId
  ) {
    throw new Error("public_mecky_discussion_binding_invalid");
  }

  if (isCaseBinding(binding)) {
    if (
      tagValue(discussion, "case") !== binding.sourceCaseId ||
      tagValue(discussion, "stadtstack-case") !== binding.canonicalCaseId
    ) {
      throw new Error("public_mecky_discussion_binding_invalid");
    }
    return;
  }

  const topicMatch = TOPIC_ID.exec(binding.topicId);
  if (
    !topicMatch ||
    topicMatch[1] !== binding.municipalityId ||
    tagValue(discussion, "topic") !== binding.topicId ||
    tagValue(discussion, "case") !== null ||
    tagValue(discussion, "stadtstack-case") !== null
  ) {
    throw new Error("public_mecky_discussion_binding_invalid");
  }
}

function validateAnswer(result: PublicMeckyAnsweredResult): void {
  if (
    result.status !== "answered" ||
    !result.content.trim() ||
    result.content.length > 2_000 ||
    result.evidenceRefs.length === 0 ||
    result.evidenceRefs.length > 3 ||
    new Set(result.evidenceRefs.map((entry) => entry.evidenceId)).size !==
      result.evidenceRefs.length
  ) {
    throw new Error("public_mecky_reply_invalid");
  }

  for (const evidence of result.evidenceRefs) {
    if (!/^sha256:[0-9a-f]{64}$/.test(evidence.evidenceId)) {
      throw new Error("public_mecky_reply_invalid");
    }
    let url: URL;
    try {
      url = new URL(evidence.publicCaseUrl);
    } catch {
      throw new Error("public_mecky_reply_invalid");
    }
    if (url.protocol !== "https:" || url.username || url.password) {
      throw new Error("public_mecky_reply_invalid");
    }
  }
}

/**
 * Resolve the binding carried by the signed discussion itself.
 *
 * The configured Case remains a compatibility fallback for the seeded staging
 * flow. A citizen-started topic is authoritative only when the signed event is
 * topic-only; it must not silently inherit or manufacture a CivicCase.
 */
export function publicMeckyDiscussionBindingFor(
  discussion: NostrEvent,
  legacyCaseBinding: CivicCaseBinding,
): PublicMeckyDiscussionBinding {
  const topicId = tagValue(discussion, "topic");
  const topicOnly =
    topicId !== null &&
    tagValue(discussion, "case") === null &&
    tagValue(discussion, "stadtstack-case") === null;
  const binding: PublicMeckyDiscussionBinding = topicOnly
    ? {
        municipalityId: legacyCaseBinding.municipalityId,
        topicId,
      }
    : legacyCaseBinding;
  validateDiscussionBinding(discussion, binding);
  return binding;
}

export function toPublicMeckyWatcherReply(
  reply: PublicMeckyRelayReply,
): { content: string; tags: string[][] } {
  return {
    content: reply.content,
    tags: reply.tags.map((tag) => [...tag]),
  };
}

/**
 * Attach evidence provenance to an ordinary conversation reply without
 * manufacturing a Case, topic, municipality or civic receipt. The watcher
 * adds the normal NIP-10 thread tags when it signs the reply.
 */
export function createPublicMeckyEvidenceReply(
  result: PublicMeckyAnsweredResult,
): PublicMeckyEvidenceReply {
  validateAnswer(result);
  return {
    content: result.content,
    tags: result.evidenceRefs.map((entry) => [
      "evidence",
      entry.evidenceId,
      entry.publicCaseUrl,
    ]),
  };
}

export function createPublicMeckyRelayReply(input: {
  discussion: NostrEvent;
  binding: PublicMeckyDiscussionBinding;
  result: PublicMeckyAnsweredResult;
}): PublicMeckyRelayReply {
  validateDiscussionBinding(input.discussion, input.binding);
  validateAnswer(input.result);

  const receiptBinding = isCaseBinding(input.binding)
    ? {
        municipalityId: input.binding.municipalityId,
        sourceCaseId: input.binding.sourceCaseId,
        canonicalCaseId: input.binding.canonicalCaseId,
      }
    : {
        municipalityId: input.binding.municipalityId,
        topicId: input.binding.topicId,
      };
  const receiptCore = {
    schemaVersion: "public_mecky_relay_answer_receipt_v1",
    discussionId: input.discussion.id,
    discussionPubkey: input.discussion.pubkey,
    ...receiptBinding,
    answer: input.result.content,
    evidenceRefs: input.result.evidenceRefs.map((entry) => ({
      evidenceId: entry.evidenceId,
      title: entry.title,
      publicCaseUrl: entry.publicCaseUrl,
    })),
    authorityBinding: "none",
    effects: {
      civicStateMutation: false,
      suggestionSubmission: false,
      vote: false,
    },
  };
  const hash = createHash("sha256")
    .update(canonical(receiptCore), "utf8")
    .digest("hex");
  const receiptId = `urn:stadtstack:mecky-answer:${hash}`;
  const bindingTags = isCaseBinding(input.binding)
    ? [
        ["municipality", input.binding.municipalityId],
        ["case", input.binding.sourceCaseId],
        ["stadtstack-case", input.binding.canonicalCaseId],
      ]
    : [
        ["municipality", input.binding.municipalityId],
        ["topic", input.binding.topicId],
      ];

  return {
    content: input.result.content,
    receiptId,
    tags: [
      ["mecky-receipt", receiptId],
      ...bindingTags,
      ...input.result.evidenceRefs.map((entry) => [
        "evidence",
        entry.evidenceId,
        entry.publicCaseUrl,
      ]),
    ],
  };
}
