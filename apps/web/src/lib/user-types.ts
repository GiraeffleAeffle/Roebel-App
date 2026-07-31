/**
 * TypeScript types for user profiles and authentication
 * Matches Supabase users table schema
 */

import type { UserTier } from "@/types/account";
export type { UserTier } from "@/types/account";

// --- Role & Privacy Types ---

/** @deprecated Use UserTier instead */
export type UserRole = "resident" | "business" | "tourist" | "official";

/** Combined type for backward compat: accepts both old roles and new tiers */
export type UserRoleOrTier = UserRole | UserTier;

export type VisibilityLevel = "public" | "citizens" | "private";

export interface PrivacySettings {
  bio: VisibilityLevel;
  neighborhood: VisibilityLevel;
  interests: VisibilityLevel;
  vereine: VisibilityLevel;
  email: VisibilityLevel;
  phone_number: VisibilityLevel;
  voting_history: VisibilityLevel;
  gamification_points: VisibilityLevel;
}

export const DEFAULT_PRIVACY_SETTINGS: PrivacySettings = {
  bio: "public",
  neighborhood: "public",
  interests: "public",
  vereine: "citizens",
  email: "private",
  phone_number: "private",
  voting_history: "citizens",
  gamification_points: "public",
};

export const ROLE_DEFAULT_PRIVACY: Record<string, Partial<PrivacySettings>> = {
  // New tier values
  citizen: {},
  tourist: { neighborhood: "private", vereine: "private", voting_history: "private" },
  guest: { neighborhood: "private", vereine: "private", voting_history: "private" },
  // Legacy role values (backward compat)
  resident: {},
  business: { vereine: "public", interests: "public" },
  official: { bio: "public", voting_history: "public" },
};

export interface PublicProfile {
  wallet_address: string;
  username: string | null;
  profile_picture_url: string | null;
  cover_image_url: string | null;
  /** @deprecated Use tier instead */
  role: UserRole;
  tier: UserTier;
  is_verified_citizen: boolean;
  nft_balance: number;
  created_at: string;
  bio?: string | null;
  neighborhood?: string | null;
  interests?: string[];
  vereine?: string[];
  email?: string | null;
  total_votes_cast?: number;
  voting_streak?: number;
  gamification_points?: number;
}

// --- Constants ---

export const NEIGHBORHOODS: string[] = [
  "Altstadt",
  "Neustadt",
  "Gotthun",
  "Bollewick",
  "Ludorf",
  "Marienfelde",
  "Gneve",
  "Nätebow",
  "Kambs",
  "Lärz",
];

export const INTEREST_TAGS: string[] = [
  "Kultur",
  "Sport",
  "Musik",
  "Natur",
  "Bildung",
  "Soziales",
  "Wirtschaft",
  "Tourismus",
  "Geschichte",
  "Umwelt",
  "Digitales",
  "Gesundheit",
  "Jugend",
  "Senioren",
  "Kunst",
  "Handwerk",
];

// --- Role Helpers ---

export function getRoleInfo(role: UserRoleOrTier): {
  label: string;
  labelDe: string;
  bgColor: string;
  textColor: string;
  borderColor: string;
} {
  switch (role) {
    case "citizen":
    case "resident":
      return {
        label: "Citizen",
        labelDe: "Bürger",
        bgColor: "bg-blue-50",
        textColor: "text-blue-700",
        borderColor: "border-blue-200",
      };
    case "business":
      return {
        label: "Business",
        labelDe: "Gewerbe",
        bgColor: "bg-amber-50",
        textColor: "text-amber-700",
        borderColor: "border-amber-200",
      };
    case "guest":
    case "tourist":
      return {
        label: "Tourist",
        labelDe: "Gast",
        bgColor: "bg-green-50",
        textColor: "text-green-700",
        borderColor: "border-green-200",
      };
    case "official":
      return {
        label: "Official",
        labelDe: "Amtsträger",
        bgColor: "bg-purple-50",
        textColor: "text-purple-700",
        borderColor: "border-purple-200",
      };
    default:
      return {
        label: "Tourist",
        labelDe: "Gast",
        bgColor: "bg-green-50",
        textColor: "text-green-700",
        borderColor: "border-green-200",
      };
  }
}

