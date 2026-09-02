import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  deriveCurve25519PubkeyFromSignature,
  verifyIsProductionAttester,
  verifyWalletSignature,
} from "@/lib/shamir/signature-verification";

/**
 * GET /api/coordinator/share-keys
 *
 * Returns every registered (wallet → Curve25519 pubkey) mapping.
 * Used by the status page to render the 5/5 registration table.
 */
export async function GET() {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("coordinator_share_keys")
    .select(
      "wallet_address, curve25519_pubkey, challenge, registered_at, revoked_at"
    )
    .is("revoked_at", null)
    .order("registered_at", { ascending: true });

  if (error) {
    console.error("[coordinator/share-keys] select failed", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Return curve25519_pubkey as base64 for transport (bytea isn't JSON-safe).
  const rows = (data ?? []).map((row) => ({
    walletAddress: row.wallet_address,
    curve25519PubkeyBase64: toBase64(row.curve25519_pubkey),
    challenge: row.challenge,
    registeredAt: row.registered_at,
  }));

  return NextResponse.json({ registrations: rows });
}

/**
 * POST /api/coordinator/share-keys
 *
 * Body:
 *   walletAddress: 0x…
 *   challenge: SHARE_KEY_CHALLENGE constant from wallet-encryption.ts
 *   signature: 0x… (ECDSA personal_sign of `challenge`)
 *   curve25519PubkeyBase64: derived client-side from the signature
 *
 * Server-side checks:
 *   1. ECDSA signature matches walletAddress
 *   2. walletAddress holds the AttesterNFT (only Attesters can register)
 *   3. The Curve25519 pubkey published by the client matches what we
 *      derive server-side from the same signature (defeats tampering)
 * On success: upsert into coordinator_share_keys + insert audit row.
 *
 * Idempotent: re-running with the same wallet+sig returns 200 with the
 * existing row.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const { walletAddress, challenge, signature, curve25519PubkeyBase64 } =
    body as {
      walletAddress?: string;
      challenge?: string;
      signature?: string;
      curve25519PubkeyBase64?: string;
    };

  if (
    !walletAddress ||
    !challenge ||
    !signature ||
    !curve25519PubkeyBase64
  ) {
    return NextResponse.json(
      { error: "missing required fields" },
      { status: 400 }
    );
  }

  // 1) ECDSA signature check.
  if (!(await verifyWalletSignature(challenge, signature, walletAddress))) {
    return NextResponse.json(
      { error: "signature does not match walletAddress" },
      { status: 401 }
    );
  }

  // 2) AttesterNFT check (live read of Base mainnet).
  const isAttester = await verifyIsProductionAttester(walletAddress);
  if (!isAttester) {
    return NextResponse.json(
      { error: "walletAddress is not an Attester" },
      { status: 403 }
    );
  }

  // 3) Re-derive Curve25519 pubkey server-side and compare.
  const derived = deriveCurve25519PubkeyFromSignature(signature);
  const claimed = base64ToBytes(curve25519PubkeyBase64);
  if (!constantTimeEqual(derived, claimed)) {
    return NextResponse.json(
      { error: "curve25519 pubkey does not match signature" },
      { status: 401 }
    );
  }

  const supabase = createAdminClient();
  const normalized = walletAddress.toLowerCase();
  const { error: upsertErr } = await supabase
    .from("coordinator_share_keys")
    .upsert(
      {
        wallet_address: normalized,
        curve25519_pubkey: bytesToHexLiteral(claimed),
        challenge,
        signature,
        registered_at: new Date().toISOString(),
        revoked_at: null,
      },
      { onConflict: "wallet_address" }
    );
  if (upsertErr) {
    console.error("[coordinator/share-keys] upsert failed", upsertErr);
    return NextResponse.json({ error: upsertErr.message }, { status: 500 });
  }

  await supabase.from("coordinator_audit_log").insert({
    event_type: "share_key_registered",
    actor_wallet: normalized,
    target_id: normalized,
    payload: {
      challenge,
      curve25519PubkeyBase64,
    },
  });

  return NextResponse.json({ ok: true, walletAddress: normalized });
}

function toBase64(bytea: unknown): string {
  if (typeof bytea === "string") {
    // Supabase returns bytea as `\x<hex>` for the JS client. Convert.
    if (bytea.startsWith("\\x")) {
      return Buffer.from(bytea.slice(2), "hex").toString("base64");
    }
    return bytea;
  }
  if (bytea instanceof Buffer) return bytea.toString("base64");
  return "";
}

function base64ToBytes(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64, "base64"));
}

function bytesToHexLiteral(bytes: Uint8Array): string {
  // Postgres `bytea` accepts `\x<hex>` literal form when sent as a string.
  return (
    "\\x" +
    Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
  );
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
