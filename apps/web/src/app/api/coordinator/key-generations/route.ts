import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  verifyIsProductionAttester,
  verifyIsFounder,
  verifyWalletSignature,
} from "@/lib/shamir/signature-verification";
import {
  buildCanonicalKeyGenerationPayload,
  buildKeyGenerationSignaturePayload,
} from "@/lib/shamir/canonical-payload";

/**
 * POST /api/coordinator/key-generations
 *
 * Records a new coordinator-key generation ceremony and persists one
 * encrypted share per registered shareholder. The Babyjubjub privkey
 * itself is never sent — only the pubkey and the 5 sealed shares.
 *
 * Body:
 *   creatorWallet: 0x… (must be on the founder allowlist + hold AttesterNFT)
 *   signature:    ECDSA signature of the SHA-256 of the canonical payload
 *   generation:   { governorAddress, pubkeyX, pubkeyY, threshold, totalShares }
 *   shares:       [{ walletAddress, shareIndex, encryptedShareBase64 }]
 *
 * The signature anchors the entire bundle to the founder's wallet so
 * the same body cannot be replayed by a third party. The SHA-256 hash is
 * computed server-side from the same canonical payload to confirm.
 *
 * On success: one DB transaction inserts a coordinator_key_generations
 * row, N coordinator_shares rows, one audit row. Returns generationId.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const {
    creatorWallet,
    signature,
    generation,
    shares,
  } = body as {
    creatorWallet?: string;
    signature?: string;
    generation?: {
      governorAddress?: string;
      pubkeyX?: string;
      pubkeyY?: string;
      threshold?: number;
      totalShares?: number;
    };
    shares?: Array<{
      walletAddress?: string;
      shareIndex?: number;
      encryptedShareBase64?: string;
    }>;
  };

  if (
    !creatorWallet ||
    !signature ||
    !generation ||
    !Array.isArray(shares) ||
    shares.length === 0
  ) {
    return NextResponse.json(
      { error: "missing required fields" },
      { status: 400 }
    );
  }

  const {
    governorAddress,
    pubkeyX,
    pubkeyY,
    threshold,
    totalShares,
  } = generation;
  if (
    !governorAddress ||
    !pubkeyX ||
    !pubkeyY ||
    typeof threshold !== "number" ||
    typeof totalShares !== "number" ||
    threshold < 2 ||
    totalShares < threshold ||
    shares.length !== totalShares
  ) {
    return NextResponse.json(
      { error: "invalid generation parameters" },
      { status: 400 }
    );
  }

  // Build the canonical payload — same shape used client-side to produce
  // the signature. Object key order matters for the SHA-256.
  const canonical = buildCanonicalKeyGenerationPayload({
    governorAddress,
    pubkeyX,
    pubkeyY,
    threshold,
    totalShares,
    shareWallets: shares.map((s) => (s.walletAddress ?? "").toLowerCase()),
  });
  const messageHash = createHash("sha256").update(canonical).digest("hex");
  const signedMessage = buildKeyGenerationSignaturePayload(
    canonical,
    messageHash
  );

  if (!(await verifyWalletSignature(signedMessage, signature, creatorWallet))) {
    return NextResponse.json(
      { error: "signature does not match creatorWallet" },
      { status: 401 }
    );
  }

  if (!verifyIsFounder(creatorWallet)) {
    return NextResponse.json(
      { error: "creatorWallet is not on the founder allowlist" },
      { status: 403 }
    );
  }
  if (!(await verifyIsProductionAttester(creatorWallet))) {
    return NextResponse.json(
      { error: "creatorWallet no longer holds AttesterNFT" },
      { status: 403 }
    );
  }

  const supabase = createAdminClient();

  // Confirm every share wallet is currently registered.
  const walletList = shares.map((s) =>
    (s.walletAddress ?? "").toLowerCase()
  );
  const { data: regs, error: regErr } = await supabase
    .from("coordinator_share_keys")
    .select("wallet_address")
    .in("wallet_address", walletList)
    .is("revoked_at", null);
  if (regErr) {
    console.error("[key-generations] reg lookup failed", regErr);
    return NextResponse.json({ error: regErr.message }, { status: 500 });
  }
  const registered = new Set(
    (regs ?? []).map((r) => r.wallet_address.toLowerCase())
  );
  for (const w of walletList) {
    if (!registered.has(w)) {
      return NextResponse.json(
        { error: `share recipient not registered: ${w}` },
        { status: 400 }
      );
    }
  }

  // Insert the generation row first.
  const { data: genRow, error: genErr } = await supabase
    .from("coordinator_key_generations")
    .insert({
      governor_address: governorAddress.toLowerCase(),
      pubkey_x: pubkeyX,
      pubkey_y: pubkeyY,
      threshold,
      total_shares: totalShares,
      created_by_wallet: creatorWallet.toLowerCase(),
    })
    .select("id")
    .single();
  if (genErr || !genRow) {
    console.error("[key-generations] insert failed", genErr);
    return NextResponse.json(
      { error: genErr?.message ?? "insert failed" },
      { status: 500 }
    );
  }
  const generationId = genRow.id;

  // Insert all share rows.
  const shareInserts = shares.map((s) => ({
    key_generation_id: generationId,
    wallet_address: (s.walletAddress ?? "").toLowerCase(),
    share_index: s.shareIndex ?? 0,
    encrypted_share: base64ToHexLiteral(s.encryptedShareBase64 ?? ""),
  }));
  const { error: shareErr } = await supabase
    .from("coordinator_shares")
    .insert(shareInserts);
  if (shareErr) {
    console.error(
      "[key-generations] share insert failed, rolling back",
      shareErr
    );
    await supabase
      .from("coordinator_key_generations")
      .delete()
      .eq("id", generationId);
    return NextResponse.json({ error: shareErr.message }, { status: 500 });
  }

  await supabase.from("coordinator_audit_log").insert({
    event_type: "key_generated",
    actor_wallet: creatorWallet.toLowerCase(),
    target_id: generationId,
    payload: {
      governorAddress,
      pubkeyX,
      pubkeyY,
      threshold,
      totalShares,
      shareWallets: walletList,
    },
  });

  return NextResponse.json({
    ok: true,
    generationId,
    signedMessage,
  });
}

function base64ToHexLiteral(b64: string): string {
  const buf = Buffer.from(b64, "base64");
  return "\\x" + buf.toString("hex");
}
