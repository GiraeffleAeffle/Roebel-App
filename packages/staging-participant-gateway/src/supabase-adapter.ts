import type {
  StagingParticipantComment,
  StagingParticipantDataAdapter,
  StagingParticipantPost,
} from "./types.ts";

/**
 * REVIEW HOLD — this draft's custom writer JWT is not an accepted production
 * credential boundary. Do not provision it or deploy this adapter; it is kept
 * only so the pure HTTP handler remains independently testable until the
 * reviewed constrained-RPC credential design replaces this file.
 */

const POST_RPC = "staging_participant_gateway_create_main_text_post";
const COMMENT_RPC = "staging_participant_gateway_create_main_text_comment";

export type RestrictedSupabaseWriterConfig = Readonly<{
  url: string;
  /** Public/publishable Supabase API key used only as the API gateway key. */
  anonKey: string;
  /** A dedicated, expiring JWT with role exactly staging_participant_writer. */
  writerToken: string;
  fetch?: typeof fetch;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function decodeJwtPayload(value: string): Record<string, unknown> | null {
  const parts = value.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as unknown;
    return isRecord(payload) ? payload : null;
  } catch {
    return null;
  }
}

function validateConfig(config: RestrictedSupabaseWriterConfig, nowSeconds = Math.floor(Date.now() / 1_000)): URL {
  let url: URL;
  try {
    url = new URL(config.url);
  } catch {
    throw new Error("staging_participant_supabase_url_invalid");
  }
  const payload = decodeJwtPayload(config.writerToken);
  if (url.protocol !== "https:" || config.anonKey.length < 16 || config.writerToken.length < 32 ||
    !payload || payload.role !== "staging_participant_writer" ||
    typeof payload.exp !== "number" || !Number.isSafeInteger(payload.exp) || payload.exp <= nowSeconds) {
    throw new Error("staging_participant_supabase_writer_config_invalid");
  }
  return url;
}

/**
 * Calls only the two named, restricted RPCs that the staging migration must
 * expose to the dedicated writer role. This is intentionally fetch-based: no
 * service-role client exists in the process, and callers cannot select tables
 * or RPCs. `apikey` is public routing only; the bearer is the narrow role.
 */
export function createRestrictedSupabaseDataAdapter(
  config: RestrictedSupabaseWriterConfig,
): StagingParticipantDataAdapter {
  const base = validateConfig(config);
  const request = config.fetch ?? globalThis.fetch;
  if (typeof request !== "function") throw new Error("staging_participant_fetch_unavailable");

  const invoke = async (rpc: string, body: Record<string, string>): Promise<unknown> => {
    const response = await request(new URL(`/rest/v1/rpc/${rpc}`, base), {
      method: "POST",
      headers: {
        apikey: config.anonKey,
        authorization: `Bearer ${config.writerToken}`,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error("staging_participant_restricted_rpc_failed");
    return await response.json() as unknown;
  };

  return {
    async createMainTextPost({ walletAddress, content, requestId }): Promise<StagingParticipantPost> {
      const value = await invoke(POST_RPC, {
        p_wallet_address: walletAddress,
        p_content: content,
        p_request_id: requestId,
      });
      if (!isStagingParticipantPost(value)) throw new Error("staging_participant_restricted_rpc_response_invalid");
      return value;
    },
    async createMainTextComment({ walletAddress, postId, content, requestId }): Promise<StagingParticipantComment> {
      const value = await invoke(COMMENT_RPC, {
        p_wallet_address: walletAddress,
        p_post_id: postId,
        p_content: content,
        p_request_id: requestId,
      });
      if (!isStagingParticipantComment(value)) throw new Error("staging_participant_restricted_rpc_response_invalid");
      return value;
    },
  };
}

function stringField(record: Record<string, unknown>, key: string): boolean {
  return typeof record[key] === "string" && Boolean(record[key]);
}

function isStagingParticipantPost(value: unknown): value is StagingParticipantPost {
  if (!isRecord(value)) return false;
  return stringField(value, "id") && stringField(value, "wallet_address") && stringField(value, "content") &&
    value.account_id === null && Array.isArray(value.media_urls) && value.media_urls.length === 0 &&
    value.video_url === null && value.category === "generell" && value.status === "published" &&
    typeof value.likes_count === "number" && typeof value.comments_count === "number" &&
    stringField(value, "created_at") && stringField(value, "updated_at") && value.post_type === "user" &&
    value.feed_type === "main" && value.linked_event_id === null && value.linked_experience_id === null;
}

function isStagingParticipantComment(value: unknown): value is StagingParticipantComment {
  if (!isRecord(value)) return false;
  return stringField(value, "id") && stringField(value, "post_id") && stringField(value, "wallet_address") &&
    stringField(value, "content") && value.account_id === null && Array.isArray(value.media_urls) &&
    value.media_urls.length === 0 && value.video_url === null && value.status === "published" &&
    stringField(value, "created_at") && value.author_username === null && value.author_profile_picture_url === null;
}

export const restrictedStagingParticipantRpcNames = {
  createMainTextPost: POST_RPC,
  createMainTextComment: COMMENT_RPC,
} as const;
