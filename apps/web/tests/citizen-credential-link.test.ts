import assert from "node:assert/strict";
import { test } from "node:test";

import { deriveNostrIdentity } from "@netizen-labs/nostr";

import {
  createCredentialLinkProof,
  parseCredentialLinkChallenge,
  validateCredentialLinkProofEnvelope,
} from "../src/lib/citizen-session/credential-link";
import { createPasskeySafeCitizenSession } from "../src/lib/citizen-session/passkey-safe-adapter";
import { createThirdwebCitizenSession } from "../src/lib/citizen-session/thirdweb-adapter";

const MEMBER_ID = "018f1c63-7b2a-7a11-8a55-2e3d9c4b5a61";
const ACCOUNT_ID = "018f1c63-7b2a-7a11-8a55-2e3d9c4b5a62";
const CHALLENGE_ID = "018f1c63-7b2a-7a11-8a55-2e3d9c4b5a63";
const CURRENT_ADDRESS = "0x1111111111111111111111111111111111111111";
const SAFE_ADDRESS = "0x2222222222222222222222222222222222222222";
const CURRENT_SIGNATURE = `0x${"42".repeat(65)}`;
const SAFE_SIGNATURE = `0x${"43".repeat(65)}`;
const NOW = new Date("2026-08-22T08:00:30.000Z");

function challenge(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: "roebel_credential_link_challenge_v1",
    audience: "roebel-app:credential-link",
    municipalityId: "roebel-mueritz",
    challengeId: CHALLENGE_ID,
    memberId: MEMBER_ID,
    appAccountId: ACCOUNT_ID,
    currentCredential: {
      kind: "thirdweb_smart_account",
      address: CURRENT_ADDRESS,
      chainId: 100,
    },
    nostrPubkey: deriveNostrIdentity(CURRENT_SIGNATURE).publicKey,
    nonce: "ab".repeat(32),
    issuedAt: "2026-08-22T08:00:00.000Z",
    expiresAt: "2026-08-22T08:05:00.000Z",
    ...overrides,
  };
}

function sessions() {
  const currentMessages: string[] = [];
  const safeMessages: string[] = [];
  const current = createThirdwebCitizenSession({
    account: {
      address: CURRENT_ADDRESS,
      signMessage: async ({ message }) => {
        currentMessages.push(message);
        return CURRENT_SIGNATURE;
      },
    },
    memberId: MEMBER_ID,
    appAccountId: ACCOUNT_ID,
  });
  const next = createPasskeySafeCitizenSession({
    account: {
      address: SAFE_ADDRESS,
      signMessage: async ({ message }) => {
        safeMessages.push(message);
        return SAFE_SIGNATURE;
      },
    },
    memberId: MEMBER_ID,
    appAccountId: ACCOUNT_ID,
  });
  return { current, next, currentMessages, safeMessages };
}

test("adapts a passkey-owned Safe through the same CitizenSession seam", async () => {
  const { next, safeMessages } = sessions();

  assert.equal(next.snapshot.credential.kind, "passkey_safe");
  assert.equal(next.snapshot.credential.address, SAFE_ADDRESS);
  assert.equal(next.snapshot.credential.chainId, 100);
  assert.equal(next.snapshot.memberId, MEMBER_ID);
  assert.equal(next.snapshot.appAccountId, ACCOUNT_ID);
  assert.deepEqual(next.snapshot.assurance, {
    authentication: "provider_authenticated",
    authorization: "legacy_wallet_projection",
    recovery: "passkey_recovery_required",
  });
  assert.equal(await next.signMessage("Kontrollbeweis"), SAFE_SIGNATURE);
  assert.deepEqual(safeMessages, ["Kontrollbeweis"]);
});

