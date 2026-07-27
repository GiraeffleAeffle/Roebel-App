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
import {
  createPublicClient,
  decodeAbiParameters,
  hashMessage,
  http,
  recoverAddress,
  recoverMessageAddress,
  recoverTypedDataAddress,
} from "https://esm.sh/viem@2.21.0";
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
const ERC1271_MAGIC = "0x1626ba7e";

/**
 * Strip an ERC-6492 wrapper, if present.
 *
 * A 6492 signature is `abi.encode(factory, factoryCalldata, realSignature)`
 * followed by a 32-byte magic suffix. It exists so a signature can be validated
 * for an account that does not exist yet. Wallets sometimes emit it even for a
 * DEPLOYED account — and handing that blob to `isValidSignature` reverts inside
 * `ECDSA.recover`, because it is nothing like a 65-byte signature. Unwrapping
 * recovers the inner signature the deployed account can actually check.
 */
function unwrapErc6492(signature: string): string | null {
  if (!signature.toLowerCase().endsWith(ERC6492_SUFFIX)) return null;
  try {
    const payload = signature.slice(0, signature.length - ERC6492_SUFFIX.length) as `0x${string}`;
    const [, , inner] = decodeAbiParameters(
      [{ type: "address" }, { type: "bytes" }, { type: "bytes" }],
      payload,
    );
    return inner as string;
  } catch {
    return null;
  }
}

const GET_MESSAGE_HASH_ABI = [
  {
    name: "getMessageHash",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "hash", type: "bytes32" }],
    outputs: [{ name: "", type: "bytes32" }],
  },
] as const;

