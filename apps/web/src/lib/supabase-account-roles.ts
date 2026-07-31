/**
 * Account role helpers — mirrors apps/expo/lib/supabase-account-roles.ts
 */

import { supabase } from "./supabase";
import { callOrgMembership, type SigningAccount } from "./org-membership/client";
import type { OrgRole } from "@/types/account";

export type AccountRole = OrgRole;

/** Get a user's role in an account. Returns null if not a member. */
export async function getAccountRole(
  accountId: string,
  walletAddress: string
): Promise<AccountRole | null> {
  const { data } = await supabase
    .from("account_owners")
    .select("role")
    .eq("account_id", accountId)
    .eq("wallet_address", walletAddress.toLowerCase())
    .maybeSingle();

  return (data?.role as AccountRole) ?? null;
}

/** Check if a role can edit/delete events. */
export function canEditEvents(role: AccountRole | null): boolean {
  return role === "owner" || role === "admin";
}

/** Check if a role can edit/delete listings and deals. */
export function canEditListings(role: AccountRole | null): boolean {
  return role === "owner" || role === "admin";
}

/** Check if a role can manage members (invite/remove/change roles). */
export function canManageMembers(role: AccountRole | null): boolean {
  return role === "owner";
}

/** Check if a user can leave an org (not the sole owner). */
export function canLeaveOrg(
  role: AccountRole | null,
  ownerCount: number
): boolean {
  if (!role) return false;
  if (role === "owner" && ownerCount <= 1) return false;
  return true;
}

/**
 * Update a member's role in an account. Signed by `account`; the edge
 * function enforces that only an owner may change roles (admins may not —
 * see apps/expo/supabase/functions/org-membership/index.ts requireOwner) and
 * that the sole remaining owner cannot be demoted away.
 */
export async function updateMemberRole(
  account: SigningAccount,
  accountId: string,
  walletAddress: string,
  newRole: AccountRole
): Promise<void> {
  const res = await callOrgMembership(account, "update_member_role", {
    accountId,
    memberWallet: walletAddress,
    role: newRole,
  });

  if (!res.ok) {
    console.error("updateMemberRole error:", res.code, res.message);
    throw new Error(res.message || res.code || "updateMemberRole failed");
  }
}
