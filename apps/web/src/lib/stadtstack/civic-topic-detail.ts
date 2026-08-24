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

export type PublicCivicTopicAdministrationStage = Readonly<{
  caseId: string;
  status: "not_available" | "in_review" | "brief_current";
}>;

export function projectPublicCivicTopicJourney(
  detail: PublicCivicTopicDetail,
  administration: PublicCivicTopicAdministrationStage | null = null,
  bindingReceipt: VerifiedPublicCaseBindingReceipt | null = null
): CivicJourney | null {
  const discussions = detail.topic.discussions;
  const administrationStatus =
    bindingReceipt &&
    bindingReceipt.topicId === detail.topic.topicId &&
    administration?.caseId === bindingReceipt.caseId
      ? administration.status
      : "not_available";
  return projectCivicJourney({
    sourcePostCount: detail.topic.sourcePostIds.length,
    discussionCount: discussions.length,
    meckyMentioned: discussions.some((entry) => entry.meckyMentioned),
    meckyAnswered: discussions.some((entry) => entry.meckyAnswered),
    proposalSigned: discussions.some((entry) => entry.suggestionSigned),
    // Signed Nostr tags are historical context only; they never advance the
    // public journey. The credential-free BFF has already verified this exact
    // receipt before the caller can supply it here.
    caseAdmitted: bindingReceipt?.topicId === detail.topic.topicId,
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
