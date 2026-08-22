import type { StagingTopicPost } from "./staging-api";

export type PublicCivicFeedEntry<
  Post extends { id: string; created_at: string },
> =
  | Readonly<{ kind: "post"; occurredAt: string; post: Post }>
  | Readonly<{
      kind: "topic";
      occurredAt: string;
      topic: StagingTopicPost;
    }>;

function validTime(value: string): number | null {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

/**
 * Build the public social backbone without changing either source record.
 *
 * Ordinary posts stay ordinary even when they are cited by a topic. Topic
 * activity is a projection: synthetic lab entries and malformed timestamps
 * are excluded, duplicate topic identifiers collapse to the latest signed
 * activity, and the resulting mixed backbone is deterministically ordered.
 */
export function projectPublicCivicFeed<
  Post extends { id: string; created_at: string },
>(
  posts: readonly Post[],
  activity: readonly StagingTopicPost[]
): PublicCivicFeedEntry<Post>[] {
  const latestByTopic = new Map<
    string,
    { timestamp: number; topic: StagingTopicPost }
  >();

  for (const topic of activity) {
    if (topic.synthetic) continue;
    const timestamp = validTime(topic.lastActivityAt);
    if (timestamp === null) continue;
    const current = latestByTopic.get(topic.topicId);
    if (
      !current ||
      timestamp > current.timestamp ||
      (timestamp === current.timestamp && topic.id < current.topic.id)
    )
      latestByTopic.set(topic.topicId, { timestamp, topic });
  }

  const entries: Array<
    PublicCivicFeedEntry<Post> & { sortId: string; timestamp: number }
  > = [];
  for (const post of posts) {
    const timestamp = validTime(post.created_at);
    entries.push({
      kind: "post",
      occurredAt: post.created_at,
      post,
      sortId: `post:${post.id}`,
      timestamp: timestamp ?? Number.NEGATIVE_INFINITY,
    });
  }
  for (const { timestamp, topic } of latestByTopic.values())
    entries.push({
      kind: "topic",
      occurredAt: topic.lastActivityAt,
      topic,
      sortId: `topic:${topic.topicId}:${topic.id}`,
      timestamp,
    });

  return entries
    .sort(
      (left, right) =>
        right.timestamp - left.timestamp ||
        left.sortId.localeCompare(right.sortId)
    )
    .map(({ sortId: _sortId, timestamp: _timestamp, ...entry }) => entry);
}
