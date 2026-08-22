import assert from "node:assert/strict";
import { test } from "node:test";

import { deriveNostrIdentity } from "@netizen-labs/nostr";

import { createCredentialLinkProof } from "../src/lib/citizen-session/credential-link";
import { createPasskeySafeCitizenSession } from "../src/lib/citizen-session/passkey-safe-adapter";
import { createThirdwebCitizenSession } from "../src/lib/citizen-session/thirdweb-adapter";
import {
  createCredentialLinkServer,
  createMemoryCredentialLinkChallengeStore,
  type CredentialControlVerifier,
} from "../src/lib/server/citizen-credential-link";

const MEMBER_ID = "018f1c63-7b2a-7a11-8a55-2e3d9c4b5a61";
const ACCOUNT_ID = "018f1c63-7b2a-7a11-8a55-2e3d9c4b5a62";
const CHALLENGE_ID = "018f1c63-7b2a-7a11-8a55-2e3d9c4b5a63";
const CURRENT_ADDRESS = "0x1111111111111111111111111111111111111111";
const SAFE_ADDRESS = "0x2222222222222222222222222222222222222222";
const CURRENT_SIGNATURE = `0x${"42".repeat(65)}`;
const SAFE_SIGNATURE = `0x${"43".repeat(65)}`;
const NOW = new Date("2026-08-22T08:00:00.000Z");
const LATER = new Date("2026-08-22T08:01:00.000Z");

function sessions() {
  return {
    current: createThirdwebCitizenSession({
      account: {
        address: CURRENT_ADDRESS,
        signMessage: async () => CURRENT_SIGNATURE,
      },
      memberId: MEMBER_ID,
      appAccountId: ACCOUNT_ID,
    }),
    next: createPasskeySafeCitizenSession({
      account: {
        address: SAFE_ADDRESS,
        signMessage: async () => SAFE_SIGNATURE,
      },
      memberId: MEMBER_ID,
      appAccountId: ACCOUNT_ID,
    }),
  };
}

function createServer(
  input: {
    store?: ReturnType<typeof createMemoryCredentialLinkChallengeStore>;
    verifier?: CredentialControlVerifier;
    now?: () => Date;
  } = {}
) {
  const calls: Parameters<CredentialControlVerifier>[0][] = [];
  const verifier: CredentialControlVerifier =
    input.verifier ??
    (async (call) => {
      calls.push(call);
      return true;
    });
  const store = input.store ?? createMemoryCredentialLinkChallengeStore();
  const server = createCredentialLinkServer({
    store,
    verifyCredentialControl: verifier,
    now: input.now ?? (() => NOW),
    generateChallengeId: () => CHALLENGE_ID,
    generateNonce: () => "ab".repeat(32),
  });
  return { server, store, calls };
}

async function issuedProof(input: {
  server: ReturnType<typeof createCredentialLinkServer>;
}) {
  const challenge = await input.server.issueChallenge({
    memberId: MEMBER_ID,
    appAccountId: ACCOUNT_ID,
    currentCredential: {
      kind: "thirdweb_smart_account",
      address: CURRENT_ADDRESS,
      chainId: 100,
    },
    nostrPubkey: deriveNostrIdentity(CURRENT_SIGNATURE).publicKey,
  });
  const { current, next } = sessions();
  const proof = await createCredentialLinkProof({
    challenge,
    currentSession: current,
    nextSession: next,
    now: NOW,
  });
  current.dispose();
  next.dispose();
  return { challenge, proof };
}

test("issues one short-lived challenge from a trusted identity subject", async () => {
  const { server } = createServer();
  const challenge = await server.issueChallenge({
    memberId: MEMBER_ID,
    appAccountId: ACCOUNT_ID,
    currentCredential: {
      kind: "thirdweb_smart_account",
      address: CURRENT_ADDRESS,
      chainId: 100,
    },
    nostrPubkey: deriveNostrIdentity(CURRENT_SIGNATURE).publicKey,
  });

  assert.equal(challenge.challengeId, CHALLENGE_ID);
  assert.equal(challenge.nonce, "ab".repeat(32));
  assert.equal(challenge.issuedAt, "2026-08-22T08:00:00.000Z");
  assert.equal(challenge.expiresAt, "2026-08-22T08:05:00.000Z");
  assert.equal(challenge.memberId, MEMBER_ID);
  assert.equal(challenge.appAccountId, ACCOUNT_ID);
  assert.equal(challenge.nostrPubkey.length, 64);
});

