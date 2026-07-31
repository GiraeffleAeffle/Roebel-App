/**
 * Invite token management — mirrors apps/web/src/lib/supabase-invites.ts
 *
 * Writes (create/revoke/accept/decline) go through the org-membership edge
 * function (apps/expo/supabase/functions/org-membership/index.ts): a signed
 * message from the caller's wallet, verified server-side before anything is
 * written. See apps/expo/lib/org-membership.ts.
 *
 * Reads prefer the same edge function / a dedicated RPC, with a read-only
 * fallback to the direct invite_tokens query for the deploy window before
 * supabase/migrations/20260802_account_membership_lockdown.sql lands (see
 * the "Fallback" section below). Writes NEVER fall back — they require the
 * edge function, full stop.
 */
import { supabase } from './supabase';
import { callOrgMembership, type SigningAccount } from './org-membership';
import type { InviteToken, InviteTokenWithUser, InviteTokenWithAccount, Account } from './types';

const ERROR_MESSAGES_DE: Record<string, string> = {
  EXPIRED: 'Diese Einladung ist abgelaufen',
  CONFLICT: 'Diese Einladung ist nicht mehr gültig',
  NOT_FOUND: 'Einladung nicht gefunden',
  FORBIDDEN: 'Diese Einladung ist nicht für diese Wallet bestimmt',
  INVITE_GONE: 'Diese Einladung wurde bereits bearbeitet',
};

function orgErrorMessage(res: { code?: string; message?: string }, fallback: string): string {
  return (res.code && ERROR_MESSAGES_DE[res.code]) || res.message || res.code || fallback;
}

// ── Create ──────────────────────────────────────────────────────────

/**
 * Create an in-app invite (notifies `invitedWallet`). Signed by `account`;
 * `invitedBy` is derived server-side from the verified signer, so it's no
 * longer a parameter. The edge function inserts invite_tokens + a
 * notification row and enforces the owner/admin gate.
 */
export async function createInAppInvite(
  account: SigningAccount,
  accountId: string,
  invitedWallet: string,
  role: 'admin' | 'member',
  expiresInDays = 7
): Promise<InviteToken> {
  const res = await callOrgMembership<InviteToken>(account, 'create_invite', {
    accountId,
    role,
    invitedWallet: invitedWallet.toLowerCase(),
    expiresInDays,
  });

  if (!res.ok || !res.data) {
    throw new Error(orgErrorMessage(res, 'Fehler beim Senden der Einladung'));
  }
  return res.data;
}

/**
 * Create a link invite (no target wallet — returns the token for the share
 * URL). Signed by `account`; same edge-function path as createInAppInvite
 * with `invitedWallet: null`, which skips the notification insert.
 */
export async function createLinkInvite(
  account: SigningAccount,
  accountId: string,
  role: 'admin' | 'member',
  expiresInDays = 7
): Promise<InviteToken> {
  const res = await callOrgMembership<InviteToken>(account, 'create_invite', {
    accountId,
    role,
    invitedWallet: null,
    expiresInDays,
  });

  if (!res.ok || !res.data) {
    throw new Error(orgErrorMessage(res, 'Fehler beim Erstellen des Links'));
  }
  return res.data;
}

// ── Resolve ─────────────────────────────────────────────────────────

/** Accept an invite. Signed by `account` — the edge function verifies the
 * invite is addressed to the signer (or unaddressed link invite), atomically
 * claims it, and raises the signer's role without ever demoting it. */
export async function acceptInvite(account: SigningAccount, inviteId: string): Promise<void> {
  const res = await callOrgMembership(account, 'accept_invite', { inviteId });
  if (!res.ok) {
    throw new Error(orgErrorMessage(res, 'Fehler beim Annehmen'));
  }
}

/** Decline an invite. Signed by `account` — the edge function verifies the
 * invite is addressed to the signer before marking it declined. */
export async function declineInvite(account: SigningAccount, inviteId: string): Promise<void> {
  const res = await callOrgMembership(account, 'decline_invite', { inviteId });
  if (!res.ok) {
    throw new Error(orgErrorMessage(res, 'Fehler beim Ablehnen'));
  }
}

/** Revoke a pending invite (owner/admin action). Signed by `account`. */
export async function revokeInvite(account: SigningAccount, inviteId: string): Promise<void> {
  const res = await callOrgMembership(account, 'revoke_invite', { inviteId });
  if (!res.ok) {
    throw new Error(orgErrorMessage(res, 'Fehler beim Widerrufen'));
  }
}

// ── Fallback (read-only) ───────────────────────────────────────────
// The edge-function actions and the get_invite_by_token RPC above are only
// live once supabase/migrations/20260801_membership_functions.sql (the RPC)
// and the org-membership edge function are both deployed. Until then, direct
// queries against invite_tokens still work under the pre-lockdown RLS
// policies. These three helpers are the ONLY places in this file allowed to
// touch invite_tokens directly, and only for reads — writes never fall back,
// they require the edge function. Once
// supabase/migrations/20260802_account_membership_lockdown.sql closes
// anon-key reads on invite_tokens, these fallbacks stop working (by design,
// per that migration's header) and should be deleted.

