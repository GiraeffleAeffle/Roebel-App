import { NextRequest, NextResponse } from "next/server";
import {
  getUserByWalletAddress,
  createOrUpdateUser,
  updateUserProfile,
} from "@/lib/supabase-users";
import type { CreateUserInput, UpdateUserProfileInput } from "@/lib/user-types";
import {
  isEvmWalletAddress,
  resolvePrivateProfileReadPermission,
  runPrivateProfileRead,
  runStagingRouteMutation,
} from "@/lib/stadtstack/profile-write-boundary.mjs";

/**
 * GET /api/users/profile?wallet_address=0x...
 * Fetch user profile by wallet address
 */
export async function GET(request: NextRequest) {
  // This legacy endpoint returns the full private User shape. Staging uses
  // /api/users/profile/[wallet_address] for its rigorously public projection,
  // so fail closed here before parsing attacker input or touching Supabase.
  const readPermission = resolvePrivateProfileReadPermission(
    process.env.NEXT_PUBLIC_STADTSTACK_STAGING_LAB,
  );
  if (!readPermission.allowed) {
    return NextResponse.json(
      { error: readPermission.error },
      { status: 403 },
    );
  }

  const { searchParams } = new URL(request.url);
  const walletAddress = searchParams.get("wallet_address");

  if (!walletAddress) {
    return NextResponse.json(
      { error: "wallet_address parameter is required" },
      { status: 400 }
    );
  }

  console.log("🔍 [API] Fetching user profile:", walletAddress);

  const guardedRead = await runPrivateProfileRead(
    process.env.NEXT_PUBLIC_STADTSTACK_STAGING_LAB,
    () => getUserByWalletAddress(walletAddress),
  );
  if (!guardedRead.allowed) {
    return NextResponse.json(
      { error: guardedRead.error },
      { status: 403 },
    );
  }
  const result = guardedRead.value;

  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 404 });
  }

  return NextResponse.json({ success: true, user: result.data });
}

/**
 * POST /api/users/profile
 * Create new user profile
 */
export async function POST(request: NextRequest) {
  const guarded = await runStagingRouteMutation(
    process.env.NEXT_PUBLIC_STADTSTACK_STAGING_LAB,
    async () => {
      try {
        const body: CreateUserInput = await request.json();

        console.log("➕ [API] Creating user profile:", body.wallet_address);

        if (!isEvmWalletAddress(body.wallet_address)) {
          return NextResponse.json(
            { error: "wallet_address must be a valid EVM address" },
            { status: 400 }
          );
        }

        const result = await createOrUpdateUser(body);

        if (!result.success) {
          return NextResponse.json({ error: result.error }, { status: 500 });
        }

        return NextResponse.json({ success: true, user: result.data });
      } catch (error) {
        console.error("❌ [API] Error creating user:", error);
        return NextResponse.json(
          {
            error: error instanceof Error ? error.message : "Failed to create user",
          },
          { status: 500 }
        );
      }
    },
  );
  if (!guarded.allowed) {
    return NextResponse.json(
      { error: guarded.error },
      { status: 403 },
    );
  }
  return guarded.value;
}

/**
 * PATCH /api/users/profile
 * Update user profile (username, picture, bio)
 */
export async function PATCH(request: NextRequest) {
  const guarded = await runStagingRouteMutation(
    process.env.NEXT_PUBLIC_STADTSTACK_STAGING_LAB,
    async () => {
      try {
        const body: UpdateUserProfileInput = await request.json();

        console.log("✏️ [API] Updating user profile:", body.wallet_address);

        if (!isEvmWalletAddress(body.wallet_address)) {
          return NextResponse.json(
            { error: "wallet_address must be a valid EVM address" },
            { status: 400 }
          );
        }

        const result = await updateUserProfile(body);

        if (!result.success) {
          return NextResponse.json({ error: result.error }, { status: 500 });
        }

        return NextResponse.json({ success: true, user: result.data });
      } catch (error) {
        console.error("❌ [API] Error updating user:", error);
        return NextResponse.json(
          {
            error: error instanceof Error ? error.message : "Failed to update user",
          },
          { status: 500 }
        );
      }
    },
  );
  if (!guarded.allowed) {
    return NextResponse.json(
      { error: guarded.error },
      { status: 403 },
    );
  }
  return guarded.value;
}
