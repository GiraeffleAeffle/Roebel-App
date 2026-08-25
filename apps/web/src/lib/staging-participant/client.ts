import type { Post, PostComment } from "@/types/post";

const API_ROOT = "/api/staging-participant/v1";
const CHALLENGE_SCHEMA = "staging_participant_challenge_request_v1";
const SESSION_SCHEMA = "staging_participant_session_request_v1";
const POST_SCHEMA = "staging_participant_post_request_v1";
const COMMENT_SCHEMA = "staging_participant_comment_request_v1";

export const STAGING_PARTICIPANT_LABEL =
  "Staging-Testteilnahme – keine Bürgerverifikation, kein Stimmrecht";

export type StagingParticipantStatus = {
  available: boolean;
  active: boolean;
  walletAddress: string | null;
  expiresAt?: string | null;
};

export type StagingParticipantResult<T> = {
  success: boolean;
  data?: T;
  error?: string;
};

function errorMessage(body: unknown, fallback: string): string {
  if (!body || typeof body !== "object") return fallback;
  const direct = (body as { error?: unknown }).error;
  if (typeof direct === "string" && direct.trim()) return direct;
  if (direct && typeof direct === "object") {
    const nested = (direct as { message?: unknown }).message;
    if (typeof nested === "string" && nested.trim()) return nested;
  }
  const message = (body as { message?: unknown }).message;
  return typeof message === "string" && message.trim() ? message : fallback;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function request<T>(
  path: "challenge" | "session" | "posts" | "comments",
  body: Record<string, unknown>,
  fallback: string,
  retryTransient = false,
): Promise<StagingParticipantResult<T>> {
  const encodedBody = JSON.stringify(body);
  const attempts = retryTransient ? 2 : 1;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(`${API_ROOT}/${path}`, {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: encodedBody,
      });
      const payload = await readJson(response);
      if (!response.ok) {
        if (attempt + 1 < attempts && [502, 503, 504].includes(response.status)) {
          continue;
        }
        return { success: false, error: errorMessage(payload, fallback) };
      }
      if (payload && typeof payload === "object" && "data" in payload) {
        return { success: true, data: (payload as { data: T }).data };
      }
      return { success: true, data: payload as T };
    } catch {
      if (attempt + 1 >= attempts) {
        return { success: false, error: fallback };
      }
    }
  }
  return { success: false, error: fallback };
}

function newRequestId(): string {
  if (!globalThis.crypto?.randomUUID) {
    throw new Error("secure_request_id_unavailable");
  }
  return globalThis.crypto.randomUUID();
}

export async function getStagingParticipantStatus(): Promise<StagingParticipantStatus> {
  try {
    const response = await fetch(`${API_ROOT}/status`, {
      cache: "no-store",
      credentials: "same-origin",
    });
    const payload = await readJson(response);
    if (!response.ok || !payload || typeof payload !== "object") {
      return { available: false, active: false, walletAddress: null };
    }
    const value = payload as Partial<StagingParticipantStatus>;
    return {
      available: value.available === true,
      active: value.active === true,
      walletAddress:
        typeof value.walletAddress === "string" ? value.walletAddress : null,
      expiresAt: typeof value.expiresAt === "string" ? value.expiresAt : null,
    };
  } catch {
    return { available: false, active: false, walletAddress: null };
  }
}

export function requestStagingParticipantChallenge(
  walletAddress: string,
  inviteToken?: string,
): Promise<StagingParticipantResult<{ message: string }>> {
  return request(
    "challenge",
    { schemaVersion: CHALLENGE_SCHEMA, walletAddress, inviteToken: inviteToken ?? "" },
    "Diese Wallet ist nicht für die Staging-Testteilnahme freigeschaltet",
  );
}

export function createStagingParticipantSession(
  signature: string,
): Promise<StagingParticipantResult<{ walletAddress: string; expiresAt: string }>> {
  return request(
    "session",
    { schemaVersion: SESSION_SCHEMA, signature },
    "Signatur konnte nicht für die Testteilnahme bestätigt werden",
  );
}

export function createStagingParticipantPost(
  content: string,
): Promise<StagingParticipantResult<Post>> {
  return request(
    "posts",
    { schemaVersion: POST_SCHEMA, requestId: newRequestId(), content },
    "Beitrag konnte nicht veröffentlicht werden",
    true,
  );
}

export function createStagingParticipantComment(
  postId: string,
  content: string,
): Promise<StagingParticipantResult<PostComment>> {
  return request(
    "comments",
    { schemaVersion: COMMENT_SCHEMA, requestId: newRequestId(), postId, content },
    "Kommentar konnte nicht veröffentlicht werden",
    true,
  );
}
