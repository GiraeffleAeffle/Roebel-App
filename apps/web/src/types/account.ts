/**
 * Account system types — unified account model
 * Matches Supabase accounts + account_owners tables
 * (migrations 005, 007, 010, 011, 20260427)
 */

import type { OpeningHours } from "@/types/business";

// User tiers — unified role system
export type UserTier = "guest" | "tourist" | "citizen";

// Account types (migration 007 simplified to personal/organisation + sub_type)
export type AccountType = "personal" | "organisation";
export type OrgSubType =
  | "restaurant"
  | "unternehmen"
  | "verein"
  | "stadt"
  | "fraktion"
  | "journalist";
/** @deprecated Use OrgSubType instead */
export type OrgType = OrgSubType;

export type ExternStatus = "pending" | "approved" | "rejected";

export interface Account {
  id: string;
  account_type: AccountType;
  sub_type: OrgSubType | null;
  name: string;
  bio: string | null;
  avatar_url: string | null;
  cover_url: string | null;
  is_verified: boolean;
  slug: string | null;
  is_extern: boolean;
  extern_status: ExternStatus | null;
  extern_reason: string | null;
  extern_reviewed_by: string | null;
  extern_reviewed_at: string | null;
  contact_email: string | null;
  opening_hours: OpeningHours | null;
  created_at: string;
  updated_at: string;
}

export type OrgRole = "owner" | "admin" | "member";

export interface AccountOwner {
  account_id: string;
  wallet_address: string;
  role: OrgRole;
  invited_by: string | null;
  joined_at: string;
}

// System account for legacy events
export const SYSTEM_ACCOUNT_ID = "00000000-0000-0000-0000-000000000001";

// ── Invite & notification types ─────────────────────────────────────

export type InviteTokenStatus =
  | "pending"
  | "accepted"
  | "declined"
  | "expired"
  | "revoked";

export interface InviteToken {
  id: string;
  account_id: string;
  role: "admin" | "member";
  invited_by: string;
  invited_wallet: string | null;
  token: string;
  status: InviteTokenStatus;
  expires_at: string;
  created_at: string;
}

export interface InviteTokenWithUser extends InviteToken {
  invited_user?: {
    username: string | null;
    profile_picture_url: string | null;
    tier: UserTier;
  };
}

export interface InviteTokenWithAccount extends InviteToken {
  account: Account;
  inviter?: {
    username: string | null;
    profile_picture_url: string | null;
  };
}

export interface UserNotification {
  id: string;
  recipient_wallet: string;
  type: string;
  title: string;
  body: string;
  metadata: Record<string, unknown>;
  is_read: boolean;
  created_at: string;
}

export interface MemberWithProfile extends AccountOwner {
  user: {
    username: string | null;
    profile_picture_url: string | null;
    tier: UserTier;
  };
}

// ── Labels ──────────────────────────────────────────────────────────

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  personal: "Persönlich",
  organisation: "Organisation",
};

export const SUB_TYPE_LABELS: Record<OrgSubType, string> = {
  restaurant: "Restaurant",
  unternehmen: "Unternehmen",
  verein: "Verein",
  stadt: "Stadt",
  fraktion: "Fraktion",
  journalist: "Journalist:in",
};

export const SUB_TYPE_EMOJI: Record<OrgSubType, string> = {
  restaurant: "🍽️",
  unternehmen: "🏢",
  verein: "🤝",
  stadt: "🏛️",
  fraktion: "⚖️",
  journalist: "📝",
};

// ── Helpers ─────────────────────────────────────────────────────────

export function isOrgAccount(account: Account): boolean {
  return account.account_type === "organisation";
}

/** True for local orgs and approved externs only. */
export function canPublishBlog(account: Account): boolean {
  if (account.account_type !== "organisation") return false;
  if (!account.is_extern) return true;
  return account.extern_status === "approved";
}

/** True if the account is currently waiting on admin approval. */
export function isExternPending(account: Account): boolean {
  return account.is_extern && account.extern_status === "pending";
}

export interface SubTypeFeatures {
  blog: boolean;
  members: boolean;
  openingHours: boolean;
  products: boolean;
  ads: boolean;
  events: boolean;
  partner: boolean;
  speisekarte: boolean;
  storyCollections: boolean;
  proposals: boolean;
  foerdermittel: boolean;
  flyer: boolean;
  workspace: boolean;
}

/** Single source of truth for which dashboard panels each sub_type sees. */
export function subTypeFeatures(
  subType: OrgSubType | null
): SubTypeFeatures {
  switch (subType) {
    case "restaurant":
      return {
        blog: true,
        members: true,
        openingHours: true,
        products: true,
        ads: true,
        events: true,
        partner: true,
        speisekarte: true,
        storyCollections: false,
        proposals: false,
        foerdermittel: true,
        flyer: true,
        workspace: true,
      };
    case "unternehmen":
      return {
        blog: true,
        members: true,
        openingHours: true,
        products: true,
        ads: true,
        events: true,
        partner: true,
        speisekarte: false,
        storyCollections: false,
        proposals: false,
        foerdermittel: true,
        flyer: true,
        workspace: true,
      };
    case "verein":
      return {
        blog: true,
        members: true,
        openingHours: true,
        products: false,
        ads: false,
        events: true,
        partner: true,
        speisekarte: false,
        storyCollections: false,
        proposals: false,
        foerdermittel: true,
        flyer: true,
        workspace: true,
      };
    case "stadt":
      return {
        blog: true,
        members: true,
        openingHours: true,
        products: false,
        ads: false,
        events: true,
        partner: false,
        speisekarte: false,
        storyCollections: true,
        proposals: true,
        foerdermittel: true,
        flyer: true,
        workspace: true,
      };
    case "fraktion":
      return {
        blog: true,
        members: true,
        openingHours: true,
        products: false,
        ads: false,
        events: true,
        partner: false,
        speisekarte: false,
        storyCollections: false,
        proposals: false,
        foerdermittel: false,
        flyer: true,
        workspace: true,
      };
    case "journalist":
      return {
        blog: true,
        members: true,
        openingHours: true,
        products: false,
        ads: false,
        events: false,
        partner: false,
        speisekarte: false,
        storyCollections: false,
        proposals: false,
        foerdermittel: false,
        flyer: true,
        workspace: true,
      };
    default:
      return {
        blog: false,
        members: false,
        openingHours: false,
        products: false,
        ads: false,
        events: false,
        partner: false,
        speisekarte: false,
        storyCollections: false,
        proposals: false,
        foerdermittel: false,
        flyer: false,
        workspace: false,
      };
  }
}