export function getVisibilityLabel(level: VisibilityLevel): string {
  switch (level) {
    case "public":
      return "Öffentlich";
    case "citizens":
      return "Nur Bürger";
    case "private":
      return "Privat";
  }
}

/**
 * Complete user profile from database
 */
export interface User {
  id: string;
  wallet_address: string;

  // Authentication
  phone_number: string | null;
  phone_verified: boolean;
  phone_verified_at: string | null;
  email: string | null;
  email_verified: boolean;
  auth_provider: string | null; // 'phone', 'email', 'google', 'apple', 'facebook'

  // Citizen Verification
  is_verified_citizen: boolean;
  citizen_verification_date: string | null;
  verification_status: 'pending' | 'approved' | 'rejected';
  verification_notes: string | null;

  // Profile
  username: string | null;
  profile_picture_url: string | null;
  cover_image_url: string | null;
  bio: string | null;
  /** @deprecated Use tier instead — DB column renamed in migration 005 */
  role: UserRole;
  tier: UserTier;
  active_account_id: string | null;
  neighborhood: string | null;
  interests: string[];
  vereine: string[];
  privacy_settings: PrivacySettings;

  // NFT Status
  nft_balance: bigint;
  has_delegated: boolean;
  delegate_address: string | null;

  // Gamification
  total_votes_cast: bigint;
  voting_streak: bigint;
  last_vote_date: string | null;
  gamification_points: bigint;
  achievements: any[]; // JSONB array

  // Timestamps
  created_at: string;
  updated_at: string;
  last_login_at: string;
}

/**
 * Input for creating a new user
 */
export interface CreateUserInput {
  wallet_address: string;
  phone_number?: string;
  phone_verified?: boolean;
}

/**
 * Input for updating user profile (username, picture, bio)
 */
export interface UpdateUserProfileInput {
  wallet_address: string; // For verification
  username?: string | null;
  profile_picture_url?: string | null;
  cover_image_url?: string | null;
  bio?: string | null;
  role?: UserRole;
  neighborhood?: string | null;
  interests?: string[];
  vereine?: string[];
  privacy_settings?: Partial<PrivacySettings>;
}

/**
 * Input for updating cached NFT status
 */
export interface UpdateUserNFTStatusInput {
  wallet_address: string;
  nft_balance: bigint;
  has_delegated: boolean;
  delegate_address?: string | null;
}

/**
 * User profile with optional fields for display
 */
export interface UserProfile {
  wallet_address: string;
  phone_number?: string;
  username?: string;
  profile_picture_url?: string;
  bio?: string;
  nft_balance: number;
  has_citizen_nft: boolean;
  has_delegated: boolean;
  delegate_address?: string;
  joined_date: string;
}

/**
 * Helper function to format wallet address (0x1234...5678)
 */
export function formatWalletAddress(
  address: string,
  startChars = 6,
  endChars = 4
): string {
  if (!address || address.length < startChars + endChars) {
    return address;
  }
  return `${address.slice(0, startChars)}...${address.slice(-endChars)}`;
}

/**
 * Helper function to format phone number
 * Converts E.164 format (+1234567890) to display format ((123) 456-7890)
 */
export function formatPhoneNumber(phoneNumber: string): string {
  if (!phoneNumber) return "";

  // Remove + and any non-digit characters
  const cleaned = phoneNumber.replace(/\D/g, "");

  // US/Canada format
  if (cleaned.length === 11 && cleaned.startsWith("1")) {
    const match = cleaned.match(/^1(\d{3})(\d{3})(\d{4})$/);
    if (match) {
      return `(${match[1]}) ${match[2]}-${match[3]}`;
    }
  }

  // International format - just show with spaces
  if (cleaned.length > 10) {
    return `+${cleaned.slice(0, -10)} ${cleaned.slice(-10, -7)} ${cleaned.slice(
      -7,
      -4
    )} ${cleaned.slice(-4)}`;
  }

  // Default: show as is with +
  return `+${cleaned}`;
}

/**
 * Validate username format
 * - 3-30 characters
 * - Alphanumeric and underscore only
 * - Cannot start or end with underscore
 */
