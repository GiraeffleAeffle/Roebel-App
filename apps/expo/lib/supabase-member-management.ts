import { supabase } from './supabase';
import { fetchAccountOwners, removeOwner } from './supabase-accounts';
import { callOrgMembership, type SigningAccount } from './org-membership';
import type { MemberWithProfile, UserRecord } from './types';

/** Fetch all members of an account with their user profiles. */
export async function fetchMembersWithProfiles(accountId: string): Promise<MemberWithProfile[]> {
  const { data, error } = await (supabase.from('account_owners') as any)
    .select('*')
    .eq('account_id', accountId)
    .order('joined_at', { ascending: true });

  if (error) {
    console.error('fetchMembersWithProfiles error:', error);
    return [];
  }

  const owners = data as Array<{
    account_id: string;
    wallet_address: string;
    role: 'owner' | 'admin' | 'member';
    invited_by: string | null;
    joined_at: string;
  }>;

  // Fetch user profiles for each member
  const enriched: MemberWithProfile[] = await Promise.all(
    owners.map(async (owner) => {
      const { data: userData } = await supabase
        .from('users')
        .select('username, profile_picture_url, tier')
        .eq('wallet_address', owner.wallet_address)
        .maybeSingle();

      return {
        ...owner,
        user: userData || { username: null, profile_picture_url: null, tier: 'guest' as const },
      } as MemberWithProfile;
    })
  );

  return enriched;
}

/**
 * Remove a member from an org (owner/admin action, or self-removal). Signed
 * by `account`; threads through to removeOwner, which calls the
 * org-membership edge function — no client-side pre-check needed, the edge
 * function enforces the owner/admin gate and the last-owner invariant.
 */
export async function removeMember(
  account: SigningAccount,
  accountId: string,
  walletAddress: string
): Promise<void> {
  await removeOwner(account, accountId, walletAddress);
}

/**
 * Leave an org voluntarily. Signed by `account` (the leaving wallet is
 * derived server-side from the signature, never passed in the payload). The
 * local owner-count check is a fast client-side UX shortcut only — the
 * server enforces the real last-owner invariant via `delete_owner_guarded`
 * and returns LAST_OWNER if this check was stale.
 */
export async function leaveOrg(account: SigningAccount, accountId: string): Promise<void> {
  const walletAddress = account.address.toLowerCase();
  const owners = await fetchAccountOwners(accountId);
  const ownerCount = owners.filter((o) => o.role === 'owner').length;
  const myRole = owners.find(
    (o) => o.wallet_address.toLowerCase() === walletAddress
  )?.role;

  const lastOwnerMessage =
    'Du bist der einzige Inhaber. Übertrage die Inhaberschaft, bevor du die Organisation verlässt.';

  if (myRole === 'owner' && ownerCount <= 1) {
    throw new Error(lastOwnerMessage);
  }

  const res = await callOrgMembership(account, 'leave', { accountId });
  if (!res.ok) {
    if (res.code === 'LAST_OWNER') throw new Error(lastOwnerMessage);
    console.error('leaveOrg error:', res.code, res.message);
    throw new Error(res.message || res.code || 'leaveOrg failed');
  }
}

/** Search users by name for the invite flow (excludes existing members). */
export async function searchUsersForInvite(
  query: string,
  excludeWallets: string[]
): Promise<Pick<UserRecord, 'wallet_address' | 'username' | 'profile_picture_url' | 'tier'>[]> {
  if (!query || query.length < 2) return [];

  const { data, error } = await supabase
    .from('users')
    .select('wallet_address, username, profile_picture_url, tier')
    .not('username', 'is', null)
    .ilike('username', `%${query}%`)
    .limit(20);

  if (error) {
    console.error('searchUsersForInvite error:', error);
    return [];
  }

  const normalizedExclude = new Set(excludeWallets.map((w) => w.toLowerCase()));

  return (data || []).filter(
    (u: any) => !normalizedExclude.has(u.wallet_address?.toLowerCase())
  );
}
