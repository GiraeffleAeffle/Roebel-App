import type {
  StagingConfigResponse,
  StagingFeedResponse,
  StagingMeckyConversationResponse,
  StagingThreadResponse,
} from "@/lib/stadtstack/staging-api";

// The verified relay projection can exceed five seconds on staging. Keep this
// deadline below the browser budget so an unavailable upstream returns a 503.
const CIVIC_PROJECTION_TIMEOUT_MS = 12_000;
const HEX64 = /^[0-9a-f]{64}$/u;

export class CivicProjectionNotFoundError extends Error {
  constructor() {
    super("public_civic_projection_not_found");
    this.name = "CivicProjectionNotFoundError";
  }
}

export class CivicProjectionUnavailableError extends Error {
  constructor() {
    super("public_civic_projection_unavailable");
    this.name = "CivicProjectionUnavailableError";
  }
}

export type CivicProjectionReader = Readonly<{
  readPublicFeed(): Promise<StagingFeedResponse>;
  readConversation(
    sourceAppPostId: string
  ): Promise<StagingMeckyConversationResponse>;
  readDiscussion(rootId: string): Promise<StagingThreadResponse>;
  readInstance(): Promise<StagingConfigResponse>;
  readAdministration(caseId: string): Promise<unknown>;
}>;

type ReaderOptions = Readonly<{
  upstreamUrl: string;
  fetchImpl?: typeof fetch;
}>;

function upstreamBase(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new CivicProjectionUnavailableError();
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new CivicProjectionUnavailableError();
  }
  url.pathname = `${url.pathname.replace(/\/+$/u, "")}/`;
  return url;
}

function containsSyntheticRecord(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsSyntheticRecord);
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (record.synthetic === true) return true;
  return Object.values(record).some(containsSyntheticRecord);
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CivicProjectionUnavailableError();
  }
  return value as Record<string, unknown>;
}

export function createCivicProjectionReader(
  options: ReaderOptions
): CivicProjectionReader {
  const base = upstreamBase(options.upstreamUrl);
  const request = options.fetchImpl ?? fetch;

  const get = async (path: string): Promise<Record<string, unknown>> => {
    let response: Response;
    try {
      response = await request(new URL(path, base), {
        method: "GET",
        cache: "no-store",
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(CIVIC_PROJECTION_TIMEOUT_MS),
      });
    } catch {
      throw new CivicProjectionUnavailableError();
    }
    if (response.status === 404) throw new CivicProjectionNotFoundError();
    if (!response.ok) throw new CivicProjectionUnavailableError();
    try {
      return object(await response.json());
    } catch (error) {
      if (
        error instanceof CivicProjectionNotFoundError ||
        error instanceof CivicProjectionUnavailableError
      ) {
        throw error;
      }
      throw new CivicProjectionUnavailableError();
    }
  };

  return Object.freeze({
    async readPublicFeed() {
      const value = await get("feed?profile=public");
      if (
        value.schemaVersion !== "roebel_staging_mixed_feed_v1" ||
        value.authorityBinding !== "none" ||
        !Array.isArray(value.posts) ||
        containsSyntheticRecord(value.posts)
      ) {
        throw new CivicProjectionUnavailableError();
      }
      return value as unknown as StagingFeedResponse;
    },

    async readConversation(sourceAppPostId) {
      const value = await get(
        `conversation?post=${encodeURIComponent(sourceAppPostId)}`
      );
      if (
        value.schemaVersion !== "roebel_app_mecky_conversation_v1" ||
        value.postId !== sourceAppPostId ||
        value.authorityBinding !== "none" ||
        !Array.isArray(value.requests) ||
        !Array.isArray(value.replies) ||
        containsSyntheticRecord(value)
      ) {
        throw new CivicProjectionUnavailableError();
      }
      return value as unknown as StagingMeckyConversationResponse;
    },

    async readDiscussion(rootId) {
      const value = await get(`thread?root=${encodeURIComponent(rootId)}`);
      if (
        value.schemaVersion !== "roebel_staging_argument_thread_v1" ||
        value.authorityBinding !== "none" ||
        !Array.isArray(value.arguments) ||
        !value.events ||
        typeof value.events !== "object" ||
        containsSyntheticRecord(value)
      ) {
        throw new CivicProjectionUnavailableError();
      }
      const rootEvent = value.rootEvent as { id?: unknown } | null;
      if (!rootEvent || rootEvent.id !== rootId) {
        throw new CivicProjectionNotFoundError();
      }
      return value as unknown as StagingThreadResponse;
    },

    async readInstance() {
      const value = await get("config");
      if (
        value.schemaVersion !== "roebel_e2e_workbench_config_v1" ||
        value.authorityBinding !== "none" ||
        typeof value.meckyPubkey !== "string" ||
        !HEX64.test(value.meckyPubkey)
      ) {
        throw new CivicProjectionUnavailableError();
      }
      return Object.freeze({
        schemaVersion: "roebel_e2e_workbench_config_v1",
        personas: [],
        meckyPubkey: value.meckyPubkey,
        authorityBinding: "none",
      });
    },

    async readAdministration(caseId) {
      const value = await get(
        `administration?case=${encodeURIComponent(caseId)}`
      );
      if (containsSyntheticRecord(value)) {
        throw new CivicProjectionUnavailableError();
      }
      return value;
    },
  });
}

export function configuredCivicProjectionReader(): CivicProjectionReader {
  const upstreamUrl = process.env.STADTSTACK_CIVIC_PROJECTION_UPSTREAM_URL;
  if (!upstreamUrl) throw new CivicProjectionUnavailableError();
  return createCivicProjectionReader({ upstreamUrl });
}
