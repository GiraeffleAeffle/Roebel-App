import { schnorr } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";
import { bech32 } from "@scure/base";

/**
 * Wallet → Nostr identity.
 *
 * A Nostr key is secp256k1 **Schnorr / BIP-340 x-only** — an Ethereum address is
 * not one, and an ERC-4337 smart account has no private key at all. So a
 * Citizen's Nostr key is *derived* from a signature their wallet produces over a
 * fixed canonical message: deterministic in, deterministic out, so the same
 * wallet reproduces the same npub on every device and after any reinstall.
 *
 * Precedent in this repo: MACI voting keys use exactly this shape
 * (apps/expo/context/MaciContext.tsx).
 */

/**
 * The canonical message a wallet signs to derive its Nostr identity.
 *
 * Deliberately **node-independent** — no "Röbel", no node id. One wallet has one
 * Nostr identity across every Netizen node, which is the portable identity the
 * federation phase depends on. Changing this string re-keys every Citizen, so it
 * is versioned and must never be edited in place.
 */
export const NOSTR_KEY_DERIVATION_MESSAGE = "Netizen Nostr-Identität v1";

/** secp256k1 group order. */
const CURVE_ORDER =
  0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

function normalizeHex(input: string): Uint8Array {
  const stripped = input.startsWith("0x") || input.startsWith("0X") ? input.slice(2) : input;
  if (stripped.length === 0 || stripped.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(stripped)) {
    throw new Error("expected a hex string");
  }
  return hexToBytes(stripped.toLowerCase());
}

function bytesToBigInt(bytes: Uint8Array): bigint {
  let out = 0n;
  for (const b of bytes) out = (out << 8n) | BigInt(b);
  return out;
}

function bigIntTo32Bytes(value: bigint): Uint8Array {
  const out = new Uint8Array(32);
  let v = value;
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

/**
 * Derive a Nostr secret key from a wallet signature.
 *
 * `keccak256(signature)` reduced into `[1, n-1]` — the reduction is what
 * guarantees a valid scalar (a raw hash can land on 0 or above the group order;
 * astronomically unlikely, but "astronomically unlikely" is not "impossible" and
 * this costs one modulo).
 */
export function deriveNostrSecretKey(signature: string): Uint8Array {
  const digest = keccak_256(normalizeHex(signature));
  const scalar = (bytesToBigInt(digest) % (CURVE_ORDER - 1n)) + 1n;
  return bigIntTo32Bytes(scalar);
}

/** x-only (32-byte) public key for a secret key, as lowercase hex. */
export function getPublicKeyHex(secretKey: Uint8Array): string {
  return bytesToHex(schnorr.getPublicKey(secretKey));
}

/** Derive the full identity — secret key, hex pubkey and npub — from a wallet signature. */
export function deriveNostrIdentity(signature: string): {
  secretKey: Uint8Array;
  publicKey: string;
  npub: string;
} {
  const secretKey = deriveNostrSecretKey(signature);
  const publicKey = getPublicKeyHex(secretKey);
  return { secretKey, publicKey, npub: npubEncode(publicKey) };
}

/** NIP-19 bech32 encoding of an x-only pubkey. */
export function npubEncode(publicKeyHex: string): string {
  const bytes = normalizeHex(publicKeyHex);
  if (bytes.length !== 32) throw new Error("a nostr pubkey is 32 bytes");
  return bech32.encode("npub", bech32.toWords(bytes), 1000);
}

/** NIP-19 bech32 decoding back to lowercase hex. Throws on a non-npub. */
export function npubDecode(npub: string): string {
  const { prefix, words } = bech32.decode(npub as `${string}1${string}`, 1000);
  if (prefix !== "npub") throw new Error(`expected an npub, got "${prefix}"`);
  return bytesToHex(new Uint8Array(bech32.fromWords(words)));
}

/**
 * NIP-19 bech32 encoding of a SECRET key — the import format every Nostr
 * client (including the Buzz workspace apps) accepts. Exists for the citizen's
 * own export flow; the node never calls this on a citizen's key, because the
 * node never holds one (custody rule, identity-bridge spec).
 */
export function nsecEncode(secretKey: Uint8Array): string {
  if (secretKey.length !== 32) throw new Error("a nostr secret key is 32 bytes");
  return bech32.encode("nsec", bech32.toWords(secretKey), 1000);
}

/** True for a lowercase 64-hex Nostr pubkey — the shape the relay allow-list stores. */
export function isNostrPubkey(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value);
}
