import { NextRequest, NextResponse } from "next/server";
import { updateUserNFTStatus } from "@/lib/supabase-users";
import type { UpdateUserNFTStatusInput } from "@/lib/user-types";
import {
  isEvmWalletAddress,
  runStagingRouteMutation,
} from "@/lib/stadtstack/profile-write-boundary.mjs";

/**
 * POST /api/users/nft-status
 * Update cached NFT status (balance, delegation)
 */
export async function POST(request: NextRequest) {
  const guarded = await runStagingRouteMutation(
    process.env.NEXT_PUBLIC_STADTSTACK_STAGING_LAB,
    async () => {
      try {
        const body = await request.json();

        console.log("🔄 [API] Updating NFT status:", body.wallet_address);

        if (!isEvmWalletAddress(body.wallet_address)) {
          return NextResponse.json(
            { error: "wallet_address must be a valid EVM address" },
            { status: 400 }
          );
        }

        if (body.nft_balance === undefined) {
          return NextResponse.json(
            { error: "nft_balance is required" },
            { status: 400 }
          );
        }

        if (body.has_delegated === undefined) {
          return NextResponse.json(
            { error: "has_delegated is required" },
            { status: 400 }
          );
        }

        const input: UpdateUserNFTStatusInput = {
          wallet_address: body.wallet_address,
          nft_balance: BigInt(body.nft_balance),
          has_delegated: body.has_delegated,
          delegate_address: body.delegate_address || null,
        };

        const result = await updateUserNFTStatus(input);

        if (!result.success) {
          return NextResponse.json({ error: result.error }, { status: 500 });
        }

        return NextResponse.json({ success: true, user: result.data });
      } catch (error) {
        console.error("❌ [API] Error updating NFT status:", error);
        return NextResponse.json(
          {
            error:
              error instanceof Error ? error.message : "Failed to update NFT status",
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
