import { supabase } from "./supabase";
import type {
  User,
  CreateUserInput,
  UpdateUserProfileInput,
  UpdateUserNFTStatusInput,
  PublicProfile,
} from "./user-types";
import { DEFAULT_PRIVACY_SETTINGS } from "./user-types";
import type { PrivacySettings, VisibilityLevel } from "./user-types";
import { createPersonalAccount } from "@/lib/supabase-accounts";
import type { SigningAccount } from "@/lib/org-membership/client";

/**
 * Map a raw DB row (which has `tier` instead of `role`) to a User object
 * that exposes both `tier` and the deprecated `role` for backward compat.
 */
function mapDbRowToUser(row: Record<string, unknown>): User {
  const tier = (row.tier as string) || "guest";
  return {
    ...row,
    tier,
    role: tier as User["role"], // backward compat alias
  } as User;
}

/**
 * Create or update user on login
 * If user exists, updates last_login_at
 * If user doesn't exist, creates new user
 *
 * `account` is the caller's thirdweb account (in scope on every client-side
 * login path) — it signs the org-membership request that creates the new
 * user's personal account. When absent (e.g. a server-side caller with no
 * wallet to sign with), the personal account step is skipped; that has
 * always been non-fatal here, same as an insert failure was before.
 */
export async function createOrUpdateUser(
  input: CreateUserInput,
  account?: SigningAccount
): Promise<{ success: boolean; data?: User; error?: string }> {
  console.log("👤 [Supabase Users] Creating/updating user:", input.wallet_address);

  try {
    // Check if user exists
    const { data: existingUser } = await supabase
      .from("users")
      .select("*")
      .eq("wallet_address", input.wallet_address.toLowerCase())
      .single();

    if (existingUser) {
      // User exists - update last login
      console.log("✅ [Supabase Users] User exists, updating last login");
      const { data, error } = await supabase
        .from("users")
        .update({
          last_login_at: new Date().toISOString(),
          phone_number: input.phone_number || existingUser.phone_number,
          phone_verified: input.phone_verified ?? existingUser.phone_verified,
        })
        .eq("wallet_address", input.wallet_address.toLowerCase())
        .select()
        .single();

      if (error) {
        console.error("❌ [Supabase Users] Error updating user:", error);
        return { success: false, error: error.message };
      }

      return { success: true, data: mapDbRowToUser(data as Record<string, unknown>) };
    } else {
      // Create new user
      console.log("➕ [Supabase Users] Creating new user");
      const { data, error } = await supabase
        .from("users")
        .insert({
          wallet_address: input.wallet_address.toLowerCase(),
          phone_number: input.phone_number || null,
          phone_verified: input.phone_verified || false,
          last_login_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (error) {
        console.error("❌ [Supabase Users] Error creating user:", error);
        return { success: false, error: error.message };
      }

      // Create a personal account for the new user (signed by their wallet)
      const walletLower = input.wallet_address.toLowerCase();
      const accountName = walletLower; // Will be updated when user sets a username
      if (account) {
        try {
          await createPersonalAccount(account, accountName, null);
          console.log("✅ [Supabase Users] Personal account created for new user");
        } catch (accountError) {
          console.error("⚠️ [Supabase Users] Failed to create personal account:", accountError);
          // Non-fatal: user was still created
        }
      } else {
        console.warn(
          "⚠️ [Supabase Users] No signing account provided — skipping personal account creation"
        );
      }

      console.log("✅ [Supabase Users] User created successfully");
      return { success: true, data: mapDbRowToUser(data as Record<string, unknown>) };
    }
  } catch (error) {
    console.error("❌ [Supabase Users] Unexpected error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Get user by wallet address
 */
export async function getUserByWalletAddress(
  walletAddress: string
): Promise<{ success: boolean; data?: User; error?: string }> {
  console.log("🔍 [Supabase Users] Fetching user:", walletAddress);

  try {
    const { data, error } = await supabase
      .from("users")
      .select("*")
      .eq("wallet_address", walletAddress.toLowerCase())
      .single();

    if (error) {
      console.error("❌ [Supabase Users] Error fetching user:", error);
      return { success: false, error: error.message };
    }

    if (!data) {
      return { success: false, error: "User not found" };
    }

    console.log("✅ [Supabase Users] User fetched successfully");
    return { success: true, data: mapDbRowToUser(data as Record<string, unknown>) };
  } catch (error) {
    console.error("❌ [Supabase Users] Unexpected error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Get user by phone number
 */
export async function getUserByPhoneNumber(
  phoneNumber: string
): Promise<{ success: boolean; data?: User; error?: string }> {
  console.log("🔍 [Supabase Users] Fetching user by phone:", phoneNumber);

  try {
    const { data, error } = await supabase
      .from("users")
      .select("*")
      .eq("phone_number", phoneNumber)
      .single();

    if (error) {
      console.error("❌ [Supabase Users] Error fetching user:", error);
      return { success: false, error: error.message };
    }

    if (!data) {
      return { success: false, error: "User not found" };
    }

    console.log("✅ [Supabase Users] User fetched successfully");
    return { success: true, data: mapDbRowToUser(data as Record<string, unknown>) };
  } catch (error) {
    console.error("❌ [Supabase Users] Unexpected error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Update user profile (username, picture, bio)
 */
export async function updateUserProfile(
  input: UpdateUserProfileInput
): Promise<{ success: boolean; data?: User; error?: string }> {
  console.log("✏️ [Supabase Users] Updating profile:", input.wallet_address);

  try {
    const updateData: Record<string, unknown> = {};

    if (input.username !== undefined) updateData.username = input.username;
    if (input.profile_picture_url !== undefined)
      updateData.profile_picture_url = input.profile_picture_url;
    if (input.cover_image_url !== undefined)
      updateData.cover_image_url = input.cover_image_url;
    if (input.bio !== undefined) updateData.bio = input.bio;
    // Map deprecated `role` field to the DB `tier` column
    if (input.role !== undefined) updateData.tier = input.role;
    if (input.neighborhood !== undefined) updateData.neighborhood = input.neighborhood;
    if (input.interests !== undefined) updateData.interests = input.interests;
    if (input.vereine !== undefined) updateData.vereine = input.vereine;
    if (input.privacy_settings !== undefined) {
      const { data: existing } = await supabase
        .from("users")
        .select("privacy_settings")
        .eq("wallet_address", input.wallet_address.toLowerCase())
        .single();

      updateData.privacy_settings = {
        ...DEFAULT_PRIVACY_SETTINGS,
        ...(existing?.privacy_settings || {}),
        ...input.privacy_settings,
      };
    }

    const { data, error } = await supabase
      .from("users")
      .update(updateData)
      .eq("wallet_address", input.wallet_address.toLowerCase())
      .select()
      .single();

    if (error) {
      console.error("❌ [Supabase Users] Error updating profile:", error);
      return { success: false, error: error.message };
    }

    console.log("✅ [Supabase Users] Profile updated successfully");
    return { success: true, data: mapDbRowToUser(data as Record<string, unknown>) };
  } catch (error) {
    console.error("❌ [Supabase Users] Unexpected error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Update cached NFT status (balance, delegation)
 */
export async function updateUserNFTStatus(
  input: UpdateUserNFTStatusInput
): Promise<{ success: boolean; data?: User; error?: string }> {
  // Silently update NFT status

  try {
    const { data, error } = await supabase
      .from("users")
      .update({
        nft_balance: input.nft_balance.toString(),
        has_delegated: input.has_delegated,
        delegate_address: input.delegate_address || null,
      })
      .eq("wallet_address", input.wallet_address.toLowerCase())
      .select()
      .single();

    if (error) {
      console.error("❌ [Supabase Users] Error updating NFT status:", error);
      return { success: false, error: error.message };
    }

    return { success: true, data: mapDbRowToUser(data as Record<string, unknown>) };
  } catch (error) {
    console.error("❌ [Supabase Users] Unexpected error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Check if username is available
 */
export async function checkUsernameAvailable(
  username: string,
  currentWalletAddress?: string
): Promise<{ available: boolean; error?: string }> {
  console.log("🔎 [Supabase Users] Checking username availability:", username);

  try {
    let query = supabase
      .from("users")
      .select("wallet_address")
      .eq("username", username);

    // If checking for current user, exclude their own record
    if (currentWalletAddress) {
      query = query.neq("wallet_address", currentWalletAddress.toLowerCase());
    }

    const { data, error } = await query;

    if (error) {
      console.error("❌ [Supabase Users] Error checking username:", error);
      return { available: false, error: error.message };
    }

    const available = !data || data.length === 0;
    console.log(`${available ? "✅" : "❌"} [Supabase Users] Username ${username} is ${available ? "available" : "taken"}`);

    return { available };
  } catch (error) {
    console.error("❌ [Supabase Users] Unexpected error:", error);
    return {
      available: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Update last login timestamp
 */
export async function updateLastLogin(
  walletAddress: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const { error } = await supabase
      .from("users")
      .update({ last_login_at: new Date().toISOString() })
      .eq("wallet_address", walletAddress.toLowerCase());

    if (error) {
      console.error("❌ [Supabase Users] Error updating last login:", error);
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (error) {
    console.error("❌ [Supabase Users] Unexpected error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Get all users (for admin purposes or leaderboards)
 */
export async function getAllUsers(
  limit = 100,
  offset = 0
): Promise<{ success: boolean; data?: User[]; total?: number; error?: string }> {
  console.log("📋 [Supabase Users] Fetching all users");

  try {
    const { data, error, count } = await supabase
      .from("users")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error("❌ [Supabase Users] Error fetching users:", error);
      return { success: false, error: error.message };
    }

    console.log(`✅ [Supabase Users] Fetched ${data?.length || 0} users`);
    const users = (data || []).map((row) => mapDbRowToUser(row as Record<string, unknown>));
    return { success: true, data: users, total: count || 0 };
  } catch (error) {
    console.error("❌ [Supabase Users] Unexpected error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Delete user (for GDPR compliance)
 */
export async function deleteUser(
  walletAddress: string
): Promise<{ success: boolean; error?: string }> {
  console.log("🗑️ [Supabase Users] Deleting user:", walletAddress);

  try {
    const { error } = await supabase
      .from("users")
      .delete()
      .eq("wallet_address", walletAddress.toLowerCase());

    if (error) {
      console.error("❌ [Supabase Users] Error deleting user:", error);
      return { success: false, error: error.message };
    }

    console.log("✅ [Supabase Users] User deleted successfully");
    return { success: true };
  } catch (error) {
    console.error("❌ [Supabase Users] Unexpected error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
/**
 * Get privacy-filtered public profile by querying the users table directly
 * and applying privacy_settings in TypeScript.
 */
export async function getPublicProfile(
  targetWallet: string,
  viewerWallet?: string | null
): Promise<{ success: boolean; data?: PublicProfile; error?: string }> {
  console.log("🔍 [Supabase Users] Fetching public profile:", targetWallet);

  try {
    const { data: row, error } = await supabase
      .from("users")
      .select("*")
      .eq("wallet_address", targetWallet.toLowerCase())
      .maybeSingle();

    if (error) {
      console.error("❌ [Supabase Users] Error fetching public profile:", error);
      return { success: false, error: error.message };
    }

    if (!row) {
      return { success: false, error: "Profile not found" };
    }

    const tier = (row.tier as string) || "guest";
    const privacy: PrivacySettings = {
      ...DEFAULT_PRIVACY_SETTINGS,
      ...((row.privacy_settings as Partial<PrivacySettings>) || {}),
    };

    const isSelf =
      !!viewerWallet &&
      viewerWallet.toLowerCase() === targetWallet.toLowerCase();

    let viewerIsCitizen = false;
    if (!isSelf && viewerWallet) {
      const { data: viewer } = await supabase
        .from("users")
        .select("is_verified_citizen")
        .eq("wallet_address", viewerWallet.toLowerCase())
        .maybeSingle();
      viewerIsCitizen = !!viewer?.is_verified_citizen;
    }

    const canSee = (level: VisibilityLevel) =>
      isSelf ||
      level === "public" ||
      (level === "citizens" && viewerIsCitizen);

    const profile: PublicProfile = {
      wallet_address: row.wallet_address,
      username: row.username ?? null,
      profile_picture_url: row.profile_picture_url ?? null,
      cover_image_url: row.cover_image_url ?? null,
      role: tier as PublicProfile["role"],
      tier: tier as PublicProfile["tier"],
      is_verified_citizen: !!row.is_verified_citizen,
      nft_balance: Number(row.nft_balance ?? 0),
      created_at: row.created_at,
      bio: canSee(privacy.bio) ? row.bio ?? null : null,
      neighborhood: canSee(privacy.neighborhood)
        ? row.neighborhood ?? null
        : null,
      interests: canSee(privacy.interests) ? row.interests ?? [] : [],
      vereine: canSee(privacy.vereine) ? row.vereine ?? [] : [],
      email: canSee(privacy.email) ? row.email ?? null : null,
      total_votes_cast: canSee(privacy.voting_history)
        ? Number(row.total_votes_cast ?? 0)
        : undefined,
      voting_streak: canSee(privacy.voting_history)
        ? Number(row.voting_streak ?? 0)
        : undefined,
      gamification_points: canSee(privacy.gamification_points)
        ? Number(row.gamification_points ?? 0)
        : undefined,
    };

    console.log("✅ [Supabase Users] Public profile fetched successfully");
    return { success: true, data: profile };
  } catch (error) {
    console.error("❌ [Supabase Users] Unexpected error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
