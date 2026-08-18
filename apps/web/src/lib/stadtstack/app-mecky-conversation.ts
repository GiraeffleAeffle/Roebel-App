import type { NostrEvent } from "@netizen-labs/nostr";

import type {
  CitizenAdmissionProof,
  CitizenSession,
} from "../citizen-session/session";
import type { StagingConfigResponse } from "./staging-api";

export type AppMeckyConversationSource = Readonly<{
  postId: string;
  commentId?: string;
  walletAddress: string;
  content: string;
  createdAt: string;
}>;

export interface AppMeckyConversationGateway {
  getConfig(): Promise<StagingConfigResponse>;
  admit(
    proof: CitizenAdmissionProof
  ): Promise<{ status: "admitted"; pubkey: string }>;
  publish(
    event: NostrEvent
  ): Promise<{ status: "published"; event?: NostrEvent }>;
}

export type AppMeckyConversationRequest = Readonly<{
  status: "requested";
  mentionId: string;
}>;

const ADDRESS = /^0x[0-9a-f]{40}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** An explicit mention, not an email address or a word that merely contains it. */
export function containsExplicitMeckyMention(content: string): boolean {
  return /(^|[^\p{L}\p{N}_])@mecky(?![\p{L}\p{N}_])/iu.test(content);
}

function validateSource(input: {
  session: CitizenSession;
  source: AppMeckyConversationSource;
}): number {
  const source = input.source;
  const createdAtMs = Date.parse(source.createdAt);
  if (
    !UUID.test(source.postId) ||
    (source.commentId !== undefined && !UUID.test(source.commentId)) ||
    !ADDRESS.test(source.walletAddress) ||
    source.walletAddress !== source.walletAddress.toLowerCase() ||
    input.session.snapshot.credential.address !== source.walletAddress ||
    typeof source.content !== "string" ||
    source.content !== source.content.trim() ||
    source.content.length < 1 ||
    source.content.length > 2_000 ||
    !containsExplicitMeckyMention(source.content) ||
    !Number.isFinite(createdAtMs) ||
    createdAtMs < 0
  ) {
    throw new Error("app_mecky_conversation_source_invalid");
  }
  return Math.floor(createdAtMs / 1_000);
}

/**
 * Ask Mecky inside one ordinary Röbel app conversation.
 *
 * This creates only a signed, rate-limited Nostr mention bound to the immutable
 * app post/comment IDs. It cannot promote a topic, create a proposal/CivicCase,
 * vote, or mutate treasury state.
 */
export async function requestAppMeckyConversationAnswer(input: {
  session: CitizenSession;
  gateway: AppMeckyConversationGateway;
  source: AppMeckyConversationSource;
}): Promise<AppMeckyConversationRequest> {
  const createdAt = validateSource(input);
  const [config, proof] = await Promise.all([
    input.gateway.getConfig(),
    input.session.createAdmissionProof(),
  ]);
  if (!HEX64.test(config.meckyPubkey)) {
    throw new Error("app_mecky_conversation_config_invalid");
  }
  const admission = await input.gateway.admit(proof);
  if (
    admission.status !== "admitted" ||
    admission.pubkey !== proof.bindingEvent.pubkey
  ) {
    throw new Error("app_mecky_conversation_admission_invalid");
  }
  const mention = await input.session.signConversationMention({
    content: input.source.content,
    createdAt,
    agentPubkey: config.meckyPubkey,
    sourceAppPostId: input.source.postId,
    ...(input.source.commentId === undefined
      ? {}
      : { sourceAppCommentId: input.source.commentId }),
  });
  const published = await input.gateway.publish(mention);
  if (published.status !== "published") {
    throw new Error("app_mecky_conversation_publish_failed");
  }
  return Object.freeze({ status: "requested", mentionId: mention.id });
}