const IS_ADMIN_ABI = [
  {
    name: "isAdmin",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

/**
 * Verify by recovering the signer and asking the account whether it is an admin.
 *
 * Why not just trust `isValidSignature`? A thirdweb smart account signs a message
 * one of two ways — plain EIP-191 `personal_sign` by the admin EOA, or an EIP-712
 * `AccountMessage` wrap — and both produce a 65-byte signature. If the client
 * picks one convention and the deployed account expects the other, the account
 * recovers a stranger and REVERTS instead of returning a non-magic value. That is
 * exactly what the live diagnosis showed (`sigLen=132`, `erc6492=false`,
 * `reverted: "Account: ca…"`).
 *
 * Recovering the signer ourselves and checking `isAdmin` is convention-agnostic:
 * we try both digests, and admin-ness is still decided ON-CHAIN by the account
 * itself, so this loosens nothing about who is allowed to bind an identity.
 */
async function verifyByAdminRecovery(
  wallet: string,
  statement: string,
  signature: string,
): Promise<{ ok: boolean; outcome: string }> {
  const candidates: { label: string; address: string }[] = [];

  try {
    candidates.push({
      label: "personal_sign",
      address: await recoverMessageAddress({
        message: statement,
        signature: signature as `0x${string}`,
      }),
    });
  } catch (error) {
    candidates.push({ label: "personal_sign", address: `recover-failed:${String(error).slice(0, 40)}` });
  }

  try {
    candidates.push({
      label: "eip712-AccountMessage",
      address: await recoverTypedDataAddress({
        domain: {
          name: "Account",
          version: "1",
          chainId: gnosis.id,
          verifyingContract: wallet as `0x${string}`,
        },
        types: { AccountMessage: [{ name: "message", type: "bytes" }] },
        primaryType: "AccountMessage",
        message: { message: hashMessage(statement) },
        signature: signature as `0x${string}`,
      }),
    });
  } catch (error) {
    candidates.push({
      label: "eip712-AccountMessage",
      address: `recover-failed:${String(error).slice(0, 40)}`,
    });
  }

  // Most authoritative candidate: ask the account for the digest IT expects
  // (`getMessageHash`) and recover from that. This depends on no assumption about
  // the signing convention — the contract states its own terms.
  try {
    const expected = await chainClient.readContract({
      address: wallet as `0x${string}`,
      abi: GET_MESSAGE_HASH_ABI,
      functionName: "getMessageHash",
      args: [hashMessage(statement)],
    });
    candidates.unshift({
      label: "account-getMessageHash",
      address: await recoverAddress({
        hash: expected as `0x${string}`,
        signature: signature as `0x${string}`,
      }),
    });
  } catch (error) {
    candidates.push({
      label: "account-getMessageHash",
      address: `unavailable:${String(error).slice(0, 40)}`,
    });
  }

  const tried: string[] = [];
  for (const candidate of candidates) {
    if (!candidate.address.startsWith("0x")) {
      tried.push(`${candidate.label}=${candidate.address}`);
      continue;
    }
    try {
      const isAdmin = await chainClient.readContract({
        address: wallet as `0x${string}`,
        abi: IS_ADMIN_ABI,
        functionName: "isAdmin",
        args: [candidate.address as `0x${string}`],
      });
      if (isAdmin) return { ok: true, outcome: `admin-via-${candidate.label}` };
      // Report WHICH address was recovered. "not-admin" alone cannot distinguish
      // "we reconstructed the wrong message" from "the signer really isn't an
      // admin", and those need opposite fixes.
      tried.push(`${candidate.label}->${candidate.address}(not-admin)`);
    } catch (error) {
      tried.push(`${candidate.label}=isAdmin-failed(${String(error).slice(0, 60)})`);
    }
  }
  return { ok: false, outcome: tried.join(" | ") };
}

async function callErc1271(
  wallet: string,
  hash: string,
  signature: string,
): Promise<{ ok: boolean; outcome: string }> {
  try {
    const result = await chainClient.readContract({
      address: wallet as `0x${string}`,
      abi: ERC1271_ABI,
      functionName: "isValidSignature",
      args: [hash as `0x${string}`, signature as `0x${string}`],
    });
    return { ok: result === ERC1271_MAGIC, outcome: `returned-${result}` };
  } catch (error) {
    // Keep enough of the revert reason to be useful — the last cap truncated the
    // thirdweb error to "Account: ca" and cost a round trip.
    return { ok: false, outcome: `reverted(${String(error).slice(0, 220)})` };
  }
}

async function diagnoseSignature(
  wallet: string,
  statement: string,
  signature: string,
): Promise<{ deployed: boolean; valid: boolean; code: string; detail: string }> {
  let deployed = false;
  try {
    const bytecode = await chainClient.getBytecode({ address: wallet as `0x${string}` });
    deployed = !!bytecode && bytecode !== "0x";
  } catch (error) {
    return {
      deployed: true,
      valid: false,
      code: "code-check-failed",
      detail: String(error).slice(0, 200),
    };
  }
  if (!deployed) return { deployed: false, valid: false, code: "no-bytecode", detail: "" };

  const hash = hashMessage(statement);
  const inner = unwrapErc6492(signature);

  // Try the unwrapped signature FIRST when there is one: for a deployed account
  // that is the only form it can validate.
  const attempts: { label: string; sig: string }[] = [];
  if (inner) attempts.push({ label: "erc6492-inner", sig: inner });
  attempts.push({ label: "raw", sig: signature });

  const outcomes: string[] = [];
  for (const attempt of attempts) {
    const { ok, outcome } = await callErc1271(wallet, hash, attempt.sig);
    if (ok) {
      return {
        deployed: true,
        valid: true,
        code: `valid-via-${attempt.label}`,
        detail: `sigLen=${signature.length}`,
      };
    }
    outcomes.push(`${attempt.label}:${outcome}`);
  }

  // ERC-1271 said no in every form. Before rejecting, recover the signer and ask
  // the account whether it is an admin — that survives a signing-convention
  // mismatch, which is the common cause of a revert here.
  const recovery = await verifyByAdminRecovery(wallet, statement, signature);
  if (recovery.ok) {
    return {
      deployed: true,
      valid: true,
      code: `valid-via-${recovery.outcome}`,
      detail: `sigLen=${signature.length}`,
    };
  }

  return {
    deployed: true,
    valid: false,
    code: inner ? "erc6492-unwrapped-still-invalid" : "reverted",
    // TEMPORARY (debugging): echo the signature and the exact statement bytes.
    // Every recovery path lands on a different pseudorandom address, which means
    // the signed payload is not the statement we reconstruct — and the only way
    // to find out what WAS signed is to work backwards from the signature itself.
    // Remove this once the convention is identified: a signature over a public
    // statement is not a secret, but it does not belong in a user-facing error.
    detail:
      `sigLen=${signature.length} erc6492=${!!inner} ${outcomes.join(" | ")}` +
      ` || recovery: ${recovery.outcome}` +
      ` || sig=${signature}` +
      ` || stmtHash=${hashMessage(statement)}`,
  };
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

    if (diagnosis.valid) {
      // The account itself returned the ERC-1271 magic value — the signature IS
      // valid and viem's helper was what failed. A contract is the authority on
      // its own signatures, so trust it over the helper.
      console.log(`accepting on direct ERC-1271: ${diagnosis.code}`);
      walletSignatureValid = true;
    } else if (!diagnosis.deployed) {
      return bad("wallet-not-deployed");
    } else {
      // Carry the detail into the response too: it is the caller's own data, and
      // it saves a round trip through the function logs to find out what happened.
      return bad(`wallet-signature-invalid:${diagnosis.code} [${diagnosis.detail}]`);
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
