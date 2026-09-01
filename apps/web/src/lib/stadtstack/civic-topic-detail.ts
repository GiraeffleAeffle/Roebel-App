import type {
  StagingFeedResponse,
  StagingOrdinaryPost,
  StagingTopicPost,
} from "./staging-api";
import { projectCivicJourney, type CivicJourney } from "./civic-journey";
import type { VerifiedPublicCaseBindingReceipt } from "./public-case-binding-receipt-client";

const ROEBEL_TOPIC_ID =
  /^urn:stadtstack:topic:municipality:roebel-mueritz:[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type PublicCivicTopicDetail = Readonly<{
  topic: StagingTopicPost;
  sourcePosts: readonly StagingOrdinaryPost[];
  unresolvedSourcePostIds: readonly string[];
  caseBinding: StagingTopicPost["discussions"][number]["caseBinding"];
  caseBindingConflict: boolean;
}>;

export type PublicCivicPostLink = Readonly<{
  detail: PublicCivicTopicDetail;
  discussionId: string;
  journey: CivicJourney;
}>;

export type PublicCivicTopicAdministrationStage = Readonly<{
  caseId: string;
  status: "not_available" | "in_review" | "brief_current" | "brief_withdrawn";
}>;

export function projectPublicCivicTopicJourney(
  detail: PublicCivicTopicDetail,
  administration: PublicCivicTopicAdministrationStage | null = null,
  bindingReceipt: VerifiedPublicCaseBindingReceipt | null = null
): CivicJourney | null {
  const discussions = detail.topic.discussions;
  const matchingReceipt =
    bindingReceipt?.topicId === detail.topic.topicId ? bindingReceipt : null;
  const administrationStatus =
    matchingReceipt && administration?.caseId === matchingReceipt.caseId
      ? administration.status
      : "not_available";
  return projectCivicJourney({
    sourcePostCount: detail.topic.sourcePostIds.length,
    discussionCount: discussions.length,
    meckyMentioned: discussions.some((entry) => entry.meckyMentioned),
    meckyAnswered: discussions.some((entry) => entry.meckyAnswered),
    proposalSigned: discussions.some((entry) => entry.suggestionSigned),
    citizenAdoptionVerified:
      matchingReceipt?.schemaVersion === "public_case_binding_receipt_v2",
    // Signed Nostr tags are historical context only; they never advance the
    // public journey. The credential-free BFF has already verified this exact
    // receipt before the caller can supply it here.
    caseAdmitted: Boolean(matchingReceipt),
    administrationStatus,
    participationStatus:
      administrationStatus === "brief_current"
        ? "brief_ready"
        : "not_available",
  });
}

function timestamp(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Resolve one canonical public topic without turning it into a mutable
 * aggregate. Signed source posts and discussion roots remain separate records;
 * this projection only groups and orders their public references.
 */
export function projectPublicCivicTopicDetail(
  feed: StagingFeedResponse,
  topicId: string
): PublicCivicTopicDetail | null {
  if (
    feed.schemaVersion !== "roebel_staging_mixed_feed_v1" ||
    feed.authorityBinding !== "none" ||
    !ROEBEL_TOPIC_ID.test(topicId)
  ) {
    return null;
  }

  const matching = feed.posts
    .filter(
      (entry): entry is StagingTopicPost =>
        entry.entryType === "topic" &&
        entry.synthetic === false &&
        entry.topicId === topicId &&
        timestamp(entry.lastActivityAt) !== null
    )
    .sort(
      (left, right) =>
        timestamp(right.lastActivityAt)! - timestamp(left.lastActivityAt)! ||
        left.id.localeCompare(right.id)
    );
  const primary = matching[0];
  if (!primary) return null;

  const sourceIds = new Set(
    matching.flatMap((entry) => entry.sourcePostIds).sort()
  );
  const sourcePosts = feed.posts
    .filter(
      (entry): entry is StagingOrdinaryPost =>
        entry.entryType === "post" &&
        entry.synthetic === false &&
        sourceIds.has(entry.id)
    )
    .sort(
      (left, right) =>
        (timestamp(right.createdAt) ?? Number.NEGATIVE_INFINITY) -
          (timestamp(left.createdAt) ?? Number.NEGATIVE_INFINITY) ||
        left.id.localeCompare(right.id)
    );
  const resolved = new Set(sourcePosts.map((entry) => entry.id));
  const bindings = new Map<
    string,
    NonNullable<StagingTopicPost["discussions"][number]["caseBinding"]>
  >();
  for (const discussion of primary.discussions) {
    if (discussion.caseBinding) {
      bindings.set(
        `${discussion.caseBinding.municipalityId}:${discussion.caseBinding.canonicalCaseId}`,
        discussion.caseBinding
      );
    }
  }

  return {
    topic: primary,
    sourcePosts,
    unresolvedSourcePostIds: [...sourceIds].filter((id) => !resolved.has(id)),
    caseBinding: bindings.size === 1 ? [...bindings.values()][0]! : null,
    caseBindingConflict: bindings.size > 1,
  };
}

/**
 * Resolve the public civic journey that was explicitly started from one app
 * post. The source post remains a normal app record; this function only
 * follows the signed mirror and selected-conversation references already
 * present in the public projection.
 *
 * Ambiguous topic or discussion bindings fail closed instead of guessing
 * which journey a source post belongs to.
 */
export function projectPublicCivicPostLink(
  feed: StagingFeedResponse,
  sourceAppPostId: string
): PublicCivicPostLink | null {
  if (
    feed.schemaVersion !== "roebel_staging_mixed_feed_v1" ||
    feed.authorityBinding !== "none" ||
    typeof sourceAppPostId !== "string" ||
    sourceAppPostId.length === 0 ||
    sourceAppPostId.length > 200 ||
    sourceAppPostId !== sourceAppPostId.trim() ||
    /[\u0000-\u001f\u007f]/u.test(sourceAppPostId)
  ) {
    return null;
  }

  const mirrors = feed.posts.filter(
    (entry): entry is StagingOrdinaryPost =>
      entry.entryType === "post" &&
      entry.synthetic === false &&
      entry.sourceAppPostId === sourceAppPostId
  );
  const topicIds = new Set<string>();
  const discussionIds = new Set<string>();

  for (const mirror of mirrors) {
    if (mirror.promotedTopicId) topicIds.add(mirror.promotedTopicId);
    if (mirror.promotedDiscussionId)
      discussionIds.add(mirror.promotedDiscussionId);
  }
  for (const entry of feed.posts) {
    if (entry.entryType !== "topic" || entry.synthetic) continue;
    for (const discussion of entry.discussions) {
      if (discussion.sourceConversation?.sourceAppPostId !== sourceAppPostId)
        continue;
      topicIds.add(entry.topicId);
      discussionIds.add(discussion.id);
    }
  }

  if (topicIds.size !== 1 || discussionIds.size !== 1) return null;
  const topicId = [...topicIds][0]!;
  const discussionId = [...discussionIds][0]!;
  const detail = projectPublicCivicTopicDetail(feed, topicId);
  if (
    !detail ||
    !detail.topic.discussions.some(
      (discussion) => discussion.id === discussionId
    )
  ) {
    return null;
  }
  const journey = projectPublicCivicTopicJourney(detail);
  return journey ? { detail, discussionId, journey } : null;
}
