import type { CitizenCredentialKind } from "../citizen-session/session";
import {
  parseCredentialLinkChallenge,
  validateCredentialLinkProofEnvelope,
  type CredentialLinkChallengeV1,
  type CredentialLinkProofV1,
} from "../citizen-session/credential-link";

const MAX_CHALLENGE_LIFETIME_MS = 10 * 60 * 1_000;
const DEFAULT_CHALLENGE_LIFETIME_MS = 5 * 60 * 1_000;

export type CredentialLinkSubject = Readonly<{
  memberId: string;
  appAccountId: string;
  currentCredential: Readonly<{
    kind: "thirdweb_smart_account";
    address: string;
    chainId: 100;
  }>;
  nostrPubkey: string;
}>;

export interface CredentialLinkChallengeStore {
  /**
   * Persist one exact challenge. A production adapter must reject a duplicate
   * challenge ID and keep the nonce private from every other member.
   */
  issue(challenge: CredentialLinkChallengeV1): Promise<void>;

  /**
   * Atomically return and delete the challenge only when both ID and nonce
   * match. A second caller must receive null.
   */
  consume(input: {
    challengeId: string;
    nonce: string;
  }): Promise<CredentialLinkChallengeV1 | null>;
}

export type CredentialControlVerifier = (input: {
  credentialKind: CitizenCredentialKind;
  address: `0x${string}`;
  chainId: 100;
  message: string;
  signature: `0x${string}`;
}) => Promise<boolean>;

export type CredentialLinkVerificationReceiptV1 = Readonly<{
  schemaVersion: "roebel_credential_link_verification_receipt_v1";
  candidateSha256: `sha256:${string}`;
  challengeId: string;
  memberId: string;
  appAccountId: string;
  currentCredential: CredentialLinkProofV1["candidate"]["currentCredential"];
  nextCredential: CredentialLinkProofV1["candidate"]["nextCredential"];
  nostrPubkey: string;
  verifiedAt: string;
  state: "verified_no_effect";
  verification: Readonly<{
    challengeConsumed: true;
    currentAdmissionSignature: true;
    currentLinkSignature: true;
    nextLinkSignature: true;
    nostrContinuity: true;
  }>;
  persistence: "not_written";
  authorityBinding: "none";
  effects: Readonly<{
    memberIdentityChanged: false;
    appAccountChanged: false;
    nostrIdentityChanged: false;
    addressBoundRightsMoved: false;
    thirdwebCredentialRevoked: false;
  }>;
}>;

/**
 * Process-local test adapter. It is deliberately not suitable for a
 * multi-replica deployment or a production challenge route.
 */
export function createMemoryCredentialLinkChallengeStore(): CredentialLinkChallengeStore {
  const challenges = new Map<string, CredentialLinkChallengeV1>();

  return Object.freeze({
    async issue(challenge) {
      if (challenges.has(challenge.challengeId)) {
        throw new Error("credential_link_challenge_duplicate");
      }
      challenges.set(challenge.challengeId, challenge);
    },
    async consume(input) {
      const challenge = challenges.get(input.challengeId);
      if (!challenge || challenge.nonce !== input.nonce) return null;
      challenges.delete(input.challengeId);
      return challenge;
    },
  });
}

function defaultChallengeId(): string {
  return globalThis.crypto.randomUUID();
}

function defaultNonce(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    ""
  );
}

function challengeFromCandidate(
  proof: CredentialLinkProofV1
): CredentialLinkChallengeV1 {
  return Object.freeze({
    schemaVersion: "roebel_credential_link_challenge_v1",
    audience: proof.candidate.audience,
    municipalityId: proof.candidate.municipalityId,
    challengeId: proof.candidate.challengeId,
    memberId: proof.candidate.memberId,
    appAccountId: proof.candidate.appAccountId,
    currentCredential: proof.candidate.currentCredential,
    nostrPubkey: proof.candidate.nostrPubkey,
    nonce: proof.candidate.nonce,
    issuedAt: proof.candidate.issuedAt,
    expiresAt: proof.candidate.expiresAt,
  });
}

function assertExactChallengeBinding(
  stored: CredentialLinkChallengeV1,
  proof: CredentialLinkProofV1
): void {
  const candidateChallenge = challengeFromCandidate(proof);
  if (
    stored.schemaVersion !== candidateChallenge.schemaVersion ||
    stored.audience !== candidateChallenge.audience ||
    stored.municipalityId !== candidateChallenge.municipalityId ||
    stored.challengeId !== candidateChallenge.challengeId ||
    stored.memberId !== candidateChallenge.memberId ||
    stored.appAccountId !== candidateChallenge.appAccountId ||
    stored.currentCredential.kind !==
      candidateChallenge.currentCredential.kind ||
    stored.currentCredential.address !==
      candidateChallenge.currentCredential.address ||
    stored.currentCredential.chainId !==
      candidateChallenge.currentCredential.chainId ||
    stored.nostrPubkey !== candidateChallenge.nostrPubkey ||
    stored.nonce !== candidateChallenge.nonce ||
    stored.issuedAt !== candidateChallenge.issuedAt ||
    stored.expiresAt !== candidateChallenge.expiresAt
  ) {
    throw new Error("credential_link_challenge_binding_mismatch");
  }
}