export function validateUsername(username: string): {
  valid: boolean;
  error?: string;
} {
  if (!username || username.length < 3) {
    return { valid: false, error: "Username must be at least 3 characters" };
  }

  if (username.length > 30) {
    return { valid: false, error: "Username must be at most 30 characters" };
  }

  if (!/^[a-zA-Z0-9_]+$/.test(username)) {
    return {
      valid: false,
      error: "Username can only contain letters, numbers, and underscores",
    };
  }

  if (username.startsWith("_") || username.endsWith("_")) {
    return {
      valid: false,
      error: "Username cannot start or end with an underscore",
    };
  }

  return { valid: true };
}

/**
 * Validate bio length
 */
export function validateBio(bio: string): { valid: boolean; error?: string } {
  if (bio && bio.length > 500) {
    return { valid: false, error: "Bio must be at most 500 characters" };
  }
  return { valid: true };
}

/**
 * Helper to check if user has completed their profile
 */
export function isProfileComplete(user: User): boolean {
  return !!(user.username && user.profile_picture_url);
}

/**
 * Helper to get user display name
 * Returns username if set, otherwise truncated wallet address
 */
export function getUserDisplayName(user: User | UserProfile): string {
  if ("username" in user && user.username) {
    return user.username;
  }
  return formatWalletAddress(user.wallet_address);
}

/**
 * Helper to calculate days since user joined
 */
export function getDaysSinceJoined(createdAt: string): number {
  const created = new Date(createdAt);
  const now = new Date();
  const diffTime = Math.abs(now.getTime() - created.getTime());
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return diffDays;
}

/**
 * NFT membership badge type
 */
export type MembershipBadge = "citizen" | "none";

/**
 * Get membership badge based on NFT balance
 */
export function getMembershipBadge(nftBalance: number | bigint): MembershipBadge {
  const balance = typeof nftBalance === "bigint" ? Number(nftBalance) : nftBalance;
  return balance > 0 ? "citizen" : "none";
}

/**
 * Get membership badge display text
 */
export function getMembershipBadgeText(badge: MembershipBadge): string {
  switch (badge) {
    case "citizen":
      return "Citizen Member";
    case "none":
      return "Not a Member";
  }
}

/**
 * Get membership badge color classes for Tailwind
 */
export function getMembershipBadgeColors(badge: MembershipBadge): {
  bg: string;
  text: string;
  border: string;
} {
  switch (badge) {
    case "citizen":
      return {
        bg: "bg-green-900/30",
        text: "text-green-300",
        border: "border-green-700",
      };
    case "none":
      return {
        bg: "bg-gray-800/30",
        text: "text-muted-foreground",
        border: "border-gray-700",
      };
  }
}

/**
 * Vote history entry
 */
export interface VoteHistory {
  id: string;
  user_id: string;
  wallet_address: string;
  proposal_id: string; // Transaction hash
  blockchain_proposal_id: string; // Numeric ID
  proposal_number: number | null;
  proposal_title: string | null;
  /** Always null since 2026-07-31: participation is recorded, the choice never
   *  is (MACI privacy; migration 20260731_vote_history_choice_purge.sql). */
  vote_type: 0 | 1 | 2 | null;
  voting_power: bigint;
  points_earned: bigint;
  streak_at_vote: bigint;
  voted_at: string;
  transaction_hash: string | null;
  block_number: bigint | null;
}

/**
 * Input for recording a vote
 */
export interface RecordVoteInput {
  wallet_address: string;
  proposal_id: string;
  blockchain_proposal_id: string;
  proposal_number: number;
  proposal_title: string;
  /** Deprecated: accepted for backwards compatibility, never stored. */
  vote_type?: 0 | 1 | 2;
  voting_power: bigint;
  transaction_hash: string;
  block_number: bigint;
}

/**
 * Voting statistics
 */
export interface VotingStats {
  total_votes_cast: number;
  voting_streak: number;
  gamification_points: number;
  last_vote_date: string | null;
  for_votes: number;
  against_votes: number;
  abstain_votes: number;
}

/**
 * Leaderboard entry
 */
export interface LeaderboardEntry {
  rank: number;
  wallet_address: string;
  username: string | null;
  profile_picture_url: string | null;
  total_votes_cast: number;
  gamification_points: number;
  voting_streak: number;
}