test("creates a dual-control proof without changing the app account or Nostr identity", async () => {
  const { current, next, currentMessages, safeMessages } = sessions();
  const parsed = parseCredentialLinkChallenge(challenge(), NOW);

  const proof = await createCredentialLinkProof({
    challenge: parsed,
    currentSession: current,
    nextSession: next,
    now: NOW,
  });
  const validated = await validateCredentialLinkProofEnvelope(proof, NOW);

  assert.equal(validated.candidate.memberId, MEMBER_ID);
  assert.equal(validated.candidate.appAccountId, ACCOUNT_ID);
  assert.equal(validated.candidate.nostrPubkey, parsed.nostrPubkey);
  assert.deepEqual(
    validated.candidate.currentCredential,
    parsed.currentCredential
  );
  assert.deepEqual(validated.candidate.nextCredential, {
    kind: "passkey_safe",
    address: SAFE_ADDRESS,
    chainId: 100,
  });
  assert.equal(
    validated.existingAdmissionProof.bindingEvent.pubkey,
    parsed.nostrPubkey
  );
  assert.equal(validated.currentCredentialSignature, CURRENT_SIGNATURE);
  assert.equal(validated.nextCredentialSignature, SAFE_SIGNATURE);
  assert.deepEqual(validated.effects, {
    memberIdentityChanged: false,
    appAccountChanged: false,
    nostrIdentityChanged: false,
    addressBoundRightsMoved: false,
    thirdwebCredentialRevoked: false,
  });
  assert.equal(validated.state, "awaiting_server_verification");
  assert.equal(Object.isFrozen(validated.existingAdmissionProof), true);
  assert.equal(
    Object.isFrozen(validated.existingAdmissionProof.bindingEvent),
    true
  );
  assert.equal(
    Object.isFrozen(validated.existingAdmissionProof.bindingEvent.tags[0]),
    true
  );
  assert.equal(currentMessages.length, 3);
  assert.equal(safeMessages.length, 1);
  assert.equal(currentMessages.at(-1), safeMessages[0]);
});

test("rejects replayable, expired, widened, or mismatched link challenges", async () => {
  assert.throws(
    () => parseCredentialLinkChallenge(challenge({ nonce: "short" }), NOW),
    /credential_link_challenge_nonce_invalid/
  );
  assert.throws(
    () =>
      parseCredentialLinkChallenge(
        challenge({ expiresAt: "2026-08-22T08:00:10.000Z" }),
        NOW
      ),
    /credential_link_challenge_expired/
  );
  assert.throws(
    () =>
      parseCredentialLinkChallenge(
        challenge({ authorityBinding: "governance" }),
        NOW
      ),
    /credential_link_challenge_fields_invalid/
  );

  const { current, next } = sessions();
  const wrongMember = createPasskeySafeCitizenSession({
    account: {
      address: SAFE_ADDRESS,
      signMessage: async () => SAFE_SIGNATURE,
    },
    memberId: "018f1c63-7b2a-7a11-8a55-2e3d9c4b5a64",
    appAccountId: ACCOUNT_ID,
  });
  await assert.rejects(
    () =>
      createCredentialLinkProof({
        challenge: parseCredentialLinkChallenge(challenge(), NOW),
        currentSession: current,
        nextSession: wrongMember,
        now: NOW,
      }),
    /credential_link_next_member_mismatch/
  );
  current.dispose();
  next.dispose();
  wrongMember.dispose();
});

test("detects any candidate mutation before server-side signature verification", async () => {
  const { current, next } = sessions();
  const proof = await createCredentialLinkProof({
    challenge: parseCredentialLinkChallenge(challenge(), NOW),
    currentSession: current,
    nextSession: next,
    now: NOW,
  });
  const tampered = {
    ...proof,
    candidate: {
      ...proof.candidate,
      appAccountId: "018f1c63-7b2a-7a11-8a55-2e3d9c4b5aff",
    },
  };

  await assert.rejects(
    () => validateCredentialLinkProofEnvelope(tampered, NOW),
    /credential_link_proof_candidate_digest_mismatch/
  );

  await assert.rejects(
    () =>
      validateCredentialLinkProofEnvelope(
        {
          ...proof,
          effects: {
            ...proof.effects,
            thirdwebCredentialRevoked: true,
          },
        },
        NOW
      ),
    /credential_link_proof_effects_invalid/
  );

  await assert.rejects(
    () =>
      validateCredentialLinkProofEnvelope(
        {
          ...proof,
          existingAdmissionProof: {
            ...proof.existingAdmissionProof,
            serverVerified: true,
          },
        },
        NOW
      ),
    /credential_link_proof_admission_invalid/
  );
});
