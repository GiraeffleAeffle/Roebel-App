import {
  DEFAULT_PRIVACY_SETTINGS,
  type User,
} from "../user-types";
import { resolveStadtstackStagingLab } from "./staging-lab";

export type ProfileLookupResult = {
  success: boolean;
  data?: User;
  error?: string;
  notFound?: boolean;
};

export type FirstLoginProfileResult =
  | { kind: "persisted" | "created"; user: User }
  | { kind: "ephemeral"; user: User }
  | { kind: "error"; error: string };

export type FirstLoginProfileDependencies<Account> = {
  findUser: (walletAddress: string) => Promise<ProfileLookupResult>;
  createUser: (input: { wallet_address: string }, account: Account) => Promise<ProfileLookupResult>;
};

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const EPHEMERAL_TIMESTAMP = "1970-01-01T00:00:00.000Z";

/**
 * The presentation ingress is read-only. A newly authenticated wallet can
 * still inspect the synthetic staging lab, but it must not cause a users row,
 * personal account, verification state, or cached chain state to be written.
 *
 * Keep the decision dependency-injected: it is deliberately independent from
 * React, Supabase, and Thirdweb so the no-write boundary can be tested alone.
 */
export async function resolveFirstLoginProfile<Account>(
  walletAddress: string | undefined,
  stagingFlag: string | undefined,
  account: Account,
  dependencies: FirstLoginProfileDependencies<Account>,
): Promise<FirstLoginProfileResult> {
  if (!walletAddress || !EVM_ADDRESS.test(walletAddress)) {
    return { kind: "error", error: "Invalid wallet address" };
  }

  const normalizedWalletAddress = walletAddress.toLowerCase();
  const existing = await dependencies.findUser(normalizedWalletAddress);

  if (existing.success && existing.data) {
    return { kind: "persisted", user: existing.data };
  }

  if (!existing.notFound) {
    return { kind: "error", error: existing.error || "Failed to load user profile" };
  }

  if (resolveStadtstackStagingLab(stagingFlag)) {
    return {
      kind: "ephemeral",
      user: createEphemeralStagingGuest(normalizedWalletAddress),
    };
  }

  const created = await dependencies.createUser(
    { wallet_address: normalizedWalletAddress },
    account,
  );
  if (created.success && created.data) {
    return { kind: "created", user: created.data };
  }
  return { kind: "error", error: created.error || "Failed to create user profile" };
}

/** A complete, deterministic, non-persisted guest profile for the lab only. */
export function createEphemeralStagingGuest(walletAddress: string): User {
  if (!EVM_ADDRESS.test(walletAddress)) {
    throw new Error("Invalid wallet address");
  }

  const normalizedWalletAddress = walletAddress.toLowerCase();
  return {
    id: `staging-ephemeral-${normalizedWalletAddress.slice(2)}`,
    wallet_address: normalizedWalletAddress,
    phone_number: null,
    phone_verified: false,
    phone_verified_at: null,
    email: null,
    email_verified: false,
    auth_provider: null,
    is_verified_citizen: false,
    citizen_verification_date: null,
    verification_status: "pending",
    verification_notes: null,
    username: `Staging-Gast ${normalizedWalletAddress.slice(2, 8)}`,
    profile_picture_url: null,
    cover_image_url: null,
    bio: null,
    role: "tourist",
    tier: "guest",
    active_account_id: null,
    neighborhood: null,
    interests: [],
    vereine: [],
    privacy_settings: { ...DEFAULT_PRIVACY_SETTINGS },
    nft_balance: 0n,
    has_delegated: false,
    delegate_address: null,
    total_votes_cast: 0n,
    voting_streak: 0n,
    last_vote_date: null,
    gamification_points: 0n,
    achievements: [],
    created_at: EPHEMERAL_TIMESTAMP,
    updated_at: EPHEMERAL_TIMESTAMP,
    last_login_at: EPHEMERAL_TIMESTAMP,
  };
}
