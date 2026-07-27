// Edge Function: nostr-identity-register
//
// The write path into the PRIVATE `nostr_identities` registry. The app cannot
// insert directly: that table has RLS enabled with no policies, so the anon key
// has zero access (see supabase/migrations/20260727_nostr_identity_bridge.sql for
// why it is private while the rest of the schema is permissive).
//
// This function verifies BOTH halves of the wallet↔npub binding before writing:
//   1. the Nostr half — a signed NIP-78 event, verified offline (Schnorr/BIP-340)
//   2. the Ethereum half — verified via ERC-1271, because a Citizen's wallet is an
//      ERC-4337 smart account with no key of its own to ecrecover against
//
// Verifying the Ethereum half here (not just in the syncer) is what stops a
// griefing upsert: without it, anyone could overwrite a Citizen's row with a
// binding made by their own Nostr key naming the victim's wallet, and knock the
// victim off the relay allow-list.
//
// CitizenNFT ownership is deliberately NOT checked here — registering early is
// harmless, since the allow-list syncer verifies membership on every pass.
//
// Auto env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY. Optional: GNOSIS_RPC_URL.
// Logic mirrors packages/nostr (binding.ts, events.ts, keys.ts) — that package is
// the source of truth; this is its Deno-side twin.
import { createPublicClient, hashMessage, http } from "https://esm.sh/viem@2.21.0";
import { gnosis } from "https://esm.sh/viem@2.21.0/chains";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { schnorr } from "https://esm.sh/@noble/curves@1.9.7/secp256k1";
import { sha256 } from "https://esm.sh/@noble/hashes@1.8.0/sha256";
import { bytesToHex, hexToBytes, utf8ToBytes } from "https://esm.sh/@noble/hashes@1.8.0/utils";
import { bech32 } from "https://esm.sh/@scure/base@1.2.6";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

const BINDING_KIND = 30078;
const BINDING_D_TAG = "netizen:binding:v1";
const BINDING_ACCOUNT_TAG = "netizen_account";

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const chainClient = createPublicClient({
  chain: gnosis,
  transport: http(Deno.env.get("GNOSIS_RPC_URL") || undefined),
});

interface NostrEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

function npubEncode(pubkeyHex: string): string {
  return bech32.encode("npub", bech32.toWords(hexToBytes(pubkeyHex)), 1000);
}

function eventId(event: NostrEvent): string {
  const serialized = JSON.stringify([
    0,
    event.pubkey,
    event.created_at,
    event.kind,
    event.tags,
    event.content,
  ]);
  return bytesToHex(sha256(utf8ToBytes(serialized)));
}

function bindingStatement(account: string, npub: string): string {
  return ["Netizen Nostr-Binding v1", `account=${account.toLowerCase()}`, `npub=${npub}`].join("\n");
}

/** Verify the Nostr half. Returns the reason it failed, or null on success. */
function verifyBindingEvent(event: NostrEvent, wallet: string): string | null {
  if (event.kind !== BINDING_KIND) return "binding-wrong-kind";
  if (event.tags.find((t) => t[0] === "d")?.[1] !== BINDING_D_TAG) return "binding-wrong-d-tag";

  const tagged = event.tags.find((t) => t[0] === BINDING_ACCOUNT_TAG)?.[1]?.toLowerCase();
  if (tagged !== wallet) return "binding-account-mismatch";

  // Recompute the statement from the event's OWN pubkey, so a valid binding
  // cannot be replayed under a different identity.
  if (event.content !== bindingStatement(wallet, npubEncode(event.pubkey))) {
    return "binding-statement-mismatch";
  }

  try {
    if (eventId(event) !== event.id) return "binding-bad-id";
    if (!schnorr.verify(hexToBytes(event.sig), hexToBytes(event.id), hexToBytes(event.pubkey))) {
      return "binding-bad-signature";
    }
  } catch {
    return "binding-malformed";
  }
  return null;
}

const ERC1271_ABI = [
  {
    name: "isValidSignature",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "hash", type: "bytes32" },
      { name: "signature", type: "bytes" },
    ],
    outputs: [{ name: "", type: "bytes4" }],
  },
] as const;

/** ERC-6492 magic suffix marking a signature for a not-yet-deployed account. */
const ERC6492_SUFFIX = "6492".repeat(16);

/**
 * Work out WHY an ERC-1271 check failed.
 *
 * Smart-account signing has several incompatible conventions (raw EIP-191 hash,
 * an EIP-712 `AccountMessage` re-wrap as thirdweb's Account does, ERC-6492 for
 * counterfactual accounts). A bare `false` cannot tell them apart, and each needs
 * a different fix — so ask the contract directly and report the outcome.
 */
