import type { StagingArgument } from "./discussion-tree";
import type {
  CitizenSignedTopicSuggestionV1,
  ParticipantTopicSuggestionV1,
} from "@netizen-labs/nostr";
import {
  toStadtstackAdministrationProgress,
  type StadtstackAdministrationProgress,
} from "./administration-progress";
import {
  toStadtstackAdvisoryCase,
  type StadtstackAdvisoryCase,
} from "./advisory-participation";
import {
  loadPublicCivicAdministration,
  loadPublicCivicTopics,
} from "./civic-projection-client";

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

export type StagingSelectedConversation = {
  sourceAppPostId: string;
  sourceAppCommentId: string | null;
  mentionId: string;
  mentionAuthor: {
    name: string;
    kind: "citizen" | "mecky";
    pubkey: string;
    synthetic: boolean;
  };
  replyId: string;
  receiptId: string | null;
  evidenceRefs: { digest: string; url: string }[];
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
    sourceConversation: StagingSelectedConversation | null;
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
  return loadPublicCivicTopics();
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
  sourceConversation: StagingSelectedConversation | null;
  /**
   * The closed, relay-verified source exchange needed to reconstruct an
   * ADR-0022 participant suggestion. This is public evidence, not authority;
   * absence or any mismatch must stop the browser-side hand-off.
   */
  sourceConversationWitnesses: null | {
    conversationTopic: string;
    mentionEvent: StagingSignedEvent;
    replyEvent: StagingSignedEvent;
  };
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
  /** Synthetic legacy records may retain the earlier citizen shape only. */
  suggestion: CitizenSignedTopicSuggestionV1 | ParticipantTopicSuggestionV1 | null;
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
  mentionEvent: StagingSignedEvent;
  replyEvent: StagingSignedEvent;
  mentionAuthor: StagingSelectedConversation["mentionAuthor"];
  sourceAppCommentId: string | null;
  receiptId: string | null;
  content: string;
  createdAt: string;
  evidenceRefs: { digest: string; url: string }[];
};

export type StagingMeckyConversationRequest = {
  mentionId: string;
  sourceAppCommentId: string | null;
  state: "pending" | "answered";
  replyId: string | null;
};

export type StagingMeckyConversationResponse = {
  schemaVersion: "roebel_app_mecky_conversation_v1";
  postId: string;
  requestCount: number;
  mentionIds: string[];
  pendingCount: number;
  requests: StagingMeckyConversationRequest[];
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

const ROEBEL_CIVIC_CASE_ID =
  /^urn:stadtstack:case:municipality:roebel-mueritz:[0-9a-z][0-9a-z-]{0,127}$/;

async function loadStadtstackPublicCaseProjection(
  caseId: string
): Promise<unknown> {
  if (!ROEBEL_CIVIC_CASE_ID.test(caseId)) throw new StagingUnavailableError();
  return loadPublicCivicAdministration(caseId);
}

/**
 * Read one already-public, already-reviewed administration projection. The
 * browser never invokes the case-steward command surface and never infers
 * private openDesk state from a missing package.
 */
export async function loadStadtstackAdministrationProgress(
  caseId: string
): Promise<StadtstackAdministrationProgress> {
  try {
    const value = await loadStadtstackPublicCaseProjection(caseId);
    const progress = toStadtstackAdministrationProgress(value);
    if (progress.caseBinding.caseId !== caseId) {
      throw new StagingUnavailableError();
    }
    return progress;
  } catch (error) {
    if (error instanceof StagingUnavailableError) throw error;
    throw new StagingUnavailableError();
  }
}

/**
 * Read the same exact public case projection as the administration stage and
 * derive only its current Citizen Brief, reviewed budget context, and
 * checksum-bound advisory result. No detached public profile is accepted.
 */
export async function loadStadtstackAdvisoryCase(
  caseId: string
): Promise<StadtstackAdvisoryCase> {
  try {
    const value = await loadStadtstackPublicCaseProjection(caseId);
    const advisoryCase = toStadtstackAdvisoryCase(value);
    if (advisoryCase.caseId !== caseId) throw new StagingUnavailableError();
    return advisoryCase;
  } catch (error) {
    if (error instanceof StagingUnavailableError) throw error;
    throw new StagingUnavailableError();
  }
}

export async function stagingPost<T>(path: string, body: unknown): Promise<T> {
  return stagingRequest<T>(path, {
    method: "POST",
    headers: { "content-type": "application/json", "x-stadtstack-e2e": "1" },
    body: JSON.stringify(body),
  });
}
