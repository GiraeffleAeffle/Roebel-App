import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hexToBytes } from "@noble/hashes/utils";
import { bech32 } from "@scure/base";
import {
  NOSTR_KEY_DERIVATION_MESSAGE,
  deriveNostrIdentity,
  deriveNostrSecretKey,
  getPublicKeyHex,
  isNostrPubkey,
  npubDecode,
  npubEncode,
} from "../src/keys.js";

/** A realistic 65-byte ECDSA signature, as a wallet's personal_sign returns. */
const SIGNATURE =
  "0x" +
  "9c1f2b3a4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f8" +
  "1b2c3d4e5f60718293a4b5c6d7e8f9001a2b3c4d5e6f708192a3b4c5d6e7f809" +
  "1b";

const OTHER_SIGNATURE = SIGNATURE.slice(0, -4) + "aa1c";

describe("wallet → nostr key derivation", () => {
  it("is deterministic — the same signature always yields the same identity", () => {
    const a = deriveNostrIdentity(SIGNATURE);
    const b = deriveNostrIdentity(SIGNATURE);
    assert.deepEqual(a.secretKey, b.secretKey);
    assert.equal(a.publicKey, b.publicKey);
    assert.equal(a.npub, b.npub);
  });

  it("produces a different identity for a different signature", () => {
    assert.notEqual(
      deriveNostrIdentity(SIGNATURE).publicKey,
      deriveNostrIdentity(OTHER_SIGNATURE).publicKey,
    );
  });

  it("accepts the signature with or without the 0x prefix", () => {
    assert.equal(
      deriveNostrIdentity(SIGNATURE).publicKey,
      deriveNostrIdentity(SIGNATURE.slice(2)).publicKey,
    );
  });

  it("is case-insensitive about the signature hex", () => {
    assert.equal(
      deriveNostrIdentity(SIGNATURE).publicKey,
      deriveNostrIdentity(SIGNATURE.toUpperCase().replace("0X", "0x")).publicKey,
    );
  });

  it("yields a 32-byte secret key in the valid scalar range", () => {
    const key = deriveNostrSecretKey(SIGNATURE);
    assert.equal(key.length, 32);
    assert.ok(key.some((b) => b !== 0), "must not be zero");
  });

  it("yields a 32-byte x-only pubkey in allow-list shape", () => {
    const pubkey = getPublicKeyHex(deriveNostrSecretKey(SIGNATURE));
    assert.equal(pubkey.length, 64);
    assert.ok(isNostrPubkey(pubkey), "must match the relay allow-list format");
  });

  it("rejects a non-hex signature rather than deriving from garbage", () => {
    assert.throws(() => deriveNostrSecretKey("not a signature"));
    assert.throws(() => deriveNostrSecretKey("0x123"), /hex/);
  });

  it("pins the derivation message — changing it re-keys every Citizen", () => {
    assert.equal(NOSTR_KEY_DERIVATION_MESSAGE, "Netizen Nostr-Identität v1");
    assert.ok(
      !NOSTR_KEY_DERIVATION_MESSAGE.toLowerCase().includes("röbel"),
      "must stay node-independent so one wallet has one npub across all Netizen nodes",
    );
  });
});

describe("npub encoding (NIP-19)", () => {
  it("round-trips a pubkey", () => {
    const { publicKey, npub } = deriveNostrIdentity(SIGNATURE);
    assert.ok(npub.startsWith("npub1"));
    assert.equal(npubDecode(npub), publicKey);
  });

  it("matches the NIP-19 reference vector", () => {
    const hex = "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d";
    const npub = "npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6";
    assert.equal(npubEncode(hex), npub);
    assert.equal(npubDecode(npub), hex);
  });

  it("rejects a wrong-length pubkey", () => {
    assert.throws(() => npubEncode("abcd"), /32 bytes/);
  });

  it("rejects a well-formed bech32 string that is not an npub", () => {
    // Built with a valid checksum on purpose, so the prefix check is what
    // rejects it — not the checksum. An nsec must never be mistaken for an npub.
    const bytes = hexToBytes("3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d");
    const nsec = bech32.encode("nsec", bech32.toWords(bytes), 1000);
    assert.throws(() => npubDecode(nsec), /expected an npub/);
  });
});
