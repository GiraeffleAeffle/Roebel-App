import { NextRequest, NextResponse } from "next/server";
import { getPublicProfile } from "@/lib/supabase-users";
import { runPublicProfileRead } from "@/lib/stadtstack/profile-write-boundary.mjs";

/**
 * GET /api/users/profile/[wallet_address]?viewer=0x...
 * Fetch a privacy-filtered public profile
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ wallet_address: string }> }
) {
  const { wallet_address } = await params;

  if (!wallet_address) {
    return NextResponse.json(
      { error: "wallet_address is required" },
      { status: 400 }
    );
  }

  // `viewer` is a caller-controlled hint, not wallet authentication. The
  // staging presentation has no signed viewer session, so never let this
  // parameter unlock self/citizen-only fields there.
  const result = await runPublicProfileRead(
    process.env.NEXT_PUBLIC_STADTSTACK_STAGING_LAB,
    request.nextUrl.searchParams.get("viewer"),
    (viewerWallet) => getPublicProfile(wallet_address, viewerWallet),
  );

  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 404 });
  }

  return NextResponse.json({ success: true, profile: result.data });
}