async function requireCredentialControl(
  verifier: CredentialControlVerifier,
  input: Parameters<CredentialControlVerifier>[0],
  failure: string
): Promise<true> {
  let valid = false;
  try {
    valid = await verifier(input);
  } catch {
    throw new Error(failure);
  }
  if (!valid) throw new Error(failure);
  return true;
}

/**
 * Server-owned credential-link verifier.
 *
 * The caller supplies a trusted authenticated subject when issuing a challenge.
 * Verification consumes that exact challenge before any remote signature
 * checks, so failed checks burn the nonce. The returned receipt deliberately
 * has no persistence or civic effect; a separate reviewed database transaction
 * is required to create a stable member/credential mapping.
 */
export function createCredentialLinkServer(input: {
  store: CredentialLinkChallengeStore;
  verifyCredentialControl: CredentialControlVerifier;
  now?: () => Date;
  challengeLifetimeMs?: number;
  generateChallengeId?: () => string;
  generateNonce?: () => string;
}) {
  const now = input.now ?? (() => new Date());
  const challengeLifetimeMs =
    input.challengeLifetimeMs ?? DEFAULT_CHALLENGE_LIFETIME_MS;
  if (
    !Number.isSafeInteger(challengeLifetimeMs) ||
    challengeLifetimeMs < 1 ||
    challengeLifetimeMs > MAX_CHALLENGE_LIFETIME_MS
  ) {
    throw new Error("credential_link_challenge_lifetime_invalid");
  }
  const generateChallengeId = input.generateChallengeId ?? defaultChallengeId;
  const generateNonce = input.generateNonce ?? defaultNonce;

  return Object.freeze({
    async issueChallenge(
      subject: CredentialLinkSubject
    ): Promise<CredentialLinkChallengeV1> {
      const issued = now();
      const issuedAt = issued.toISOString();
      const expiresAt = new Date(
        issued.getTime() + challengeLifetimeMs
      ).toISOString();
      const challenge = parseCredentialLinkChallenge(
        {
          schemaVersion: "roebel_credential_link_challenge_v1",
          audience: "roebel-app:credential-link",
          municipalityId: "roebel-mueritz",
          challengeId: generateChallengeId(),
          memberId: subject.memberId,
          appAccountId: subject.appAccountId,
          currentCredential: subject.currentCredential,
          nostrPubkey: subject.nostrPubkey,
          nonce: generateNonce(),
          issuedAt,
          expiresAt,
        },
        issued
      );
      await input.store.issue(challenge);
      return challenge;
    },

    async verifyProof(
      value: unknown
    ): Promise<CredentialLinkVerificationReceiptV1> {
      const verifiedAt = now();
      const proof = await validateCredentialLinkProofEnvelope(
        value,
        verifiedAt
      );
      const stored = await input.store.consume({
        challengeId: proof.candidate.challengeId,
        nonce: proof.candidate.nonce,
      });
      if (!stored) throw new Error("credential_link_challenge_unknown_or_used");
      const parsedStored = parseCredentialLinkChallenge(stored, verifiedAt);
      assertExactChallengeBinding(parsedStored, proof);

      await requireCredentialControl(
        input.verifyCredentialControl,
        {
          credentialKind: proof.candidate.currentCredential.kind,
          address: proof.candidate.currentCredential.address as `0x${string}`,
          chainId: proof.candidate.currentCredential.chainId,
          message: proof.existingAdmissionProof.statement,
          signature: proof.existingAdmissionProof
            .walletSignature as `0x${string}`,
        },
        "credential_link_current_admission_signature_invalid"
      );
      await requireCredentialControl(
        input.verifyCredentialControl,
        {
          credentialKind: proof.candidate.currentCredential.kind,
          address: proof.candidate.currentCredential.address as `0x${string}`,
          chainId: proof.candidate.currentCredential.chainId,
          message: proof.statement,
          signature: proof.currentCredentialSignature as `0x${string}`,
        },
        "credential_link_current_signature_invalid"
      );
      await requireCredentialControl(
        input.verifyCredentialControl,
        {
          credentialKind: proof.candidate.nextCredential.kind,
          address: proof.candidate.nextCredential.address as `0x${string}`,
          chainId: proof.candidate.nextCredential.chainId,
          message: proof.statement,
          signature: proof.nextCredentialSignature as `0x${string}`,
        },
        "credential_link_next_signature_invalid"
      );

      return Object.freeze({
        schemaVersion: "roebel_credential_link_verification_receipt_v1",
        candidateSha256: proof.candidateSha256,
        challengeId: proof.candidate.challengeId,
        memberId: proof.candidate.memberId,
        appAccountId: proof.candidate.appAccountId,
        currentCredential: proof.candidate.currentCredential,
        nextCredential: proof.candidate.nextCredential,
        nostrPubkey: proof.candidate.nostrPubkey,
        verifiedAt: verifiedAt.toISOString(),
        state: "verified_no_effect",
        verification: Object.freeze({
          challengeConsumed: true,
          currentAdmissionSignature: true,
          currentLinkSignature: true,
          nextLinkSignature: true,
          nostrContinuity: true,
        }),
        persistence: "not_written",
        authorityBinding: "none",
        effects: Object.freeze({
          memberIdentityChanged: false,
          appAccountChanged: false,
          nostrIdentityChanged: false,
          addressBoundRightsMoved: false,
          thirdwebCredentialRevoked: false,
        }),
      });
    },
  });
}
