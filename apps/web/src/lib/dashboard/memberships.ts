import type { Account } from "../../types/account";
import { isOrgAccount, SUB_TYPE_LABELS, SUB_TYPE_EMOJI } from "../../types/account";

export type MembershipKind = "citizenship" | "organisation";

/**
 * A single membership row — the SSI portfolio, shaped for many, populated with
 * what exists today (Röbel citizenship + org memberships). `name` is ALWAYS a
 * display name, never a raw wallet address.
 */
export interface Membership {
  id: string;
  kind: MembershipKind;
  name: string;
  subtitle: string;
  emoji: string;
  avatarUrl: string | null;
  verified: boolean;
  href: string | null;
}

export interface BuildMembershipListInput {
  /** True when the user holds a CitizenNFT / has tier citizen. */
  isCitizen: boolean;
  /** Accounts the wallet owns (from AccountContext / account_owners). */
  ownedAccounts: Account[];
}

/**
 * Union of on-chain citizenship + org memberships. Personal accounts are
 * skipped (they are not a "membership"). Pure — no I/O, no wallet strings.
 */
export function buildMembershipList(
  input: BuildMembershipListInput
): Membership[] {
  const memberships: Membership[] = [];

  if (input.isCitizen) {
    memberships.push({
      id: "roebel-citizenship",
      kind: "citizenship",
      name: "Röbel/Müritz",
      subtitle: "Verifizierte Bürgerschaft",
      emoji: "🏛️",
      avatarUrl: null,
      verified: true,
      href: "/app/proposals",
    });
  }

  for (const account of input.ownedAccounts) {
    if (!isOrgAccount(account)) continue;
    memberships.push({
      id: account.id,
      kind: "organisation",
      name: account.name,
      subtitle: account.sub_type
        ? SUB_TYPE_LABELS[account.sub_type]
        : "Organisation",
      emoji: account.sub_type ? SUB_TYPE_EMOJI[account.sub_type] : "🏢",
      avatarUrl: account.avatar_url,
      verified: account.is_verified,
      // Link to the org's public page when it has a slug; otherwise no link
      // (never a bare "/dashboard", which would route to whatever org is
      // currently active — not necessarily this one).
      href: account.slug ? `/app/orgs/${account.slug}` : null,
    });
  }

  return memberships;
}
