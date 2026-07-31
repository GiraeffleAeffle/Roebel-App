import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import type { RecordVoteInput } from "@/lib/user-types";

/**
 * POST /api/votes/record
 * Record a vote and update gamification stats
 */
export async function POST(request: NextRequest) {
  try {
    const body: RecordVoteInput = await request.json();

    console.log("🗳️ [API] Recording vote participation:", {
      wallet: body.wallet_address,
      proposal: body.proposal_id,
    });

    // Validate required fields
    if (!body.wallet_address) {
      return NextResponse.json(
        { error: "wallet_address is required" },
        { status: 400 }
      );
    }

    if (!body.proposal_id || !body.blockchain_proposal_id) {
      return NextResponse.json(
        { error: "proposal_id and blockchain_proposal_id are required" },
        { status: 400 }
      );
    }

    // This endpoint records PARTICIPATION only. The choice (vote_type) is
    // deliberately never stored: MACI encrypts it on-chain, and mirroring it
    // off-chain in plaintext was the leak the 2026-07-09 ZK assessment flagged.
    // Clients may still send vote_type for backwards compatibility — it is
    // accepted and discarded.
    const { data, error } = await supabase.rpc("record_vote", {
      p_wallet_address: body.wallet_address,
      p_proposal_id: body.proposal_id,
      p_blockchain_proposal_id: body.blockchain_proposal_id,
      p_proposal_number: body.proposal_number || null,
      p_proposal_title: body.proposal_title || null,
      p_vote_type: null,
      p_voting_power: body.voting_power.toString(),
      p_transaction_hash: body.transaction_hash || null,
      p_block_number: body.block_number ? Number(body.block_number) : null,
    });

    if (error) {
      console.error("❌ [API] Error recording vote:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    console.log("✅ [API] Vote recorded successfully:", data);

    return NextResponse.json({
      success: true,
      ...data,
    });
  } catch (error) {
    console.error("❌ [API] Unexpected error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to record vote",
      },
      { status: 500 }
    );
  }
}
