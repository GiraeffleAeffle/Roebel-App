import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hashMessage, hashTypedData } from "viem";
import { SIGNING_CHAIN_IDS, recoverCandidateSigners } from "../src/signature.js";

/**
 * Regression fixture from a REAL failed registration on 2026-07-27.
 *
 * A thirdweb smart account on Gnosis produced this signature, and every
 * conventional check rejected it: `verifyMessage` returned false and
 * `isValidSignature` reverted with "Account: caller not approved target." The
 * cause was that the app's wallet is configured for Base, so the EIP-712 domain
 * carries chainId 8453 while the account is verified on Gnosis (100).
 *
 * These values are public: a signature over a public statement, a contract
 * address, and an admin address — all readable on-chain.
 */
const ACCOUNT = "0xc49de63ccfee46c6c5c3e393293f66779799fb28";
const ADMIN = "0xd55b555ff6407670036aba557f0eb2ad10b325db";
const SIGNATURE =
  "0x212897179e0a5eb2eb15bfd5b0de244a65f561e69f303e4bc84629f59824ad46" +
  "048e80ebefa3f5d6cd94cee9c09a56711c831c6806301e8de86980d1c240c8f11b";
const STATEMENT = [
  "Netizen Nostr-Binding v1",
  `account=${ACCOUNT}`,
  "npub=npub1fk70tqgmja3pyc3mwhmh3ca7gpry86e0yq9mhzkga0m0gmlv4s9qzx8ku9",
].join("\n");

/** The digest a thirdweb Account computes in `getMessageHash`, for a given chain. */
const accountDigestFor = (chainId: number) =>
  hashTypedData({
    domain: { name: "Account", version: "1", chainId, verifyingContract: ACCOUNT as `0x${string}` },
    types: { AccountMessage: [{ name: "message", type: "bytes" }] },
    primaryType: "AccountMessage",
    message: { message: hashMessage(STATEMENT) },
  });

describe("smart-account signer recovery", () => {
  it("recovers the account admin from a Base-domain signature", async () => {
    // THE regression. If this ever fails, a Citizen whose wallet signs with one
    // chain's domain can no longer register on another — the exact bug that cost
    // a full debugging cycle.
    const candidates = await recoverCandidateSigners({
      account: ACCOUNT,
      message: STATEMENT,
      signature: SIGNATURE,
    });
    const matched = candidates.filter((c) => c.address === ADMIN);
    assert.ok(matched.length > 0, `no candidate recovered the admin: ${JSON.stringify(candidates)}`);
    assert.ok(
      matched.some((c) => c.label === "eip712-cid8453"),
      "the Base-domain candidate is the one that must match",
    );
  });

  it("also accepts the account's own getMessageHash digest", async () => {
    const candidates = await recoverCandidateSigners({
      account: ACCOUNT,
      message: STATEMENT,
      signature: SIGNATURE,
      accountDigest: accountDigestFor(8453),
    });
    const viaAccount = candidates.find((c) => c.label === "account-getMessageHash");
    assert.equal(viaAccount?.address, ADMIN);
  });

  it("covers both the deployment chain and the signing chain", () => {
    assert.ok(SIGNING_CHAIN_IDS.includes(100), "Gnosis — where accounts are deployed");
    assert.ok(SIGNING_CHAIN_IDS.includes(8453), "Base — what the app's wallet still signs with");
  });

  it("does not recover the admin for a tampered message", async () => {
    const candidates = await recoverCandidateSigners({
      account: ACCOUNT,
      message: STATEMENT.replace("Netizen", "NetizeN"),
      signature: SIGNATURE,
    });
    assert.equal(
      candidates.filter((c) => c.address === ADMIN).length,
      0,
      "a different message must not recover the admin — that would forge a binding",
    );
  });

  it("does not recover the admin for a different account address", async () => {
    const candidates = await recoverCandidateSigners({
      account: "0x0000000000000000000000000000000000000001",
      message: STATEMENT,
      signature: SIGNATURE,
    });
    // personal_sign does not involve the account address, so only the EIP-712
    // candidates change — none of them may land on the admin.
    assert.equal(
      candidates.filter((c) => c.label.startsWith("eip712") && c.address === ADMIN).length,
      0,
    );
  });

  it("never throws on a malformed signature", async () => {
    const candidates = await recoverCandidateSigners({
      account: ACCOUNT,
      message: STATEMENT,
      signature: "0xdeadbeef",
    });
    assert.equal(candidates.filter((c) => c.address === ADMIN).length, 0);
  });
});
