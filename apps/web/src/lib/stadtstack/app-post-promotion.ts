import { verifyEvent, type NostrEvent } from "@netizen-labs/nostr";

import type {
  CitizenAdmissionProof,
  CitizenSession,
} from "../citizen-session/session";
import type {
  StagingConfigResponse,
  StagingFeedResponse,
  StagingOrdinaryPost,
} from "./staging-api";

export type AppPostPromotionSource = Readonly<{
  id: string;
  walletAddress: string;
  content: string;
  createdAt: string;
}>;

export interface AppPostPromotionGateway {
  getConfig(): Promise<StagingConfigResponse>;
  getFeed(): Promise<StagingFeedResponse>;
  admit(
    proof: CitizenAdmissionProof,
  ): Promise<{ status: "admitted"; pubkey: string }>;
  publish(
    intent: "post" | "promotion",
    event: NostrEvent,
  ): Promise<{ status: "published" | "promoted" }>;
}

export type AppPostPromotionResult = Readonly<{
  status: "existing" | "promoted";
  discussionId: string;
  topicId: string;
}>;

const ADDRESS = /^0x[0-9a-f]{40}$/;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

function topicSlug(title: string): string {
  const slug = title
    .toLocaleLowerCase("de-DE")
    .replaceAll("ä", "ae")
    .replaceAll("ö", "oe")
    .replaceAll("ü", "ue")
    .replaceAll("ß", "ss")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63)
    .replace(/-+$/g, "");
  if (!SLUG.test(slug)) throw new Error("app_post_topic_title_invalid");
  return slug;
}

function validateInput(input: {
  session: CitizenSession;
  post: AppPostPromotionSource;
  topicTitle: string;
  question: string;
  nowSeconds: number;
}): { topicTitle: string; question: string; sourceCreatedAt: number } {
  if (
    !UUID.test(input.post.id) ||
    !ADDRESS.test(input.post.walletAddress) ||
    input.session.snapshot.credential.address !== input.post.walletAddress ||
    !input.post.content.trim() ||
    input.post.content !== input.post.content.trim() ||
    input.post.content.length > 2_000
  ) {
    throw new Error("app_post_promotion_source_invalid");
  }
  const sourceCreatedAtMs = Date.parse(input.post.createdAt);
  if (!Number.isFinite(sourceCreatedAtMs) || sourceCreatedAtMs < 0) {
    throw new Error("app_post_promotion_source_invalid");
  }
  const topicTitle = input.topicTitle.trim();
  const question = input.question.trim();
  if (
    topicTitle !== input.topicTitle ||
    topicTitle.length < 3 ||
    topicTitle.length > 120 ||
    /[\u0000-\u001f\u007f]/.test(topicTitle)
  ) {
    throw new Error("app_post_topic_title_invalid");
  }
  if (
    question !== input.question ||
    question.length < 3 ||
    question.length > 1_000 ||
    /[\u0000-\u001f\u007f]/.test(question) ||
    !Number.isSafeInteger(input.nowSeconds) ||
    input.nowSeconds < 0
  ) {
    throw new Error("app_post_promotion_question_invalid");
  }
  return {
    topicTitle,
    question,
    sourceCreatedAt: Math.floor(sourceCreatedAtMs / 1_000),
  };
}

/**
 * Promote one immutable post from the ordinary Röbel feed into a civic topic.
 *
 * This seam owns the cross-system transaction and is deliberately retryable:
 * the Supabase post stays untouched, its Nostr mirror is reused by exact app
 * post ID, and only a second signed event starts the discussion. No proposal,
 * vote or CivicCase is created here.
 */
export async function promoteAppPostToCivicTopic(input: {
  session: CitizenSession;
  gateway: AppPostPromotionGateway;
  post: AppPostPromotionSource;
  topicTitle: string;
  question: string;
  nowSeconds: number;
}): Promise<AppPostPromotionResult> {
  const validated = validateInput(input);
  const [config, feed, admissionProof] = await Promise.all([
    input.gateway.getConfig(),
    input.gateway.getFeed(),
    input.session.createAdmissionProof(),
  ]);
  if (!HEX64.test(config.meckyPubkey)) {
    throw new Error("app_post_promotion_config_invalid");
  }
  const admission = await input.gateway.admit(admissionProof);
  if (
    admission.status !== "admitted" ||
    admission.pubkey !== admissionProof.bindingEvent.pubkey
  ) {
    throw new Error("app_post_promotion_admission_invalid");
  }

  const matches = feed.posts.filter(
    (entry): entry is StagingOrdinaryPost =>
      entry.entryType === "post" &&
      entry.sourceAppPostId === input.post.id,
  );
  if (matches.length > 1) {
    throw new Error("app_post_promotion_source_ambiguous");
  }
  const existing = matches[0];
  if (
    existing &&
    (!verifyEvent(existing.event) ||
      existing.author.pubkey !== admission.pubkey ||
      existing.event.pubkey !== admission.pubkey ||
      existing.content !== input.post.content)
  ) {
    throw new Error("app_post_promotion_source_mismatch");
  }
  if (existing?.promotedDiscussionId) {
    if (!existing.promotedTopicId) {
      throw new Error("app_post_promotion_state_invalid");
    }
    return Object.freeze({
      status: "existing" as const,
      discussionId: existing.promotedDiscussionId,
      topicId: existing.promotedTopicId,
    });
  }

  let sourcePost = existing?.event;
  if (!sourcePost) {
    sourcePost = await input.session.signPublicPost({
      content: input.post.content,
      createdAt: validated.sourceCreatedAt,
      sourceAppPostId: input.post.id,
    });
    const published = await input.gateway.publish("post", sourcePost);
    if (published.status !== "published") {
      throw new Error("app_post_promotion_source_publish_failed");
    }
  }

  const topicId = `urn:stadtstack:topic:municipality:roebel-mueritz:${topicSlug(validated.topicTitle)}`;
  const discussion = await input.session.promotePublicPostToTopic({
    sourcePost,
    municipalityId: "roebel-mueritz",
    topicId,
    topicTitle: validated.topicTitle,
    agentPubkey: config.meckyPubkey,
    content: /@mecky\b/i.test(validated.question)
      ? validated.question
      : `@Mecky, ${validated.question}`,
    createdAt: Math.max(input.nowSeconds, sourcePost.created_at + 1),
  });
  const promoted = await input.gateway.publish("promotion", discussion);
  if (promoted.status !== "promoted") {
    throw new Error("app_post_promotion_publish_failed");
  }

  return Object.freeze({
    status: "promoted" as const,
    discussionId: discussion.id,
    topicId,
  });
}
