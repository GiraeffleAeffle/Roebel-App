import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const PARTICIPANT_LABEL =
  "Staging-Testteilnahme – keine Bürgerverifikation, kein Stimmrecht";
export const CHALLENGE_COOKIE = "roebel_staging_participant_challenge";
export const SESSION_COOKIE = "roebel_staging_participant_session";
export const CHALLENGE_TTL_SECONDS = 5 * 60;
export const SESSION_TTL_SECONDS = 2 * 60 * 60;
export const MAX_PENDING_CHALLENGES = 256;

export type ChallengeClaim = Readonly<{
  kind: "roebel_staging_participant_challenge_v1";
  id: string;
  walletAddress: string;
  issuedAt: number;
  expiresAt: number;
}>;

export type SessionClaim = Readonly<{
  kind: "roebel_staging_participant_session_v1";
  walletAddress: string;
  issuedAt: number;
  expiresAt: number;
  scope: "main_text_post_comment";
}>;

export type ChallengeStore = Map<string, Readonly<{
  walletAddress: string;
  expiresAt: number;
  consumed: boolean;
}>>;

/**
 * Keep the first single-replica implementation bounded even if an invite is
 * leaked. Reissuing for one wallet replaces its prior pending challenge.
 */
export function prepareChallengeStore(
  store: ChallengeStore,
  nowSeconds: number,
  walletAddress: string,
): void {
  for (const [id, value] of store) {
    if (value.consumed || value.expiresAt <= nowSeconds || value.walletAddress === walletAddress) {
      store.delete(id);
    }
  }
  if (store.size >= MAX_PENDING_CHALLENGES) {
    throw new Error("staging_participant_challenge_capacity_reached");
  }
}

export function normalizeWallet(value: unknown): string | null {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/u.test(value)) return null;
  return value.toLowerCase();
}

export function validInvite(invite: unknown, expectedSha256: string): boolean {
  if (typeof invite !== "string" || !/^[a-f0-9]{64}$/iu.test(expectedSha256)) return false;
  const plainHash = createHashSha256(invite);
  return safeEqualHex(plainHash, expectedSha256);
}

function createHashSha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function safeEqualHex(left: string, right: string): boolean {
  if (!/^[a-f0-9]{64}$/iu.test(left) || !/^[a-f0-9]{64}$/iu.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

function base64url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function fromBase64url(value: string): unknown | null {
  try {
    return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
  } catch {
    return null;
  }
}

function sign(payload: string, key: string): string {
  return createHmac("sha256", key).update(payload, "utf8").digest("base64url");
}

export function encodeSignedClaim(claim: ChallengeClaim | SessionClaim, key: string): string {
  const payload = base64url(JSON.stringify(claim));
  return `${payload}.${sign(payload, key)}`;
}

export function decodeSignedChallenge(value: string | undefined, key: string, nowMs: number): ChallengeClaim | null {
  const parsed = decodeSignedClaim(value, key);
  if (!parsed || parsed.kind !== "roebel_staging_participant_challenge_v1") return null;
  if (!validClaimTimes(parsed, nowMs) || typeof parsed.id !== "string" || !/^[a-f0-9]{32}$/u.test(parsed.id)) return null;
  return parsed;
}

export function decodeSignedSession(value: string | undefined, key: string, nowMs: number): SessionClaim | null {
  const parsed = decodeSignedClaim(value, key);
  if (!parsed || parsed.kind !== "roebel_staging_participant_session_v1") return null;
  if (!validClaimTimes(parsed, nowMs) || parsed.scope !== "main_text_post_comment") return null;
  return parsed;
}

function decodeSignedClaim(value: string | undefined, key: string): (ChallengeClaim | SessionClaim) | null {
  if (!value || typeof value !== "string" || key.length < 32) return null;
  const [payload, signature, extra] = value.split(".");
  if (!payload || !signature || extra) return null;
  const expected = sign(payload, key);
  const received = Buffer.from(signature, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  if (received.byteLength !== expectedBuffer.byteLength || !timingSafeEqual(received, expectedBuffer)) return null;
  const raw = fromBase64url(payload);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const walletAddress = normalizeWallet(record.walletAddress);
  if (!walletAddress || typeof record.issuedAt !== "number" || typeof record.expiresAt !== "number") return null;
  return { ...record, walletAddress } as ChallengeClaim | SessionClaim;
}

function validClaimTimes(claim: ChallengeClaim | SessionClaim, nowMs: number): boolean {
  return Number.isSafeInteger(claim.issuedAt) && Number.isSafeInteger(claim.expiresAt) &&
    claim.issuedAt <= nowMs && claim.expiresAt > nowMs &&
    claim.expiresAt - claim.issuedAt <= SESSION_TTL_SECONDS;
}

export function issueChallenge(input: Readonly<{
  walletAddress: string;
  nowMs: number;
  randomId?: () => string;
  key: string;
  store: ChallengeStore;
}>): Readonly<{ claim: ChallengeClaim; token: string }> {
  const id = input.randomId?.() ?? randomBytes(16).toString("hex");
  if (!/^[a-f0-9]{32}$/u.test(id)) throw new Error("staging_participant_challenge_id_invalid");
  const claim: ChallengeClaim = {
    kind: "roebel_staging_participant_challenge_v1",
    id,
    walletAddress: input.walletAddress,
    issuedAt: Math.floor(input.nowMs / 1_000),
    expiresAt: Math.floor(input.nowMs / 1_000) + CHALLENGE_TTL_SECONDS,
  };
  input.store.set(id, { walletAddress: claim.walletAddress, expiresAt: claim.expiresAt, consumed: false });
  return { claim, token: encodeSignedClaim(claim, input.key) };
}

export function consumeChallenge(input: Readonly<{
  claim: ChallengeClaim;
  store: ChallengeStore;
  nowSeconds: number;
}>): boolean {
  const current = input.store.get(input.claim.id);
  if (!current || current.consumed || current.expiresAt <= input.nowSeconds ||
    current.walletAddress !== input.claim.walletAddress || input.claim.expiresAt <= input.nowSeconds) {
    return false;
  }
  input.store.set(input.claim.id, { ...current, consumed: true });
  return true;
}

export function issueSession(walletAddress: string, nowMs: number, key: string): Readonly<{ claim: SessionClaim; token: string }> {
  const issuedAt = Math.floor(nowMs / 1_000);
  const claim: SessionClaim = {
    kind: "roebel_staging_participant_session_v1",
    walletAddress,
    issuedAt,
    expiresAt: issuedAt + SESSION_TTL_SECONDS,
    scope: "main_text_post_comment",
  };
  return { claim, token: encodeSignedClaim(claim, key) };
}

export function challengeMessage(claim: ChallengeClaim): string {
  return [
    "Röbel App Staging-Testteilnahme",
    "Diese Signatur aktiviert ausschließlich einen zeitlich begrenzten Testzugang.",
    "Keine Bürgerverifikation. Kein Stimmrecht. Keine Treasury-, Case- oder Verwaltungsbefugnis.",
    `Wallet: ${claim.walletAddress}`,
    `Challenge: ${claim.id}`,
    `Gültig bis: ${new Date(claim.expiresAt * 1_000).toISOString()}`,
  ].join("\n");
}

export function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return undefined;
}

export function cookie(name: string, value: string, maxAge: number, secure: boolean): string {
  return `${name}=${value}; Path=/; HttpOnly; ${secure ? "Secure; " : ""}SameSite=Strict; Max-Age=${maxAge}`;
}

export function clearCookie(name: string, secure: boolean): string {
  return cookie(name, "", 0, secure);
}
