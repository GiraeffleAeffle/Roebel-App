import { verifyEvent, type NostrEvent } from "./events";

export const APP_CONVERSATION_TOPIC = "roebel-app-conversation";

const HEX64 = /^[0-9a-f]{64}$/;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

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
  }>,
): boolean {
  const commentId = expected.sourceAppCommentId ?? null;
  if (
    !HEX64.test(expected.agentPubkey) ||
    !UUID.test(expected.sourceAppPostId) ||
    (commentId !== null && !UUID.test(commentId))
  ) {
    return false;
  }
  const expectedTags = [
    ["p", expected.agentPubkey],
    ["source-app-post", expected.sourceAppPostId],
    ...(commentId === null ? [] : [["source-app-comment", commentId]]),
    ["t", APP_CONVERSATION_TOPIC],
  ];
  return (
    event.kind === 1 &&
    verifyEvent(event) &&
    Number.isSafeInteger(event.created_at) &&
    event.created_at >= 0 &&
    event.content === event.content.trim() &&
    event.content.length > 0 &&
    event.content.length <= 2_000 &&
    JSON.stringify(event.tags) === JSON.stringify(expectedTags)
  );
}
