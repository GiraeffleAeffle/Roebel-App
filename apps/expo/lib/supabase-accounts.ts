/**
 * Account system Supabase operations
 *
 * Writes that change membership or account identity (create, update,
 * remove-owner) go through the org-membership edge function — every such
 * call is a signed message from the caller's wallet, verified server-side
 * before anything is written. See apps/expo/lib/org-membership.ts and
 * apps/expo/supabase/functions/org-membership/index.ts.
 */
import { supabase } from './supabase';
import type { Account, AccountOwner, OrgSubType } from './types';
import { callOrgMembership, type SigningAccount } from './org-membership';

export type CreateOrgAccountOptions = {
  /** Mark this org as extern (non-Röbel). Stored as extern_status='pending'. */
  isExtern?: boolean;
  /** Contact email for approval notifications. */
  contactEmail?: string | null;
  /** Free-text "why I want an account" — shown to admin reviewer. */
  reason?: string | null;
  /** Optional bio/description. */
  bio?: string | null;
};

// ── Fetch ────────────────────────────────────────────────────

export async function fetchAccountById(accountId: string): Promise<Account | null> {
  const { data, error } = await supabase
    .from('accounts' as any)
    .select('*')
    .eq('id', accountId)
    .single();

  if (error) {
    console.error('fetchAccountById error:', error);
    return null;
  }
  return data as Account;
}

export async function fetchOrgAccountsBySubType(subType: OrgSubType): Promise<Account[]> {
  const { data, error } = await supabase
    .from('accounts' as any)
    .select('*')
    .eq('account_type', 'organisation')
    .eq('sub_type', subType)
    .order('name', { ascending: true });

  if (error) {
    console.error('fetchOrgAccountsBySubType error:', error);
    return [];
  }
  return (data as Account[]) ?? [];
}

export async function fetchOwnedAccounts(walletAddress: string): Promise<Account[]> {
  const { data, error } = await supabase
    .from('account_owners' as any)
    .select('account_id, accounts:account_id(*)')
    .eq('wallet_address', walletAddress.toLowerCase());

  if (error) {
    console.error('fetchOwnedAccounts error:', error);
    return [];
  }

  return (data as any[]).map((row) => row.accounts).filter(Boolean) as Account[];
}

export async function fetchAccountOwners(accountId: string): Promise<AccountOwner[]> {
  const { data, error } = await supabase
    .from('account_owners' as any)
    .select('*')
    .eq('account_id', accountId);

  if (error) {
    console.error('fetchAccountOwners error:', error);
    return [];
  }
  return data as AccountOwner[];
}

export async function isAccountOwner(accountId: string, walletAddress: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('account_owners' as any)
    .select('account_id')
    .eq('account_id', accountId)
    .eq('wallet_address', walletAddress.toLowerCase())
    .maybeSingle();

  if (error) {
    console.error('isAccountOwner error:', error);
    return false;
  }
  return !!data;
}

// ── Create ───────────────────────────────────────────────────

/**
 * Create the caller's personal account (first login). Signed by `account`;
 * the edge function makes the signer the first (and only) owner. The
 * account row it returns is used as-is — no client-side second insert.
 */
export async function createPersonalAccount(
  account: SigningAccount,
  name: string,
  avatarUrl?: string | null
): Promise<Account | null> {
  const normalized = account.address.toLowerCase();

  const res = await callOrgMembership<Account>(account, 'create_account', {
    accountType: 'personal',
    name,
    avatarUrl: avatarUrl ?? undefined,
  });

  if (!res.ok || !res.data) {
    console.error('createPersonalAccount error:', res.code, res.message);
    return null;
  }

  const acc = res.data;

  // Set as active account
  const { error: activeError } = await supabase
    .from('users')
    .update({ active_account_id: acc.id })
    .eq('wallet_address', normalized);
  if (activeError) {
    console.error('createPersonalAccount active-account update error:', activeError);
  }

  return acc;
}

/**
 * Create a new organisation account. Signed by `account`; the edge function
 * makes the signer the first owner, generates the slug, and enforces the
 * self-service sub_type whitelist (restaurant/unternehmen/verein/journalist —
 * 'stadt'/'fraktion' are administrator-issued only).
 */