function isRpcMissingError(error: { code?: string } | null): boolean {
  if (!error) return false;
  // PGRST202: PostgREST "no matching function" (schema cache miss).
  // 42883: Postgres "undefined function" (function genuinely doesn't exist).
  return error.code === 'PGRST202' || error.code === '42883';
}

/**
 * Normalize the get_invite_by_token RPC result. The RPC's Postgres function
 * is declared `returns invite_tokens` — a single composite row, not
 * SETOF — so an unmatched token comes back as a truthy all-NULL row
 * (`{"id":null,...}`), never `null` itself. A plain `if (!invite)` guard
 * never catches that shape, so an unknown token used to render as an
 * expired invite (new Date(null) => 1970) instead of "not found".
 * Defensively also unwraps an array, in case the RPC's return type is ever
 * changed to SETOF invite_tokens.
 */
export function normalizeInviteRpcRow(data: unknown): InviteToken | null {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== 'object') return null;
  if (!(row as { id?: unknown }).id) return null;
  return row as InviteToken;
}

async function fallbackFetchInviteRow(token: string): Promise<InviteToken | null> {
  const { data, error } = await supabase
    .from('invite_tokens' as any)
    .select('*')
    .eq('token', token)
    .maybeSingle();
  if (error || !data) return null;
  return data as InviteToken;
}

async function fallbackFetchPendingInvites(accountId: string): Promise<InviteToken[]> {
  const { data, error } = await supabase
    .from('invite_tokens' as any)
    .select('*')
    .eq('account_id', accountId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });
  if (error) return [];
  return data as InviteToken[];
}

async function fallbackHasPendingInvite(accountId: string, walletAddress: string): Promise<boolean> {
  const { data } = await supabase
    .from('invite_tokens' as any)
    .select('id')
    .eq('account_id', accountId)
    .eq('invited_wallet', walletAddress.toLowerCase())
    .eq('status', 'pending')
    .maybeSingle();
  return !!data;
}

// ── Queries ─────────────────────────────────────────────────────────

async function enrichInvitesWithUsers(invites: InviteToken[]): Promise<InviteTokenWithUser[]> {
  return Promise.all(
    invites.map(async (inv) => {
      if (!inv.invited_wallet) return inv;

      const { data: userData } = await supabase
        .from('users')
        .select('username, profile_picture_url, tier')
        .eq('wallet_address', inv.invited_wallet)
        .maybeSingle();

      return { ...inv, invited_user: userData || undefined } as InviteTokenWithUser;
    })
  );
}

/**
 * Fetch pending invites for an account (owner/admin action). Signed by
 * `account`; prefers the edge function's "list_invites" action, which
 * enforces the owner/admin gate server-side. Falls back to the direct query
 * only when the edge function is unreachable/not deployed yet.
 */
export async function fetchPendingInvites(
  account: SigningAccount,
  accountId: string
): Promise<InviteTokenWithUser[]> {
  const res = await callOrgMembership<InviteToken[]>(account, 'list_invites', { accountId });

  if (res.ok) {
    return enrichInvitesWithUsers(res.data ?? []);
  }

  if (res.code === 'NETWORK_ERROR') {
    return enrichInvitesWithUsers(await fallbackFetchPendingInvites(accountId));
  }

  console.error('fetchPendingInvites error:', res.code, res.message);
  return [];
}

/**
 * Fetch an invite by its bearer token. NOT signed — knowledge of the token
 * is the credential, matching the anon-callable get_invite_by_token RPC
 * (the one RPC in this pair of migrations that takes no wallet parameter).
 * Falls back to the direct query if the RPC hasn't been deployed yet.
 */
export async function fetchInviteByToken(token: string): Promise<InviteTokenWithAccount | null> {
  let invite: InviteToken | null = null;

  const { data, error } = await supabase.rpc('get_invite_by_token' as any, { p_token: token });
  if (!error) {
    invite = normalizeInviteRpcRow(data);
  } else if (isRpcMissingError(error)) {
    invite = await fallbackFetchInviteRow(token);
  } else {
    console.error('fetchInviteByToken rpc error:', error);
    return null;
  }

  if (!invite) return null;

  const { data: account } = await supabase
    .from('accounts' as any)
    .select('*')
    .eq('id', invite.account_id)
    .single();

  const { data: inviter } = await supabase
    .from('users')
    .select('username, profile_picture_url')
    .eq('wallet_address', invite.invited_by)
    .maybeSingle();

  return {
    ...invite,
    account: account as Account,
    inviter: inviter || undefined,
  };
}

/**
 * Check if the SIGNER already has a pending invite for this account (answers
 * for the signer only — the edge function does not accept an arbitrary
 * wallet to check, which would otherwise leak other wallets' invite status).
 * Signed by `account`. Falls back to the direct query only when the edge
 * function is unreachable/not deployed yet.
 */
export async function hasPendingInvite(account: SigningAccount, accountId: string): Promise<boolean> {
  const res = await callOrgMembership<{ pending: boolean }>(account, 'has_pending_invite', {
    accountId,
  });

  if (res.ok) return !!res.data?.pending;

  if (res.code === 'NETWORK_ERROR') {
    return fallbackHasPendingInvite(accountId, account.address);
  }

  console.error('hasPendingInvite error:', res.code, res.message);
  return false;
}
