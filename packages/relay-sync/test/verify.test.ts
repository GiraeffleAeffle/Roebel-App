import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildBindingEvent, deriveNostrIdentity } from "@netizen-labs/nostr";
import type { ChainVerifier, RegistryRow } from "../src/types.js";
import { verifyRegistryRow } from "../src/verify.js";

const SIGNATURE =
  "0x" +
  "9c1f2b3a4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f8" +
  "1b2c3d4e5f60718293a4b5c6d7e8f9001a2b3c4d5e6f708192a3b4c5d6e7f809" +
  "1b";

const IDENTITY = deriveNostrIdentity(SIGNATURE);
const WALLET = "0x59aa26f499d7c2b3ec2c8524ed06f54fc4e85de5";

function row(overrides: Partial<RegistryRow> = {}): RegistryRow {
  return {
    wallet_address: WALLET,
    pubkey_hex: IDENTITY.publicKey,
    npub: IDENTITY.npub,
    eth_signature: "0x" + "ab".repeat(65),
    binding_event: buildBindingEvent(IDENTITY.secretKey, WALLET, { createdAt: 1_753_600_000 }),
    revoked_at: null,
    ...overrides,
  };
}

function chain(overrides: Partial<ChainVerifier> = {}): ChainVerifier {
  return {
    verifyWalletSignature: async () => true,
    holdsCitizenNft: async () => true,
    ...overrides,
  };
}

describe("admitting a Citizen", () => {
  it("allows a row where both halves verify and the NFT is held", async () => {
    const outcome = await verifyRegistryRow(row(), chain());
    assert.equal(outcome.allowed, true);
    assert.equal(outcome.allowed === true && outcome.pubkey, IDENTITY.publicKey);
  });

  it("passes the exact binding statement to the wallet verifier", async () => {
    const seen: Array<{ address: string; message: string; signature: string }> = [];
    await verifyRegistryRow(
      row(),
      chain({
        verifyWalletSignature: async (args) => {
          seen.push(args);
          return true;
        },
      }),
    );
    assert.equal(seen.length, 1);
    assert.equal(seen[0].address, WALLET);
    assert.ok(seen[0].message.startsWith("Netizen Nostr-Binding v1\n"));
    assert.ok(seen[0].message.includes(`npub=${IDENTITY.npub}`));
  });

  it("normalizes a checksummed address before verifying", async () => {
    const outcome = await verifyRegistryRow(
      row({ wallet_address: "0x59aA26f499D7C2B3EC2c8524Ed06F54fc4E85dE5" }),
      chain(),
    );
    assert.equal(outcome.allowed, true);
  });
});

describe("rejecting a row", () => {
  it("rejects a revoked row without touching the chain", async () => {
    let called = false;
    const outcome = await verifyRegistryRow(
      row({ revoked_at: "2026-07-27T10:00:00Z" }),
      chain({
        holdsCitizenNft: async () => {
          called = true;
          return true;
        },
      }),
    );
    assert.equal(outcome.allowed === false && outcome.reason, "revoked");
    assert.equal(called, false, "must short-circuit before any RPC");
  });

  it("rejects a malformed row", async () => {
    const outcome = await verifyRegistryRow(row({ wallet_address: "nonsense" }), chain());
    assert.equal(outcome.allowed === false && outcome.reason, "malformed-row");
  });

  it("rejects a binding signed for a different wallet", async () => {
    const other = "0x0000000000000000000000000000000000000abc";
    const outcome = await verifyRegistryRow(
      row({ binding_event: buildBindingEvent(IDENTITY.secretKey, other, { createdAt: 1 }) }),
      chain(),
    );
    assert.equal(outcome.allowed === false && outcome.reason, "binding-account-mismatch");
  });

  it("rejects a tampered binding event", async () => {
    const event = buildBindingEvent(IDENTITY.secretKey, WALLET, { createdAt: 1 });
    const outcome = await verifyRegistryRow(
      row({ binding_event: { ...event, sig: "0".repeat(128) } }),
      chain(),
    );
    assert.equal(outcome.allowed === false && outcome.reason, "binding-bad-signature");
  });

  it("rejects a row whose stored pubkey is not the one that signed the binding", async () => {
    const impostor = deriveNostrIdentity(SIGNATURE.slice(0, -4) + "aa1c");
    const outcome = await verifyRegistryRow(row({ pubkey_hex: impostor.publicKey }), chain());
    assert.equal(outcome.allowed === false && outcome.reason, "pubkey-mismatch");
  });

  it("rejects an invalid wallet signature", async () => {
    const outcome = await verifyRegistryRow(
      row(),
      chain({ verifyWalletSignature: async () => false }),
    );
    assert.equal(outcome.allowed === false && outcome.reason, "wallet-signature-invalid");
  });

  it("rejects a wallet that no longer holds a CitizenNFT — this is revocation", async () => {
    const outcome = await verifyRegistryRow(row(), chain({ holdsCitizenNft: async () => false }));
    assert.equal(outcome.allowed === false && outcome.reason, "not-a-citizen");
  });
});

describe("RPC failures", () => {
  it("propagates a signature-check failure instead of reporting invalid", async () => {
    await assert.rejects(
      verifyRegistryRow(
        row(),
        chain({
          verifyWalletSignature: async () => {
            throw new Error("ECONNREFUSED");
          },
        }),
      ),
      /ECONNREFUSED/,
    );
  });

  it("propagates an NFT-check failure instead of reporting not-a-citizen", async () => {
    await assert.rejects(
      verifyRegistryRow(
        row(),
        chain({
          holdsCitizenNft: async () => {
            throw new Error("rpc timeout");
          },
        }),
      ),
      /rpc timeout/,
    );
  });
});
