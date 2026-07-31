import type { OrgRole } from "../../types/account";

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

/**
 * Every role `account_owners.role` can hold, and therefore every Nextcloud
 * group the keystone's claims resolver can emit for a given org —
 * `org:<accountId>:<role>`, built verbatim from that column
 * (apps/roebel-id/src/claims/resolver.ts: groups.push(`org:${accountId}:${role}`)
 * for every `account_owners` row). Nextcloud provisions a citizen's group
 * memberships straight from this claim, so `ensureOrgFolder` must bind the
 * shared folder to every group in this list, not just one — binding only
 * `:member` left an org's owner (role "owner", the DB default for whoever
 * created it) in a Nextcloud group the folder was never bound to, so their
 * own org's files 404'd for them. `OrgRole` (../../types/account) is the
 * app-wide source of truth for the vocabulary.
 */
export const ORG_ROLES: readonly OrgRole[] = ["owner", "admin", "member"];

/** The claim the keystone emits for org membership at a given role. */
export function orgGroupId(accountId: string, role: OrgRole = "member"): string {
  return `org:${accountId}:${role}`;
}

/**
 * The keystone's claim for a verified citizen. Emitted verbatim from the chain
 * read in apps/roebel-id/src/claims/resolver.ts:
 * `if (status.citizen) groups.push('citizen')`. Exact string, no prefix — an
 * org claim is `org:<id>:<role>` and can never collide with it.
 */
export const CITIZEN_GROUP = "citizen";

/**
 * Whether this session belongs to a verified citizen.
 *
 * The `groups` claim is the source of truth, not the app's own
 * `users.is_verified_citizen` column (which is documented to lag on-chain
 * reality) and not anything the browser sends. The claim was minted by the
 * keystone from a live contract read at login, and it is signed.
 */
export function isCitizenSession(session: WorkspaceSession): boolean {
  return session.groups.includes(CITIZEN_GROUP);
}

/** Any role in the org grants workspace access; the folder ACL narrows it. */
export function hasOrgAccess(
  session: WorkspaceSession,
  accountId: string,
): boolean {
  const prefix = `org:${accountId}:`;
  return session.groups.some((group) => group.startsWith(prefix));
}

/** owner outranks admin outranks member — used to pick a winner when a
 * session somehow carries more than one role claim for the same org. */
const ROLE_RANK: Record<OrgRole, number> = { owner: 3, admin: 2, member: 1 };

/**
 * The citizen's role in a given org, or `null` if they hold no claim for it
 * at all. When more than one `org:<accountId>:<role>` claim is present for
 * the same org — which should not normally happen, but the claim is
 * attacker-adjacent input from a token, not a database row — the highest
 * role wins rather than the first or last one encountered, so a stale lower
 * role sitting alongside a fresh higher one can never accidentally narrow
 * access below what the citizen actually holds.
 *
 * This is the source `resolveScope` reads to decide `WorkspaceScope.canWrite`
 * (owner/admin write, member reads) and, per Task 11, the same mapping
 * Nextcloud's own ACL applies.
 */
export function orgRole(
  session: WorkspaceSession,
  accountId: string,
): OrgRole | null {
  const prefix = `org:${accountId}:`;
  let best: OrgRole | null = null;
  for (const group of session.groups) {
    if (!group.startsWith(prefix)) continue;
    const role = group.slice(prefix.length) as OrgRole;
    if (ORG_ROLES.includes(role) && (!best || ROLE_RANK[role] > ROLE_RANK[best])) {
      best = role;
    }
  }
  return best;
}
