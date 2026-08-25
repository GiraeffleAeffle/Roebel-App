import type { Post, PostComment } from "@/types/post";
import type { CitizenSession } from "@/lib/citizen-session/session";
import type { NostrEvent } from "@netizen-labs/nostr";

const API_ROOT = "/api/staging-participant/v1";
const CHALLENGE_SCHEMA = "staging_participant_challenge_request_v1";
const SESSION_SCHEMA = "staging_participant_session_request_v1";
const POST_SCHEMA = "staging_participant_post_request_v1";
const COMMENT_SCHEMA = "staging_participant_comment_request_v1";
const NOSTR_POST_SCHEMA = "staging_participant_nostr_post_request_v1";
const PENDING_MIRROR_SCHEMA = "roebel_staging_participant_mecky_mirror_v1";
const PENDING_MIRROR_STORAGE_KEY =
  "roebel:staging-participant:mecky-mirror:v1";
const PENDING_MIRROR_TTL_MS = 15 * 60 * 1_000;
const PENDING_MIRROR_CLOCK_SKEW_MS = 5_000;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const WALLET = /^0x[0-9a-f]{40}$/iu;

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

/**
 * Retained browser-only retry payload. Only the public signed event and its
 * source/request binding cross a reload boundary. The admission proof contains
 * wallet signatures and is regenerated from the current CitizenSession for
 * every attempt; it is intentionally not part of this shape.
 */
export type PendingStagingParticipantMeckyMirror = Readonly<{
  schemaVersion: "roebel_staging_participant_mecky_mirror_v1";
  sourcePost: Pick<Post, "id" | "content">;
  requestId: string;
  walletAddress: string;
  event: NostrEvent;
  expiresAt: number;
}>;

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function validPublicEvent(value: unknown): NostrEvent | null {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype) return null;
  const record = value as Record<string, unknown>;
  if (!exactKeys(record, ["id", "pubkey", "created_at", "kind", "tags", "content", "sig"]) ||
    typeof record.id !== "string" || !/^[0-9a-f]{64}$/iu.test(record.id) ||
    typeof record.pubkey !== "string" || !/^[0-9a-f]{64}$/iu.test(record.pubkey) ||
    typeof record.created_at !== "number" || !Number.isSafeInteger(record.created_at) || record.created_at < 0 ||
    typeof record.kind !== "number" || !Number.isSafeInteger(record.kind) || record.kind < 0 ||
    typeof record.content !== "string" ||
    typeof record.sig !== "string" || !/^[0-9a-f]{128}$/iu.test(record.sig) ||
    !Array.isArray(record.tags) ||
    record.tags.some((tag) => !Array.isArray(tag) || tag.some((item) => typeof item !== "string"))) {
    return null;
  }
  return {
    id: record.id.toLowerCase(),
    pubkey: record.pubkey.toLowerCase(),
    created_at: record.created_at,
    kind: record.kind,
    tags: record.tags.map((tag) => [...tag]),
    content: record.content,
    sig: record.sig.toLowerCase(),
  } as NostrEvent;
}

function validPending(value: unknown, now = Date.now()): PendingStagingParticipantMeckyMirror | null {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype) return null;
  const record = value as Record<string, unknown>;
  if (!exactKeys(record, ["schemaVersion", "sourcePost", "requestId", "walletAddress", "event", "expiresAt"]) ||
    record.schemaVersion !== PENDING_MIRROR_SCHEMA ||
    typeof record.requestId !== "string" || !UUID.test(record.requestId) ||
    typeof record.walletAddress !== "string" || !WALLET.test(record.walletAddress) ||
    typeof record.expiresAt !== "number" || !Number.isSafeInteger(record.expiresAt) ||
    record.expiresAt <= now ||
    record.expiresAt > now + PENDING_MIRROR_TTL_MS + PENDING_MIRROR_CLOCK_SKEW_MS) {
    return null;
  }
  const sourcePost = record.sourcePost;
  if (!sourcePost || typeof sourcePost !== "object" || Array.isArray(sourcePost) ||
    Object.getPrototypeOf(sourcePost) !== Object.prototype) return null;
  const source = sourcePost as Record<string, unknown>;
  if (!exactKeys(source, ["id", "content"]) ||
    typeof source.id !== "string" || !UUID.test(source.id) ||
    typeof source.content !== "string" || source.content.trim() !== source.content ||
    source.content.length < 1 || source.content.length > 2_000) return null;
  const event = validPublicEvent(record.event);
  if (!event) return null;
  return {
    schemaVersion: PENDING_MIRROR_SCHEMA,
    sourcePost: { id: source.id.toLowerCase(), content: source.content },
    requestId: record.requestId.toLowerCase(),
    walletAddress: record.walletAddress.toLowerCase(),
    event,
    expiresAt: record.expiresAt,
  };
}

function pendingStorageKey(walletAddress: string): string {
  return `${PENDING_MIRROR_STORAGE_KEY}:${walletAddress.toLowerCase()}`;
}

function pendingStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Load and validate the short-lived public retry record for one wallet. */
export function loadPendingStagingParticipantMeckyMirror(
  walletAddress: string,
): PendingStagingParticipantMeckyMirror | null {
  if (!WALLET.test(walletAddress)) return null;
  const storage = pendingStorage();
  if (!storage) return null;
  const key = pendingStorageKey(walletAddress);
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const pending = validPending(JSON.parse(raw));
    if (!pending || pending.walletAddress !== walletAddress.toLowerCase()) {
      storage.removeItem(key);
      return null;
    }
    return pending;
  } catch {
    try {
      storage.removeItem(key);
    } catch {
      // Storage can disappear between read and cleanup (private browsing).
    }
    return null;
  }
}

/** Persist only the public retry record; never pass an admission proof here. */
export function savePendingStagingParticipantMeckyMirror(
  pending: PendingStagingParticipantMeckyMirror,
): void {
  const validated = validPending(pending);
  if (!validated) return;
  const storage = pendingStorage();
  if (!storage) return;
  try {
    storage.setItem(
      pendingStorageKey(validated.walletAddress),
      JSON.stringify({ schemaVersion: PENDING_MIRROR_SCHEMA, ...validated }),
    );
  } catch {
    // The in-memory result still gives the caller one retry opportunity.
  }
}

export function clearPendingStagingParticipantMeckyMirror(walletAddress: string): void {
  if (!WALLET.test(walletAddress)) return;
  try {
    pendingStorage()?.removeItem(pendingStorageKey(walletAddress));
  } catch {
    // Storage cleanup is best effort; it is not a security boundary.
  }
}

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
  path: "challenge" | "session" | "posts" | "comments" | "nostr-post",
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

export async function mirrorStagingParticipantMeckyPost(input: Readonly<{
  sourcePost: Pick<Post, "id" | "content">;
  session?: CitizenSession;
  meckyPubkey?: string;
  retry?: PendingStagingParticipantMeckyMirror;
}>): Promise<StagingParticipantResult<{ status: "published"; eventId: string }> & {
  pending?: PendingStagingParticipantMeckyMirror;
}> {
  const meckyPubkey = (input.meckyPubkey ?? process.env.NEXT_PUBLIC_STAGING_PARTICIPANT_MECKY_PUBKEY ?? "").toLowerCase();
  if (!/^[0-9a-f]{64}$/u.test(meckyPubkey)) {
    return { success: false, error: "Mecky ist für diese Staging-Teilnahme noch nicht konfiguriert" };
  }
  let pendingForRetry: PendingStagingParticipantMeckyMirror | undefined;
  try {
    const session = input.session;
    if (!session) {
      return {
        success: false,
        error: "Die aktuelle Testteilnahme kann nicht sicher bestätigt werden",
        pending: input.retry,
      };
    }
    const walletAddress = session.snapshot.credential.address.toLowerCase();
    if (!WALLET.test(walletAddress)) {
      return {
        success: false,
        error: "Die aktuelle Testteilnahme kann nicht sicher bestätigt werden",
        pending: input.retry,
      };
    }
    const pending = input.retry ?? await (async () => {
      // The source row already exists at this point. The gateway independently
      // proves ownership/content before it is allowed to forward either proof.
      // Save the public event before requesting the wallet-bound admission proof
      // so a rejected signature still leaves a safe, exact retry available.
      const event = await session.signConversationMention({
        content: input.sourcePost.content,
        createdAt: Math.floor(Date.now() / 1_000),
        agentPubkey: meckyPubkey,
        sourceAppPostId: input.sourcePost.id,
      });
      const created: PendingStagingParticipantMeckyMirror = {
        schemaVersion: PENDING_MIRROR_SCHEMA,
        sourcePost: {
          id: input.sourcePost.id,
          content: input.sourcePost.content,
        },
        requestId: newRequestId(),
        walletAddress,
        event,
        expiresAt: Date.now() + PENDING_MIRROR_TTL_MS,
      };
      pendingForRetry = created;
      savePendingStagingParticipantMeckyMirror(created);
      return created;
    })();
    pendingForRetry = pending;
    if (!pending || pending.sourcePost.id !== input.sourcePost.id ||
      pending.sourcePost.content !== input.sourcePost.content ||
      pending.walletAddress !== walletAddress ||
      !validPending(pending)) {
      if (input.retry) clearPendingStagingParticipantMeckyMirror(walletAddress);
      return { success: false, error: "Die signierte Mecky-Anfrage kann nicht sicher wiederhergestellt werden" };
    }
    // The proof is intentionally ephemeral. A retry uses the exact public
    // event/request while asking the current session to sign a fresh proof.
    const admissionProof = await session.createAdmissionProof();
    const result = await request(
      "nostr-post",
      {
        schemaVersion: NOSTR_POST_SCHEMA,
        requestId: pending.requestId,
        sourcePostId: pending.sourcePost.id,
        admissionProof,
        event: pending.event,
      },
      "Der Beitrag ist veröffentlicht, aber Mecky konnte noch nicht sicher erreicht werden",
      true,
    );
    if (result.success) {
      clearPendingStagingParticipantMeckyMirror(walletAddress);
      return result;
    }
    savePendingStagingParticipantMeckyMirror(pending);
    return { ...result, pending };
  } catch {
    return {
      success: false,
      error: "Der Beitrag ist veröffentlicht, aber Mecky konnte noch nicht sicher erreicht werden",
      pending: pendingForRetry ?? input.retry,
    };
  }
}