export async function createOrgAccount(
  account: SigningAccount,
  subType: OrgSubType,
  name: string,
  options: CreateOrgAccountOptions = {}
): Promise<Account | null> {
  const res = await callOrgMembership<Account>(account, 'create_account', {
    accountType: 'organisation',
    subType,
    name,
    bio: options.bio ?? undefined,
    contactEmail: options.contactEmail ?? undefined,
    isExtern: options.isExtern ?? undefined,
    reason: options.reason ?? undefined,
  });

  if (!res.ok || !res.data) {
    console.error('createOrgAccount error:', res.code, res.message);
    return null;
  }

  return res.data;
}

// ── Switch ───────────────────────────────────────────────────

export async function switchActiveAccount(walletAddress: string, accountId: string): Promise<void> {
  const { error } = await supabase
    .from('users')
    .update({ active_account_id: accountId })
    .eq('wallet_address', walletAddress.toLowerCase());

  if (error) {
    console.error('switchActiveAccount error:', error);
    throw error;
  }
}

// ── Remove owner ─────────────────────────────────────────────

/**
 * Remove a member from an account (owner/admin action, or self-removal).
 * Signed by `account`. The edge function enforces the owner/admin gate,
 * the "only an owner can remove an owner" rule, and the last-owner
 * invariant server-side (via the guarded `delete_owner_guarded` RPC) — no
 * client-side pre-check needed.
 */
export async function removeOwner(
  account: SigningAccount,
  accountId: string,
  walletAddress: string
): Promise<void> {
  const res = await callOrgMembership(account, 'remove_member', {
    accountId,
    memberWallet: walletAddress,
  });

  if (!res.ok) {
    console.error('removeOwner error:', res.code, res.message);
    throw new Error(res.message || res.code || 'removeOwner failed');
  }
}

// ── Delete ───────────────────────────────────────────────────
// Org self-service deletion — NOT part of the org-membership edge function
// contract (no `delete_account` action exists there; see
// apps/expo/supabase/functions/org-membership/index.ts's ACTIONS list).
// Left as a direct write out of Task 6's scope (the reference web app has
// no equivalent org-deletion feature at all). This call still relies on
// pre-lockdown anon-key RLS and will need its own follow-up once
// supabase/migrations/20260802_account_membership_lockdown.sql closes
// anon-key writes on `accounts`.

export async function deleteAccount(accountId: string): Promise<void> {
  // .select() forces Supabase to return the deleted rows so we can verify
  // the operation actually affected the DB. RLS without a DELETE policy
  // silently denies the statement (success, 0 rows) — without this check
  // the caller would think it succeeded and de-sync local state from the DB.
  const { data, error } = await supabase
    .from('accounts' as any)
    .delete()
    .eq('id', accountId)
    .select('id');

  if (error) {
    console.error('deleteAccount error:', error);
    throw error;
  }
  if (!data || data.length === 0) {
    throw new Error(
      'Konto konnte nicht gelöscht werden (keine Berechtigung oder bereits entfernt).',
    );
  }
}

// ── Update ───────────────────────────────────────────────────

/**
 * Update an account's editable fields. Signed by `account`; the edge
 * function enforces the owner/admin gate and the field whitelist
 * (name/bio/avatar_url/cover_url/contact_email/opening_hours) server-side.
 * Uses the updated row the edge function returns directly — no re-fetch,
 * so this keeps working once the lockdown migration closes anon-key reads.
 */
export async function updateAccount(
  account: SigningAccount,
  accountId: string,
  updates: Partial<
    Pick<Account, 'name' | 'bio' | 'avatar_url' | 'cover_url' | 'opening_hours' | 'contact_email'>
  >
): Promise<Account | null> {
  const res = await callOrgMembership<Account>(account, 'update_account', {
    accountId,
    updates,
  });

  if (!res.ok) {
    console.error('updateAccount error:', res.code, res.message);
    throw new Error(res.message || res.code || 'updateAccount failed');
  }

  return res.data ?? (await fetchAccountById(accountId));
}
