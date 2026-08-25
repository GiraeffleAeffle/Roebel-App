import { NextRequest, NextResponse } from "next/server";
import { deleteUser } from "@/lib/supabase-users";
import {
  isEvmWalletAddress,
  runStagingRouteMutation,
} from "@/lib/stadtstack/profile-write-boundary.mjs";

/**
 * DELETE /api/users/delete?wallet_address=0x...
 * Delete user account and all associated data (GDPR compliance)
 */
export async function DELETE(request: NextRequest) {
  const guarded = await runStagingRouteMutation(
    process.env.NEXT_PUBLIC_STADTSTACK_STAGING_LAB,
    async () => {
      const { searchParams } = new URL(request.url);
      const walletAddress = searchParams.get("wallet_address");

      if (!isEvmWalletAddress(walletAddress)) {
        return NextResponse.json(
          { error: "wallet_address must be a valid EVM address" },
          { status: 400 }
        );
      }

      console.log("🗑️ [API] Deleting user account:", walletAddress);

      const result = await deleteUser(walletAddress);

      if (!result.success) {
        return NextResponse.json(
          { error: result.error || "Failed to delete account" },
          { status: 500 }
        );
      }

      console.log("✅ [API] Account deleted successfully:", walletAddress);

      return NextResponse.json({
        success: true,
        message: "Account and all associated data have been permanently deleted",
      });
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
