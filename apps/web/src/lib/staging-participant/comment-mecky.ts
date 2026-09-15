import {
  isAppConversationMentionEvent,
  verifyEvent,
  type NostrEvent,
} from "@netizen-labs/nostr";
import type { PostComment } from "../../types/post";
import type { CitizenSession } from "../citizen-session/session";
import { containsExplicitMeckyMention } from "../stadtstack/app-mecky-conversation";
import { loadPublicCivicInstance } from "../stadtstack/civic-projection-client";
import {
  openDurableJsonOperation,
  resumeDurableJsonOperation,
} from "./durable-operation";

const SCHEMA = "staging_participant_nostr_comment_request_v1";
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
type Comment = Pick<
  PostComment,
  "id" | "post_id" | "wallet_address" | "content"
>;
type SignedComment = {
  schemaVersion: typeof SCHEMA;
  requestId: string;
  sourcePostId: string;
  sourceCommentId: string;
  event: NostrEvent;
};

/** Publish the author's explicit mention into the original shared feed thread.
 * Only the public signed event is retained; each attempt proves the current
 * wallet again. A lost response never generates a second comment or reply.
 */
export async function requestStagingCommentMecky(input: {
  comment: Comment;
  session: CitizenSession;
}): Promise<string> {
  const { comment, session } = input;
  const wallet = session.snapshot.credential.address.toLowerCase();
  if (
    !UUID.test(comment.id) ||
    !UUID.test(comment.post_id) ||
    wallet !== comment.wallet_address.toLowerCase() ||
    !containsExplicitMeckyMention(comment.content)
  ) {
    throw Error("Diese Mecky-Anfrage gehört nicht zum verbundenen Konto.");
  }
  const config = await loadPublicCivicInstance();
  const validate = (value: unknown): value is SignedComment => {
    if (!value || typeof value !== "object" || Array.isArray(value))
      return false;
    const v = value as SignedComment;
    return (
      Object.keys(v).sort().join(",") ===
        "event,requestId,schemaVersion,sourceCommentId,sourcePostId" &&
      v.schemaVersion === SCHEMA &&
      UUID.test(v.requestId) &&
      v.sourcePostId === comment.post_id &&
      v.sourceCommentId === comment.id &&
      v.event?.content === comment.content &&
      verifyEvent(v.event) &&
      isAppConversationMentionEvent(v.event, {
        agentPubkey: config.meckyPubkey,
        sourceAppPostId: comment.post_id,
        sourceAppCommentId: comment.id,
      })
    );
  };
  const key = `comment-mecky:${wallet}:${comment.id}`;
  let operation = resumeDurableJsonOperation({ key, validate });
  const fresh = async () =>
    openDurableJsonOperation<SignedComment>({
      key,
      validate,
      candidate: {
        schemaVersion: SCHEMA,
        requestId: crypto.randomUUID(),
        sourcePostId: comment.post_id,
        sourceCommentId: comment.id,
        event: await session.signConversationMention({
          content: comment.content,
          createdAt: Math.floor(Date.now() / 1_000),
          agentPubkey: config.meckyPubkey,
          sourceAppPostId: comment.post_id,
          sourceAppCommentId: comment.id,
        }),
      },
    });
  operation ??= await fresh();
  for (let attempt = 0; attempt < 2; attempt++) {
    const admissionProof = await session.createAdmissionProof();
    if (admissionProof.bindingEvent.pubkey !== operation.body.event.pubkey)
      throw Error("Die Signatur gehört zu einem anderen Konto.");
    const response = await fetch("/api/staging-participant/v1/nostr-comment", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...operation.body, admissionProof }),
      signal: AbortSignal.timeout(20_000),
    });
    const result = await response.json().catch(() => null);
    // Only the durable database's explicit 'never reserved and stale' result
    // permits a fresh event. Ambiguous failures retain the exact signed request.
    if (
      response.status === 400 &&
      result?.error === "nostr_comment_stale" &&
      attempt === 0
    ) {
      operation.complete();
      operation = await fresh();
      continue;
    }
    if (
      !response.ok ||
      result?.status !== "published" ||
      result.eventId !== operation.body.event.id ||
      result.authority !== "none"
    ) {
      throw Error(
        "Dein Kommentar ist veröffentlicht. Die Mecky-Anfrage kann hier erneut gesendet werden."
      );
    }
    // Retain the public request so another click/reload is the same operation.
    return result.eventId;
  }
  throw Error("Mecky konnte noch nicht erreicht werden.");
}
