import type {
  PublicCivicPostLink,
  PublicCivicTopicDetail,
} from "./civic-topic-detail";
import type {
  StagingConfigResponse,
  StagingMeckyConversationResponse,
  StagingThreadResponse,
  StagingTopicPost,
} from "./staging-api";

const PUBLIC_CIVIC_API = "/api/civic/v1";
const PUBLIC_CIVIC_TIMEOUT_MS = 15_000;

export class PublicCivicProjectionUnavailableError extends Error {
  constructor() {
    super("Der öffentliche Bürgerprozess ist gerade nicht erreichbar.");
    this.name = "PublicCivicProjectionUnavailableError";
  }
}

async function get(path: string): Promise<unknown | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PUBLIC_CIVIC_TIMEOUT_MS);
  try {
    let response: Response;
    try {
      response = await fetch(`${PUBLIC_CIVIC_API}${path}`, {
        method: "GET",
        cache: "no-store",
        credentials: "same-origin",
        signal: controller.signal,
      });
    } catch {
      throw new PublicCivicProjectionUnavailableError();
    }
    if (response.status === 404) return null;
    if (!response.ok) throw new PublicCivicProjectionUnavailableError();
    try {
      return await response.json();
    } catch {
      throw new PublicCivicProjectionUnavailableError();
    }
  } finally {
    clearTimeout(timeout);
  }
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PublicCivicProjectionUnavailableError();
  }
  return value as Record<string, unknown>;
}

export async function loadPublicCivicTopics(): Promise<StagingTopicPost[]> {
  const value = record(await get("/topics"));
  if (
    value.schemaVersion !== "roebel_public_civic_topic_list_v1" ||
    value.authorityBinding !== "none" ||
    !Array.isArray(value.topics)
  ) {
    throw new PublicCivicProjectionUnavailableError();
  }
  return value.topics as unknown as StagingTopicPost[];
}

export async function loadPublicCivicTopicDetail(
  topicId: string
): Promise<PublicCivicTopicDetail | null> {
  const value = await get(`/topics/${encodeURIComponent(topicId)}`);
  if (value === null) return null;
  const response = record(value);
  if (
    response.schemaVersion !== "roebel_public_civic_topic_detail_v1" ||
    response.authorityBinding !== "none" ||
    !response.detail ||
    typeof response.detail !== "object"
  ) {
    throw new PublicCivicProjectionUnavailableError();
  }
  return response.detail as unknown as PublicCivicTopicDetail;
}

export async function loadPublicCivicPostLink(
  sourceAppPostId: string
): Promise<PublicCivicPostLink | null> {
  const value = await get(
    `/post-links/${encodeURIComponent(sourceAppPostId)}`
  );
  if (value === null) return null;
  const response = record(value);
  if (
    response.schemaVersion !== "roebel_public_civic_post_link_v1" ||
    response.authorityBinding !== "none" ||
    !response.link ||
    typeof response.link !== "object"
  ) {
    throw new PublicCivicProjectionUnavailableError();
  }
  return response.link as unknown as PublicCivicPostLink;
}

export async function loadPublicMeckyConversation(
  sourceAppPostId: string
): Promise<StagingMeckyConversationResponse> {
  const value = await get(
    `/conversations/${encodeURIComponent(sourceAppPostId)}`
  );
  if (value === null) throw new PublicCivicProjectionUnavailableError();
  const response = record(value);
  if (
    response.schemaVersion !== "roebel_app_mecky_conversation_v1" ||
    response.postId !== sourceAppPostId ||
    response.authorityBinding !== "none"
  ) {
    throw new PublicCivicProjectionUnavailableError();
  }
  return response as unknown as StagingMeckyConversationResponse;
}

export async function loadPublicCivicDiscussion(
  rootId: string
): Promise<StagingThreadResponse> {
  const value = await get(`/discussions/${encodeURIComponent(rootId)}`);
  if (value === null) throw new PublicCivicProjectionUnavailableError();
  const response = record(value);
  if (
    response.schemaVersion !== "roebel_staging_argument_thread_v1" ||
    response.authorityBinding !== "none"
  ) {
    throw new PublicCivicProjectionUnavailableError();
  }
  return response as unknown as StagingThreadResponse;
}

export async function loadPublicCivicInstance(): Promise<StagingConfigResponse> {
  const value = record(await get("/instance"));
  if (
    value.schemaVersion !== "roebel_e2e_workbench_config_v1" ||
    value.authorityBinding !== "none" ||
    !Array.isArray(value.personas) ||
    value.personas.length !== 0 ||
    typeof value.meckyPubkey !== "string"
  ) {
    throw new PublicCivicProjectionUnavailableError();
  }
  return value as unknown as StagingConfigResponse;
}

export async function loadPublicCivicAdministration(
  caseId: string
): Promise<unknown> {
  const value = await get(
    `/cases/${encodeURIComponent(caseId)}/administration`
  );
  if (value === null) throw new PublicCivicProjectionUnavailableError();
  return value;
}
