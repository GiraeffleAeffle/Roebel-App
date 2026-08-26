import { verifyEvent, type NostrEvent } from "./events";

export const APP_CONVERSATION_TOPIC = "roebel-app-conversation";

const HEX64 = /^[0-9a-f]{64}$/;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const RECEIPT = /^urn:stadtstack:mecky-answer:[0-9a-f]{64}$/;
const EVIDENCE = /^sha256:[0-9a-f]{64}$/;
const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

export type VerifiedAppConversationExchange = Readonly<{
  receiptId?: string;
  evidenceRefs: readonly Readonly<{ digest: string; url: string }>[];
}>;

export type AppConversationExchangeExpectation = Readonly<{
  agentPubkey: string;
  sourceAppPostId: string;
  sourceAppCommentId?: string | null;
  /** Deployment-pinned conversation channel, not caller-selected data. */
  conversationTopic?: string;
  /** The pair is either absent from both reply tags or exact on both. */
  municipalityId?: string;
  topicId?: string;
}>;

/**
 * One exact signed mention contract shared by browser signing, admission, and
 * the ordinary post-thread projection. Keeping this validator in the protocol
 * package prevents those three seams from silently accepting different tags.
 */
export function isAppConversationMentionEvent(
  event: NostrEvent,
  expected: Readonly<{
    agentPubkey: string;
    sourceAppPostId: string;
    sourceAppCommentId?: string | null;
    conversationTopic?: string;
  }>,
): boolean {
  return isAppConversationMentionEventForTopic(event, {
    ...expected,
    conversationTopic: expected.conversationTopic ?? APP_CONVERSATION_TOPIC,
  });
}

/**
 * Verifies one closed app-post → @agent → evidence-bearing agent answer.
 *
 * This deliberately accepts neither a loose reply nor an inferred tag set.
 * The signed source note is the mention; downstream flows must retain that
 * exact event identity rather than inventing a second "source" event.
 */
export function verifyAppConversationExchange(
  mention: NostrEvent,
  reply: NostrEvent,
  expected: AppConversationExchangeExpectation,
): VerifiedAppConversationExchange | null {
  const commentId = expected.sourceAppCommentId ?? null;
  const topic = expected.conversationTopic ?? APP_CONVERSATION_TOPIC;
  const hasPair = expected.municipalityId !== undefined || expected.topicId !== undefined;
  if (
    !HEX64.test(expected.agentPubkey) || !UUID.test(expected.sourceAppPostId) ||
    (commentId !== null && !UUID.test(commentId)) || !SLUG.test(topic) ||
    (hasPair && (!expected.municipalityId || !expected.topicId ||
      !SLUG.test(expected.municipalityId) ||
      !new RegExp(`^urn:stadtstack:topic:municipality:${expected.municipalityId}:[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$`).test(expected.topicId)))
  ) return null;
  if (!isAppConversationMentionEventForTopic(mention, {
    agentPubkey: expected.agentPubkey,
    sourceAppPostId: expected.sourceAppPostId,
    sourceAppCommentId: commentId,
    conversationTopic: topic,
  })) return null;

  const baseTags = [
    ["netizen_agent", "", ""],
    ["e", mention.id, "", "reply"],
    ["p", mention.pubkey],
    ["source-app-post", expected.sourceAppPostId],
    ...(commentId === null ? [] : [["source-app-comment", commentId]]),
  ];
  if (!verifyEvent(reply) || reply.kind !== 1 || reply.pubkey !== expected.agentPubkey ||
    !Number.isSafeInteger(reply.created_at) || reply.created_at < mention.created_at ||
    reply.content !== reply.content.trim() || reply.content.length < 1 || reply.content.length > 2_000 ||
    reply.tags.length < baseTags.length + 1) return null;
  for (let index = 1; index < baseTags.length; index += 1) {
    if (JSON.stringify(reply.tags[index]) !== JSON.stringify(baseTags[index])) return null;
  }
  const agentTag = reply.tags[0];
  if (!agentTag || agentTag.length !== 3 || agentTag[0] !== "netizen_agent" ||
    !agentTag[1]?.trim() || !agentTag[2]?.trim() || agentTag[1]!.length > 120 || agentTag[2]!.length > 120) return null;
  let index = baseTags.length;
  let receiptId: string | undefined;
  if (reply.tags[index]?.[0] === "mecky-receipt") {
    const receipt = reply.tags[index++];
    if (!receipt || receipt.length !== 2 || !RECEIPT.test(receipt[1] ?? "")) return null;
    receiptId = receipt[1]!;
  }
  const carriesPair = reply.tags[index]?.[0] === "municipality" || reply.tags[index]?.[0] === "topic";
  if (carriesPair) {
    if (!hasPair) return null;
    const municipality = reply.tags[index++];
    const eventTopic = reply.tags[index++];
    if (JSON.stringify(municipality) !== JSON.stringify(["municipality", expected.municipalityId]) ||
      JSON.stringify(eventTopic) !== JSON.stringify(["topic", expected.topicId])) return null;
  }
  const evidence = reply.tags.slice(index);
  if (evidence.length < 1 || evidence.length > 3) return null;
  const evidenceRefs: Array<{ digest: string; url: string }> = [];
  for (const tag of evidence) {
    if (tag.length !== 3 || tag[0] !== "evidence" || !EVIDENCE.test(tag[1] ?? "")) return null;
    try {
      const url = new URL(tag[2] ?? "");
      if (url.protocol !== "https:" || url.username || url.password) return null;
      evidenceRefs.push({ digest: tag[1]!, url: tag[2]! });
    } catch { return null; }
  }
  if (new Set(evidenceRefs.map((entry) => entry.digest)).size !== evidenceRefs.length) return null;
  return { ...(receiptId === undefined ? {} : { receiptId }), evidenceRefs };
}

function isAppConversationMentionEventForTopic(
  event: NostrEvent,
  expected: Readonly<{
    agentPubkey: string;
    sourceAppPostId: string;
    sourceAppCommentId?: string | null;
    conversationTopic: string;
  }>,
): boolean {
  const commentId = expected.sourceAppCommentId ?? null;
  if (!HEX64.test(expected.agentPubkey) || !UUID.test(expected.sourceAppPostId) ||
    (commentId !== null && !UUID.test(commentId)) || !SLUG.test(expected.conversationTopic)) return false;
  const expectedTags = [
    ["p", expected.agentPubkey],
    ["source-app-post", expected.sourceAppPostId],
    ...(commentId === null ? [] : [["source-app-comment", commentId]]),
    ["t", expected.conversationTopic],
  ];
  return event.kind === 1 && verifyEvent(event) && Number.isSafeInteger(event.created_at) &&
    event.created_at >= 0 && event.content === event.content.trim() &&
    event.content.length > 0 && event.content.length <= 2_000 &&
    JSON.stringify(event.tags) === JSON.stringify(expectedTags);
}
