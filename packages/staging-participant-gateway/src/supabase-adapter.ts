import type {
  StagingParticipantComment,
  StagingParticipantDataAdapter,
  StagingParticipantPost,
} from "./types.ts";

const POST_RPC = "staging_participant_gateway_create_main_text_post";
const COMMENT_RPC = "staging_participant_gateway_create_main_text_comment";

export type RestrictedSupabaseRpcConfig = Readonly<{
  url: string;
  /** Browser-public anon/publishable key used only for PostgREST routing. */
  anonKey: string;
  /** Gateway-only capability matched against Supabase Vault by the two RPCs. */
  rpcSecret: string;
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

function unsafeAnonKey(value: string): boolean {
  if (value.startsWith("sb_secret_")) return true;
  const payload = decodeJwtPayload(value);
  return payload !== null && payload.role !== "anon";
}

function validateConfig(config: RestrictedSupabaseRpcConfig): URL {
  let url: URL;
  try {
    url = new URL(config.url);
  } catch {
    throw new Error("staging_participant_supabase_url_invalid");
  }
  if (url.protocol !== "https:" || config.anonKey.length < 16 ||
    unsafeAnonKey(config.anonKey) || config.rpcSecret.length < 32) {
    throw new Error("staging_participant_supabase_rpc_config_invalid");
  }
  return url;
}

/**
 * Calls only the two named, restricted RPCs that the staging migration exposes
 * to anon. The anon key is already browser-public; the additional header is a
 * gateway-only capability that those two functions compare to Supabase Vault.
 * No service-role or custom-role bearer exists in this process.
 */
export function createRestrictedSupabaseDataAdapter(
  config: RestrictedSupabaseRpcConfig,
): StagingParticipantDataAdapter {
  const base = validateConfig(config);
  const request = config.fetch ?? globalThis.fetch;
  if (typeof request !== "function") throw new Error("staging_participant_fetch_unavailable");

  const invoke = async (rpc: string, body: Record<string, string>): Promise<unknown> => {
    const response = await request(new URL(`/rest/v1/rpc/${rpc}`, base), {
      method: "POST",
      headers: {
        apikey: config.anonKey,
        authorization: `Bearer ${config.anonKey}`,
        "x-staging-participant-rpc-secret": config.rpcSecret,
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
      if (value.wallet_address.toLowerCase() !== walletAddress.toLowerCase() ||
        value.content !== content) {
        throw new Error("staging_participant_restricted_rpc_response_mismatch");
      }
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
      if (value.wallet_address.toLowerCase() !== walletAddress.toLowerCase() ||
        value.post_id.toLowerCase() !== postId.toLowerCase() || value.content !== content) {
        throw new Error("staging_participant_restricted_rpc_response_mismatch");
      }
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