/**
 * Get vote type label
 */
export function getVoteTypeLabel(voteType: 0 | 1 | 2): string {
  switch (voteType) {
    case 0:
      return "Against";
    case 1:
      return "For";
    case 2:
      return "Abstain";
  }
}

/**
 * Get vote type color
 */
export function getVoteTypeColor(voteType: 0 | 1 | 2): {
  bg: string;
  text: string;
} {
  switch (voteType) {
    case 0:
      return { bg: "bg-red-900/30", text: "text-red-300" };
    case 1:
      return { bg: "bg-green-900/30", text: "text-green-300" };
    case 2:
      return { bg: "bg-gray-800/30", text: "text-muted-foreground" };
  }
}

/**
 * Format gamification points with K/M suffix
 */
export function formatPoints(points: number | bigint): string {
  const num = typeof points === "bigint" ? Number(points) : points;
  if (num === 0) return "0";
  if (num < 1000) return num.toString();
  if (num < 1000000) return `${(num / 1000).toFixed(1)}K`;
  return `${(num / 1000000).toFixed(1)}M`;
}

/**
 * Get streak emoji based on streak length
 */
export function getStreakEmoji(streak: number): string {
  if (streak === 0) return "⭐";
  if (streak < 3) return "🔥";
  if (streak < 7) return "🔥🔥";
  if (streak < 14) return "🔥🔥🔥";
  return "🔥🔥🔥🔥";
}

/**
 * Phone verification session
 */
export interface PhoneVerificationSession {
  id: string;
  phone_number: string;
  verification_code: string;
  expires_at: string;
  verified: boolean;
  wallet_address: string | null;
  user_id: string | null;
  ip_address: string | null;
  user_agent: string | null;
  attempts: number;
  created_at: string;
}

/**
 * Verification audit log entry
 */
export interface VerificationAuditLog {
  id: string;
  user_id: string;
  wallet_address: string;
  phone_number: string;
  action: 'approved' | 'rejected' | 'revoked';
  admin_address: string | null;
  notes: string | null;
  created_at: string;
}

/**
 * Pending verification for admin dashboard
 */
export interface PendingVerification {
  id: string;
  wallet_address: string;
  phone_number: string;
  username: string | null;
  profile_picture_url: string | null;
  created_at: string;
  phone_verified_at: string;
}

/**
 * Get verification status badge color
 */
export function getVerificationStatusColor(status: 'pending' | 'approved' | 'rejected'): {
  bg: string;
  text: string;
  border: string;
} {
  switch (status) {
    case 'pending':
      return {
        bg: 'bg-yellow-900/30',
        text: 'text-yellow-300',
        border: 'border-yellow-700',
      };
    case 'approved':
      return {
        bg: 'bg-green-900/30',
        text: 'text-green-300',
        border: 'border-green-700',
      };
    case 'rejected':
      return {
        bg: 'bg-red-900/30',
        text: 'text-red-300',
        border: 'border-red-700',
      };
  }
}

/**
 * Get verification status label
 */
export function getVerificationStatusLabel(status: 'pending' | 'approved' | 'rejected'): string {
  switch (status) {
    case 'pending':
      return 'Pending Review';
    case 'approved':
      return 'Verified Citizen';
    case 'rejected':
      return 'Not Verified';
  }
}

/**
 * Format phone number for E.164
 * Ensures phone number starts with + and country code
 * Defaults to Germany (+49) if no country code provided
 */
export function formatPhoneE164(phone: string): string {
  // Remove all non-digit characters except +
  const cleaned = phone.replace(/[^\d+]/g, '');

  // If doesn't start with +, assume it's Germany number
  if (!cleaned.startsWith('+')) {
    // Remove leading 0 if present (common in German phone numbers)
    const withoutLeadingZero = cleaned.replace(/^0/, '');
    return `+49${withoutLeadingZero}`;
  }

  return cleaned;
}

/**
 * Validate phone number format
 */
export function isValidPhoneNumber(phone: string): boolean {
  // E.164 format: +[country code][number]
  // Length: 10-15 digits after country code
  const e164Pattern = /^\+[1-9]\d{1,14}$/;
  return e164Pattern.test(phone);
}
