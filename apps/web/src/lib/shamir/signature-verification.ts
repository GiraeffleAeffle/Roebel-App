/**
 * Server-side wallet/role verification for /api/coordinator/* routes.
 *
 * Everything in this file runs in a Next.js route handler with access to
 * the Supabase service role key. NEVER import from a client component.
 *
 * Wallet signature semantics: thirdweb's inAppWallet (and most EOAs) sign
 * a UTF-8 message with EIP-191 personal_sign. ethers v6's `verifyMessage`
 * implements the same recovery, so the standard pattern is:
 *
 *   recovered = verifyMessage(message, signature)
 *   ok       = recovered.toLowerCase() === expectedAddress.toLowerCase()
 *
 * Attester-NFT gating: read `hasAttesterNFT(address)` on the explicitly
 * production-pinned AttesterNFT. A staging Test-Bürger-Pass carries no
 * coordinator/founder authority and can never satisfy this gate.
 *
 * Founder gating: a small hard-coded allowlist of founder wallets that
 * are permitted to run /coordinator/generate-key. Lives here so it's
 * easy to find and review in code, not buried in config.
 */

import { Contract, JsonRpcProvider, hashMessage, verifyMessage } from "ethers";
import { readContract, getContract } from "thirdweb";
import { gnosis } from "@/lib/gnosis";
import { client } from "@/app/client";
import { resolveIdentityContractSet } from "@roebel/blockchain";

const productionIdentityContractSet = resolveIdentityContractSet();

/**
 * Founder allowlist. Keep this list of human-readable comments so any
 * future reviewer can immediately see who is on it and why.
 */
const FOUNDER_WALLETS = new Set<string>(
  [
    // Max — primary founder.
    "0xc49de63ccfee46c6c5c3e393293f66779799fb28",
  ].map((a) => a.toLowerCase())
);

const productionAttesterNftContract = getContract({
  client,
  address: productionIdentityContractSet.attesterNFT,
  chain: gnosis,
});

// ERC-1271 magic value returned by `isValidSignature(hash, sig)` when the
// signature is considered valid by the smart account contract.
const ERC1271_MAGIC_VALUE = "0x1626ba7e";

/**
 * Verify that `signature` is a valid signature over `message` produced
 * by `expectedAddress`. Handles both:
 *
 * 1. **EOA / EIP-191 personal_sign** — `ethers.verifyMessage` recovers
 *    the signing address; we compare it to `expectedAddress`.
 *
 * 2. **Smart-account / ERC-1271** — thirdweb's `inAppWallet + smartAccount`
 *    setup signs with the underlying inAppWallet EOA but `account.address`
 *    is the smart-account address. The raw EIP-191 recovery returns the
 *    EOA, not the smart account, so the comparison above fails. In that
 *    case we fall back to calling `isValidSignature(hash, signature)` on
 *    the smart account contract and check for the ERC-1271 magic value.
 *
 * The fallback only triggers when EIP-191 recovery doesn't match the
 * expected address AND the expected address is a contract (`code.length
 * > 0`). We never make an RPC call for a plain EOA.
 */
export async function verifyWalletSignature(
  message: string,
  signature: string,
  expectedAddress: string
): Promise<boolean> {
  // Fast path: plain EIP-191 recovery.
  try {
    const recovered = verifyMessage(message, signature);
    if (recovered.toLowerCase() === expectedAddress.toLowerCase()) {
      return true;
    }
  } catch {
    // fall through to ERC-1271
  }

  // ERC-1271 fallback for smart accounts. Smart accounts now live on Gnosis
  // (chainId 100), so the getCode/isValidSignature checks must hit a Gnosis
  // RPC. Prefer GNOSIS_RPC_URL; fall back to the legacy BASE_RPC_URL env name
  // and the public Gnosis RPC so the gate still works if only one is set.
  const rpcUrl =
    process.env.GNOSIS_RPC_URL ||
    process.env.BASE_RPC_URL ||
    "https://rpc.gnosischain.com";
  if (!rpcUrl) {
    console.warn(
      "[signature-verification] no RPC URL configured — cannot do ERC-1271 fallback"
    );
    return false;
  }
  try {
    const provider = new JsonRpcProvider(rpcUrl, undefined, { batchMaxCount: 1 });
    const code = await provider.getCode(expectedAddress);
    if (!code || code === "0x") {
      // EOA — and EIP-191 already failed. Signature is invalid.
      return false;
    }
    const contract = new Contract(
      expectedAddress,
      ["function isValidSignature(bytes32 hash, bytes signature) view returns (bytes4)"],
      provider
    );
    const hash = hashMessage(message);
    const result: string = await contract.isValidSignature(hash, signature);
    return (
      typeof result === "string" &&
      result.toLowerCase() === ERC1271_MAGIC_VALUE
    );
  } catch (err) {
    console.error("[signature-verification] ERC-1271 verify failed", err);
    return false;
  }
}

/**
 * Returns true if `address` currently holds an AttesterNFT.
 */
export async function verifyIsProductionAttester(address: string): Promise<boolean> {
  try {
    const has = (await readContract({
      contract: productionAttesterNftContract,
      method: "function hasAttesterNFT(address account) view returns (bool)",
      params: [address as `0x${string}`],
    })) as boolean;
    return Boolean(has);
  } catch (err) {
    console.error(
      "[signature-verification] hasAttesterNFT read failed",
      err
    );
    return false;
  }
}

/**
 * Returns true if `address` is on the founder allowlist.
 *
 * Note: founder-gating is independent of AttesterNFT membership. We
 * additionally require `verifyIsProductionAttester` in the same handler to ensure
 * the founder still holds the NFT (defense against an allowlisted
 * wallet that has been revoked).
 */
export function verifyIsFounder(address: string): boolean {
  return FOUNDER_WALLETS.has(address.toLowerCase());
}

/**
 * Convenience: re-derive the Curve25519 pubkey from a signature so the
 * server can confirm the client didn't tamper with the published pubkey.
 *
 * Mirrors deriveShareKeypairFromSignature in ./wallet-encryption.ts but
 * lives here to keep server bundles small (this file is server-only and
 * can use node:crypto directly without the SubtleCrypto fallback path).
 */
import { createHash } from "node:crypto";
import nacl from "tweetnacl";

export function deriveCurve25519PubkeyFromSignature(
  signatureHex: string
): Uint8Array {
  const sig = hexToBytes(signatureHex);
  const prefix = new TextEncoder().encode(
    "Roebel-Curve25519-share-key-v1\0"
  );
  const joined = new Uint8Array(prefix.length + sig.length);
  joined.set(prefix, 0);
  joined.set(sig, prefix.length);
  const seed = new Uint8Array(createHash("sha256").update(joined).digest());
  const kp = nacl.box.keyPair.fromSecretKey(seed);
  return kp.publicKey;
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}
