import type {
  StagingFeedResponse,
  StagingOrdinaryPost,
  StagingTopicPost,
} from "./staging-api";
import { projectCivicJourney, type CivicJourney } from "./civic-journey";

const ROEBEL_TOPIC_ID =
  /^urn:stadtstack:topic:municipality:roebel-mueritz:[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type PublicCivicTopicDetail = Readonly<{
  topic: StagingTopicPost;
  sourcePosts: readonly StagingOrdinaryPost[];
  unresolvedSourcePostIds: readonly string[];
}>;

export function projectPublicCivicTopicJourney(
  detail: PublicCivicTopicDetail
): CivicJourney | null {
  const discussions = detail.topic.discussions;
  return projectCivicJourney({
    sourcePostCount: detail.topic.sourcePostIds.length,
    discussionCount: discussions.length,
    meckyMentioned: discussions.some((entry) => entry.meckyMentioned),
    meckyAnswered: discussions.some((entry) => entry.meckyAnswered),
    proposalSigned: discussions.some((entry) => entry.suggestionSigned),
    caseAdmitted: discussions.some((entry) => entry.caseBinding !== null),
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

  return {
    topic: primary,
    sourcePosts,
    unresolvedSourcePostIds: [...sourceIds].filter((id) => !resolved.has(id)),
  };
}