async function diagnoseSignature(
  wallet: string,
  statement: string,
  signature: string,
): Promise<{ deployed: boolean; code: string; detail: string }> {
  let deployed = false;
  try {
    const bytecode = await chainClient.getBytecode({ address: wallet as `0x${string}` });
    deployed = !!bytecode && bytecode !== "0x";
  } catch (error) {
    return { deployed: true, code: "code-check-failed", detail: String(error).slice(0, 200) };
  }
  if (!deployed) return { deployed: false, code: "no-bytecode", detail: "" };

  const wrapped = signature.toLowerCase().endsWith(ERC6492_SUFFIX);
  try {
    const result = await chainClient.readContract({
      address: wallet as `0x${string}`,
      abi: ERC1271_ABI,
      functionName: "isValidSignature",
      args: [hashMessage(statement), signature as `0x${string}`],
    });
    // 0x1626ba7e is the ERC-1271 magic value. Anything else is a considered "no".
    return {
      deployed: true,
      code: result === "0x1626ba7e" ? "magic-ok-but-viem-said-no" : `returned-${result}`,
      detail: `sigLen=${signature.length} erc6492=${wrapped}`,
    };
  } catch (error) {
    return {
      deployed: true,
      code: "reverted",
      detail: `sigLen=${signature.length} erc6492=${wrapped} ${String(error).slice(0, 300)}`,
    };
  }
}

function bad(message: string, status = 400): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "POST") return bad("POST only", 405);

  let body: {
    wallet?: string;
    pubkey_hex?: string;
    eth_signature?: string;
    binding_event?: NostrEvent;
  };
  try {
    body = await request.json();
  } catch {
    return bad("invalid JSON");
  }

  const wallet = (body.wallet ?? "").toLowerCase();
  const pubkeyHex = (body.pubkey_hex ?? "").toLowerCase();
  const { eth_signature: ethSignature, binding_event: bindingEvent } = body;

  if (!/^0x[0-9a-f]{40}$/.test(wallet)) return bad("wallet must be an EVM address");
  if (!/^[0-9a-f]{64}$/.test(pubkeyHex)) return bad("pubkey_hex must be 64 lowercase hex chars");
  if (!ethSignature || !bindingEvent) return bad("eth_signature and binding_event are required");
  if (bindingEvent.pubkey?.toLowerCase() !== pubkeyHex) return bad("pubkey_hex does not match the binding event");

  const bindingFailure = verifyBindingEvent(bindingEvent, wallet);
  if (bindingFailure) return bad(bindingFailure);

  const npub = npubEncode(pubkeyHex);

  let walletSignatureValid: boolean;
  try {
    walletSignatureValid = await chainClient.verifyMessage({
      address: wallet as `0x${string}`,
      message: bindingStatement(wallet, npub),
      signature: ethSignature as `0x${string}`,
    });
  } catch (error) {
    // An unreachable RPC must not look like a bad signature — the caller should
    // retry rather than be told their wallet failed to sign.
    console.error("ERC-1271 verification failed to complete:", error);
    return bad("could not verify the wallet signature right now — please retry", 503);
  }
  if (!walletSignatureValid) {
    // viem's verifyMessage collapses several very different failures into one
    // `false`. Ask the contract directly instead of guessing which one it was.
    const diagnosis = await diagnoseSignature(wallet, bindingStatement(wallet, npub), ethSignature);
    console.error("ERC-1271 rejected:", JSON.stringify(diagnosis));

    if (diagnosis.code === "magic-ok-but-viem-said-no") {
      // The account itself returned the ERC-1271 magic value: the signature IS
      // valid and viem's helper was the thing that failed. The contract is the
      // authority on its own signatures, so trust it.
      console.log("accepting on direct ERC-1271 magic value");
      walletSignatureValid = true;
    } else if (!diagnosis.deployed) {
      return bad("wallet-not-deployed");
    } else {
      return bad(`wallet-signature-invalid:${diagnosis.code}`);
    }
  }

  const { error } = await db.from("nostr_identities").upsert(
    {
      wallet_address: wallet,
      pubkey_hex: pubkeyHex,
      npub,
      eth_signature: ethSignature,
      binding_event: bindingEvent,
      revoked_at: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "wallet_address" },
  );

  if (error) {
    // The UNIQUE constraint on pubkey_hex is what surfaces here if two wallets
    // ever claim the same Nostr key.
    console.error("registry upsert failed:", error);
    return bad(error.message, 409);
  }

  return new Response(JSON.stringify({ status: "registered", npub, pubkey_hex: pubkeyHex }), {
    headers: { ...cors, "Content-Type": "application/json" },
  });
});