test("consumes the exact challenge and verifies all three control proofs", async () => {
  let current = NOW;
  const { server, calls } = createServer({ now: () => current });
  const { proof } = await issuedProof({ server });
  current = LATER;

  const receipt = await server.verifyProof(proof);

  assert.equal(receipt.state, "verified_no_effect");
  assert.equal(receipt.persistence, "not_written");
  assert.equal(receipt.authorityBinding, "none");
  assert.equal(receipt.memberId, MEMBER_ID);
  assert.equal(receipt.appAccountId, ACCOUNT_ID);
  assert.equal(receipt.nostrPubkey, proof.candidate.nostrPubkey);
  assert.deepEqual(receipt.verification, {
    challengeConsumed: true,
    currentAdmissionSignature: true,
    currentLinkSignature: true,
    nextLinkSignature: true,
    nostrContinuity: true,
  });
  assert.deepEqual(receipt.effects, {
    memberIdentityChanged: false,
    appAccountChanged: false,
    nostrIdentityChanged: false,
    addressBoundRightsMoved: false,
    thirdwebCredentialRevoked: false,
  });
  assert.deepEqual(
    calls.map(({ credentialKind, address, chainId, message, signature }) => ({
      credentialKind,
      address,
      chainId,
      message,
      signature,
    })),
    [
      {
        credentialKind: "thirdweb_smart_account",
        address: CURRENT_ADDRESS,
        chainId: 100,
        message: proof.existingAdmissionProof.statement,
        signature: proof.existingAdmissionProof.walletSignature,
      },
      {
        credentialKind: "thirdweb_smart_account",
        address: CURRENT_ADDRESS,
        chainId: 100,
        message: proof.statement,
        signature: proof.currentCredentialSignature,
      },
      {
        credentialKind: "passkey_safe",
        address: SAFE_ADDRESS,
        chainId: 100,
        message: proof.statement,
        signature: proof.nextCredentialSignature,
      },
    ]
  );
});

test("rejects replay after the first atomic challenge consumption", async () => {
  let current = NOW;
  const { server } = createServer({ now: () => current });
  const { proof } = await issuedProof({ server });
  current = LATER;

  await server.verifyProof(proof);
  await assert.rejects(
    () => server.verifyProof(proof),
    /credential_link_challenge_unknown_or_used/
  );
});

test("burns the challenge when any wallet control proof fails", async () => {
  let current = NOW;
  const store = createMemoryCredentialLinkChallengeStore();
  const { server } = createServer({
    store,
    now: () => current,
    verifier: async ({ credentialKind }) => credentialKind !== "passkey_safe",
  });
  const { proof } = await issuedProof({ server });
  current = LATER;

  await assert.rejects(
    () => server.verifyProof(proof),
    /credential_link_next_signature_invalid/
  );
  await assert.rejects(
    () => server.verifyProof(proof),
    /credential_link_challenge_unknown_or_used/
  );
});

test("rejects a valid-looking proof that was not issued by this server", async () => {
  const issuer = createServer();
  const { proof } = await issuedProof({ server: issuer.server });
  const other = createServer();

  await assert.rejects(
    () => other.server.verifyProof(proof),
    /credential_link_challenge_unknown_or_used/
  );
  assert.equal(other.calls.length, 0);
});

test("rejects any stored subject drift before wallet verification", async () => {
  let issued:
    | Awaited<
        ReturnType<ReturnType<typeof createServer>["server"]["issueChallenge"]>
      >
    | undefined;
  const calls: Parameters<CredentialControlVerifier>[0][] = [];
  const server = createCredentialLinkServer({
    store: {
      async issue(challenge) {
        issued = challenge;
      },
      async consume() {
        assert.ok(issued);
        return {
          ...issued,
          appAccountId: "018f1c63-7b2a-7a11-8a55-2e3d9c4b5aff",
        };
      },
    },
    verifyCredentialControl: async (call) => {
      calls.push(call);
      return true;
    },
    now: () => NOW,
    generateChallengeId: () => CHALLENGE_ID,
    generateNonce: () => "ab".repeat(32),
  });
  const { proof } = await issuedProof({ server });

  await assert.rejects(
    () => server.verifyProof(proof),
    /credential_link_challenge_binding_mismatch/
  );
  assert.equal(calls.length, 0);
});
