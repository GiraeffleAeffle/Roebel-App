/**
 * The citizen's workspace session. Stored server-side (see session-store.ts);
 * the cookie and the WOPI token carry only an opaque id.
 *
 * Server-side because Collabora calls the WOPI endpoints itself, with no
 * browser cookie — a cookie-only session is unreadable exactly where a
 * document load needs it. Two properties follow for free: no token ever
 * reaches the browser, and a long edit can be refreshed mid-session.
 */
export interface WorkspaceSession {
  /** OIDC `sub` — the smart-account address, which is also the Nextcloud uid. */
  sub: string;
  /** The keystone's `groups` claim: citizen, attester, org:<accountId>:<role>. */
  groups: string[];
  accessToken: string;
  refreshToken: string | null;
  /** Epoch milliseconds. */
  expiresAt: number;
}

/** Refresh this far before real expiry so a token cannot die mid-request. */
const SKEW_MS = 30_000;

/**
 * A fresh session id. Possessing this id IS the session, so it is 32 bytes of
 * CSPRNG output — not a counter, a uuid v4, or anything derived from the user.
 */
export function newSessionId(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString(
    "base64url",
  );
}

export function isExpired(session: WorkspaceSession, nowMs: number): boolean {
  return nowMs >= session.expiresAt - SKEW_MS;
}

/**
 * The session is keyed to `sub`. Without this check, switching wallets in the
 * app would leave the previous citizen's files on screen — an identity bug, not
 * a caching bug.
 */
export function sessionMatchesWallet(
  session: WorkspaceSession,
  wallet: string,
): boolean {
  return session.sub.toLowerCase() === wallet.toLowerCase();
}

/** The claim the keystone emits for org membership. */
export function orgGroupId(accountId: string): string {
  return `org:${accountId}:member`;
}

/** Any role in the org grants workspace access; the folder ACL narrows it. */
export function hasOrgAccess(
  session: WorkspaceSession,
  accountId: string,
): boolean {
  const prefix = `org:${accountId}:`;
  return session.groups.some((group) => group.startsWith(prefix));
}
