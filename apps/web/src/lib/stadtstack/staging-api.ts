import type { StagingArgument } from "./discussion-tree";
import type { CitizenSignedTopicSuggestionV1 } from "@netizen-labs/nostr";

export const STADTSTACK_STAGING_API = "/stadtstack-test/api" as const;

type StagingFeedBase = {
  id: string;
  author: { name: string; kind: "citizen" | "mecky"; pubkey: string };
  content: string;
  createdAt: string;
  replyCount: number;
  meckyMentioned: boolean;
  meckyAnswered: boolean;
  synthetic: boolean;
};

export type StagingOrdinaryPost = StagingFeedBase & {
  entryType: "post";
  event: StagingSignedEvent;
  sourceAppPostId: string | null;
  promotedDiscussionId: string | null;
  promotedTopicId: string | null;
};

export type StagingTopicPost = StagingFeedBase & {
  entryType: "topic";
  topicId: string;
  topicTitle: string;
  discussionCount: number;
  discussionIds: string[];
  discussions: Array<{
    id: string;
    author: StagingFeedBase["author"];
    content: string;
    createdAt: string;
    replyCount: number;
    meckyMentioned: boolean;
    meckyAnswered: boolean;
    suggestionSigned: boolean;
    caseBinding: {
      municipalityId: string;
      sourceCaseId: string;
      canonicalCaseId: string;
    } | null;
    synthetic: boolean;
  }>;
  sourcePostIds: string[];
  activityCount: number;
  lastActivityAt: string;
};

export type StagingFeedPost = StagingOrdinaryPost | StagingTopicPost;

export type StagingFeedResponse = {
  schemaVersion: "roebel_staging_mixed_feed_v1";
  posts: StagingFeedPost[];
  authorityBinding: "none";
};

/** Read only non-synthetic topic activity for projection into the normal feed. */
export async function loadPublicCivicTopicActivity(): Promise<
  StagingTopicPost[]
> {
  const feed = await stagingGet<StagingFeedResponse>("/feed?profile=public");
  if (
    feed.schemaVersion !== "roebel_staging_mixed_feed_v1" ||
    feed.authorityBinding !== "none" ||
    !Array.isArray(feed.posts)
  )
    throw new StagingUnavailableError();
  return feed.posts.filter(
    (entry): entry is StagingTopicPost =>
      entry.entryType === "topic" && entry.synthetic === false
  );
}

/** Resolve legacy staging mirrors without pretending they are Supabase rows. */
export function findStagingPostMirror(
  posts: readonly StagingFeedPost[],
  sourceAppPostId: string
): StagingOrdinaryPost | null {
  return (
    posts.find(
      (post): post is StagingOrdinaryPost =>
        post.entryType === "post" && post.sourceAppPostId === sourceAppPostId
    ) ?? null
  );
}

export type StagingThreadResponse = {
  schemaVersion: "roebel_staging_argument_thread_v1";
  arguments: StagingArgument[];
  events: Record<string, StagingSignedEvent>;
  rootEvent: StagingSignedEvent | null;
  sourceAppPostId: string | null;
  topic: { id: string; title: string } | null;
  caseBinding: {
    municipalityId: string;
    sourceCaseId: string;
    canonicalCaseId: string;
  } | null;
  mecky: null | {
    event: StagingSignedEvent;
    author: { name: "Mecky"; kind: "mecky"; pubkey: string };
    evidenceRefs: { digest: string; url: string }[];
  };
  suggestion: CitizenSignedTopicSuggestionV1 | null;
  authorityBinding: "none";
};

export type StagingSignedEvent = {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
};

export type StagingPersona = {
  id: string;
  name: string;
  publicKey: string;
};

export type StagingConfigResponse = {
  schemaVersion: "roebel_e2e_workbench_config_v1";
  personas: StagingPersona[];
  meckyPubkey: string;
  authorityBinding: "none";
};

export type StagingMeckyConversationReply = {
  id: string;
  mentionId: string;
  sourceAppCommentId: string | null;
  content: string;
  createdAt: string;
  evidenceRefs: { digest: string; url: string }[];
};

export type StagingMeckyConversationResponse = {
  schemaVersion: "roebel_app_mecky_conversation_v1";
  postId: string;
  requestCount: number;
  mentionIds: string[];
  pendingCount: number;
  replies: StagingMeckyConversationReply[];
  authorityBinding: "none";
};

/**
 * The staging mirror is a labelled fallback. It must fail closed instead of
 * keeping a post or feed loading state alive when the cluster gateway stalls.
 */
export const STADTSTACK_STAGING_REQUEST_TIMEOUT_MS = 8_000;
export const STADTSTACK_STAGING_UNAVAILABLE_MESSAGE =
  "Stadtstack-Staging ist gerade nicht erreichbar.";

export class StagingUnavailableError extends Error {
  readonly code = "STADTSTACK_STAGING_UNAVAILABLE" as const;

  constructor() {
    super(STADTSTACK_STAGING_UNAVAILABLE_MESSAGE);
    this.name = "StagingUnavailableError";
    Object.setPrototypeOf(this, StagingUnavailableError.prototype);
  }
}

async function stagingRequest<T>(path: string, init: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    STADTSTACK_STAGING_REQUEST_TIMEOUT_MS
  );

  try {
    let response: Response;
    try {
      response = await fetch(`${STADTSTACK_STAGING_API}${path}`, {
        ...init,
        signal: controller.signal,
      });
    } catch {
      throw new StagingUnavailableError();
    }

    let value: unknown;
    try {
      value = await response.json();
    } catch {
      throw new StagingUnavailableError();
    }

    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new StagingUnavailableError();
    }

    const payload = value as { error?: string } & T;
    if (!response.ok)
      throw new Error(payload.error ?? `HTTP ${response.status}`);
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

export async function stagingGet<T>(path: string): Promise<T> {
  return stagingRequest<T>(path, {
    cache: "no-store",
  });
}

export async function stagingPost<T>(path: string, body: unknown): Promise<T> {
  return stagingRequest<T>(path, {
    method: "POST",
    headers: { "content-type": "application/json", "x-stadtstack-e2e": "1" },
    body: JSON.stringify(body),
  });
}
