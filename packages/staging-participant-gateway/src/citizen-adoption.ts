import { createHash, randomBytes } from "node:crypto";
import type {
  CitizenTopicSuggestionAdoptionV1,
  MunicipalCivicEligibilityReceiptV1,
  NostrEvent,
  ParticipantTopicSuggestionV1,
} from "@netizen-labs/nostr";
import {
  createMunicipalCivicEligibilityReceiptProofVerifier,
  municipalCivicEligibilityReceiptProofPublicKey,
  signMunicipalCivicEligibilityReceiptProof,
  verifyCitizenTopicSuggestionAdoption,
  verifyEvent,
  verifyParticipantTopicSuggestionForAdoption,
} from "@netizen-labs/nostr";
import type { PinnedCitizenNftEligibilityEvidence } from "@netizen-labs/relay-sync";

import type { WalletSignatureVerifier } from "./types.ts";

const HEX32 = /^[0-9a-f]{32}$/u;
const HEX64 = /^[0-9a-f]{64}$/u;
const WALLET = /^0x[0-9a-f]{40}$/u;

export type CitizenAdoptionPolicy = Readonly<{
  municipalityId: string;
  policyVersion: string;
  issuer: string;
  statusBaseUrl: string;
  challengeTtlSeconds: number;
  receiptTtlSeconds: number;
  maxEventClockSkewSeconds: number;
}>;

export type CitizenEligibilityChallengeV1 = Readonly<{
  schemaVersion: "municipal_civic_eligibility_challenge_v1";
  challengeId: string;
  audience: "roebel-staging-citizen-adoption";
  sessionBindingSha256: string;
  walletAddress: string;
  chainId: 100;
  subjectPubkey: string;
  municipalityId: string;
  policyVersion: string;
  participantSuggestionId: string;
  topicId: string;
  issuedAt: number;
  expiresAt: number;
  authorityBinding: "civic_eligibility_only";
  canonicalChallenge: string;
  message: string;
}>;

export type MunicipalCivicEligibilityPublicPolicyV1 = Readonly<{
  schemaVersion: "municipal_civic_eligibility_public_policy_v1";
  municipalityId: string;
  policyVersion: string;
  issuer: string;
  statusBaseUrl: string;
  verifiedAt: number;
  proof: Readonly<{
    algorithm: "Ed25519";
    keyId: string;
    publicKey: string;
  }>;
}>;

export type CitizenEligibilityIssuanceV1 = Readonly<{
  schemaVersion: "municipal_civic_eligibility_issuance_v1";
  eligibilityReceipt: MunicipalCivicEligibilityReceiptV1;
  eligibilityPolicy: MunicipalCivicEligibilityPublicPolicyV1;
  authorityBinding: "civic_eligibility_only";
}>;

export type CitizenEligibilityChallengeStore = Readonly<{
  issue(
    challenge: CitizenEligibilityChallengeV1,
  ): Promise<CitizenEligibilityChallengeV1>;
  consume(input: Readonly<{
    challengeId: string;
    walletAddress: string;
    sessionBindingSha256: string;
    consumedAt: number;
  }>): Promise<CitizenEligibilityChallengeV1>;
}>;

export type CitizenAdoptionSourceAdapter = Readonly<{
  resolveParticipantSuggestion(input: Readonly<{
    participantSuggestionId: string;
  }>): Promise<ParticipantTopicSuggestionV1 | null>;
}>;

export type CitizenEligibilityReceiptStore = Readonly<{
  store(input: Readonly<{
    challenge: CitizenEligibilityChallengeV1;
    receipt: MunicipalCivicEligibilityReceiptV1;
    privateEligibilityEvidence: PinnedCitizenNftEligibilityEvidence;
  }>): Promise<MunicipalCivicEligibilityReceiptV1>;
  resolve(input: Readonly<{
    receiptId: string;
  }>): Promise<MunicipalCivicEligibilityReceiptV1 | null>;
}>;

export type CitizenAdoptionAcceptanceReceiptV1 = Readonly<{
  schemaVersion: "citizen_topic_suggestion_adoption_acceptance_receipt_v1";
  adoptionId: string;
  adoptionEventId: string;
  municipalityId: string;
  topicId: string;
  participantSuggestionId: string;
  adopterPubkey: string;
  eligibilityReceiptId: string;
  requestChecksum: string;
  eventCreatedAt: number;
  receivedAt: number;
  policyVersion: string;
  status: "accepted";
  authorityBinding: "civic_eligibility_only";
  receiptChecksum: string;
}>;

export type CitizenAdoptionRequestV1 = Readonly<{
  schemaVersion: "citizen_topic_suggestion_adoption_request_v1";
  requestId: string;
  idempotencyKey: string;
  adoptionEvent: NostrEvent;
}>;

export type PublicCitizenAdoptionProjectionV1 = Readonly<{
  schemaVersion: "public_citizen_adoption_projection_v1";
  participantSuggestionId: string;
  adoptionEvent: NostrEvent;
  eligibilityReceipt: MunicipalCivicEligibilityReceiptV1;
  acceptanceReceipt: CitizenAdoptionAcceptanceReceiptV1;
  entryState: "case_steward_review_required";
  authorityBinding: "civic_eligibility_only";
  submittedToCivicWorkflow: false;
  administrativeEndorsement: false;
  bindingVote: false;
  councilDecision: false;
  treasuryEffect: false;
  paymentEffect: false;
}>;

export type CitizenAdoptionLedger = Readonly<{
  resolveReplay(input: Readonly<{
    requestId: string;
    idempotencyKeySha256: string;
    requestChecksum: string;
    adoptionEventId: string;
  }>): Promise<PublicCitizenAdoptionProjectionV1 | null>;
  accept(input: Readonly<{
    requestId: string;
    idempotencyKeySha256: string;
    requestChecksum: string;
    receivedAt: number;
    maxEventClockSkewSeconds: number;
    adoption: CitizenTopicSuggestionAdoptionV1;
    eligibilityReceipt: MunicipalCivicEligibilityReceiptV1;
    acceptanceReceipt: CitizenAdoptionAcceptanceReceiptV1;
  }>): Promise<PublicCitizenAdoptionProjectionV1>;
  readPublic(input: Readonly<{
    participantSuggestionId: string;
    adopterPubkey: string;
  }>): Promise<PublicCitizenAdoptionProjectionV1 | null>;
}>;

export type CitizenAdoptionServiceDependencies = Readonly<{
  policy: CitizenAdoptionPolicy;
  issuer: Readonly<{ keyId: string; privateKey: Uint8Array }>;
  sources: CitizenAdoptionSourceAdapter;
  challenges: CitizenEligibilityChallengeStore;
  walletVerifier: WalletSignatureVerifier;
  eligibilityVerifier: Readonly<{
    verifyActiveCitizen(input: Readonly<{
      address: string;
    }>): Promise<PinnedCitizenNftEligibilityEvidence>;
  }>;
  receipts: CitizenEligibilityReceiptStore;
  ledger: CitizenAdoptionLedger;
  now?: () => Date;
  randomId?: () => string;
}>;

export type CitizenAdoptionService = Readonly<{
  issueEligibilityChallenge(input: Readonly<{
    walletAddress: string;
    sessionBindingSha256: string;
    subjectPubkey: string;
    participantSuggestionId: string;
  }>): Promise<CitizenEligibilityChallengeV1>;
  issueEligibilityReceipt(input: Readonly<{
    walletAddress: string;
    sessionBindingSha256: string;
    challengeId: string;
    walletSignature: string;
    nostrProofEvent: NostrEvent;
  }>): Promise<CitizenEligibilityIssuanceV1>;
  acceptAdoption(
    request: CitizenAdoptionRequestV1,
  ): Promise<PublicCitizenAdoptionProjectionV1>;
  readPublicAdoption(input: Readonly<{
    participantSuggestionId: string;
    adopterPubkey: string;
  }>): Promise<PublicCitizenAdoptionProjectionV1 | null>;
}>;

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: unknown): string {
  return createHash("sha256").update(stableJson(value), "utf8").digest("hex");
}

function sha256Text(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return (
    actual.length === wanted.length &&
    actual.every((key, index) => key === wanted[index])
  );
}

function plainRecord(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> | null {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    return null;
  }
  const record = value as Record<string, unknown>;
  return exactKeys(record, keys) ? record : null;
}

function adoptionReferences(event: NostrEvent): Readonly<{
  participantSuggestionId: string;
  eligibilityReceiptId: string;
}> | null {
  try {
    const parsed: unknown = JSON.parse(event.content);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const value = parsed as Record<string, unknown>;
    return typeof value.participantSuggestionId === "string" &&
      HEX64.test(value.participantSuggestionId) &&
      typeof value.eligibilityReceiptId === "string" &&
      /^urn:stadtstack:municipal-civic-eligibility-receipt:[0-9a-f]{64}$/u.test(
        value.eligibilityReceiptId,
      )
      ? {
          participantSuggestionId: value.participantSuggestionId,
          eligibilityReceiptId: value.eligibilityReceiptId,
        }
      : null;
  } catch {
    return null;
  }
}

function challengeCore(challenge: CitizenEligibilityChallengeV1) {
  return {
    schemaVersion: challenge.schemaVersion,
    challengeId: challenge.challengeId,
    audience: challenge.audience,
    sessionBindingSha256: challenge.sessionBindingSha256,
    walletAddress: challenge.walletAddress,
    chainId: challenge.chainId,
    subjectPubkey: challenge.subjectPubkey,
    municipalityId: challenge.municipalityId,
    policyVersion: challenge.policyVersion,
    participantSuggestionId: challenge.participantSuggestionId,
    topicId: challenge.topicId,
    issuedAt: challenge.issuedAt,
    expiresAt: challenge.expiresAt,
    authorityBinding: challenge.authorityBinding,
  } as const;
}

function expectedProofTags(challenge: CitizenEligibilityChallengeV1) {
  return [
    ["schema", "municipal_civic_eligibility_challenge_proof_v1"],
    ["challenge", challenge.challengeId],
    [
      "e",
      challenge.participantSuggestionId,
      "",
      "eligibility-for-suggestion",
    ],
    ["municipality", challenge.municipalityId],
  ];
}

function policyValid(policy: CitizenAdoptionPolicy): boolean {
  if (
    !/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/u.test(
      policy.municipalityId,
    ) ||
    !/^[a-z0-9][a-z0-9._-]{2,99}$/u.test(policy.policyVersion) ||
    typeof policy.issuer !== "string" ||
    policy.issuer.length < 1 ||
    policy.issuer !== policy.issuer.trim() ||
    !Number.isSafeInteger(policy.challengeTtlSeconds) ||
    policy.challengeTtlSeconds < 60 ||
    policy.challengeTtlSeconds > 300 ||
    !Number.isSafeInteger(policy.receiptTtlSeconds) ||
    policy.receiptTtlSeconds < 60 ||
    policy.receiptTtlSeconds > 3_600 ||
    !Number.isSafeInteger(policy.maxEventClockSkewSeconds) ||
    policy.maxEventClockSkewSeconds < 0 ||
    policy.maxEventClockSkewSeconds > 300
  ) {
    return false;
  }
  try {
    const status = new URL(policy.statusBaseUrl);
    return (
      status.protocol === "https:" &&
      !status.username &&
      !status.password &&
      !status.search &&
      !status.hash &&
      !status.pathname.endsWith("/")
    );
  } catch {
    return false;
  }
}

/**
 * One deep, authority-bounded service for eligibility and citizen adoption.
 * It can issue a public-safe eligibility receipt and record the signed request
 * for Case Steward review; it has no Case, administration, vote, or treasury
 * capability.
 */
export function createCitizenAdoptionService(
  dependencies: CitizenAdoptionServiceDependencies,
): CitizenAdoptionService {
  if (
    !policyValid(dependencies.policy) ||
    !(dependencies.issuer.privateKey instanceof Uint8Array) ||
    dependencies.issuer.privateKey.length !== 32 ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/u.test(dependencies.issuer.keyId)
  ) {
    throw new Error("citizen_adoption_service_config_invalid");
  }
  const now = dependencies.now ?? (() => new Date());
  const nextChallengeId =
    dependencies.randomId ?? (() => randomBytes(16).toString("hex"));
  const issuerPublicKey = municipalCivicEligibilityReceiptProofPublicKey(
    dependencies.issuer.privateKey,
  );
  const receiptProofVerifier =
    createMunicipalCivicEligibilityReceiptProofVerifier({
      publicKey: issuerPublicKey,
      keyId: dependencies.issuer.keyId,
    });

  const verifyStoredProjection = async (input: Readonly<{
    projection: unknown;
    participantSuggestionId: string;
    adoptionEvent?: NostrEvent;
    requestChecksum?: string;
    adopterPubkey?: string;
  }>): Promise<PublicCitizenAdoptionProjectionV1> => {
    const projection = plainRecord(input.projection, [
      "schemaVersion",
      "participantSuggestionId",
      "adoptionEvent",
      "eligibilityReceipt",
      "acceptanceReceipt",
      "entryState",
      "authorityBinding",
      "submittedToCivicWorkflow",
      "administrativeEndorsement",
      "bindingVote",
      "councilDecision",
      "treasuryEffect",
      "paymentEffect",
    ]);
    const acceptance = projection && plainRecord(projection.acceptanceReceipt, [
      "schemaVersion",
      "adoptionId",
      "adoptionEventId",
      "municipalityId",
      "topicId",
      "participantSuggestionId",
      "adopterPubkey",
      "eligibilityReceiptId",
      "requestChecksum",
      "eventCreatedAt",
      "receivedAt",
      "policyVersion",
      "status",
      "authorityBinding",
      "receiptChecksum",
    ]);
    const event = projection?.adoptionEvent as NostrEvent | undefined;
    const receipt = projection?.eligibilityReceipt as
      | MunicipalCivicEligibilityReceiptV1
      | undefined;
    if (
      !projection ||
      !acceptance ||
      projection.schemaVersion !== "public_citizen_adoption_projection_v1" ||
      projection.participantSuggestionId !== input.participantSuggestionId ||
      !event ||
      !verifyEvent(event) ||
      (input.adoptionEvent !== undefined &&
        stableJson(event) !== stableJson(input.adoptionEvent)) ||
      !receipt ||
      projection.entryState !== "case_steward_review_required" ||
      projection.authorityBinding !== "civic_eligibility_only" ||
      projection.submittedToCivicWorkflow !== false ||
      projection.administrativeEndorsement !== false ||
      projection.bindingVote !== false ||
      projection.councilDecision !== false ||
      projection.treasuryEffect !== false ||
      projection.paymentEffect !== false ||
      acceptance.schemaVersion !==
        "citizen_topic_suggestion_adoption_acceptance_receipt_v1" ||
      typeof acceptance.adoptionId !== "string" ||
      typeof acceptance.adoptionEventId !== "string" ||
      typeof acceptance.municipalityId !== "string" ||
      typeof acceptance.topicId !== "string" ||
      acceptance.participantSuggestionId !== input.participantSuggestionId ||
      typeof acceptance.adopterPubkey !== "string" ||
      (input.adopterPubkey !== undefined &&
        acceptance.adopterPubkey !== input.adopterPubkey) ||
      typeof acceptance.eligibilityReceiptId !== "string" ||
      typeof acceptance.requestChecksum !== "string" ||
      !HEX64.test(acceptance.requestChecksum) ||
      (input.requestChecksum !== undefined &&
        acceptance.requestChecksum !== input.requestChecksum) ||
      typeof acceptance.eventCreatedAt !== "number" ||
      !Number.isSafeInteger(acceptance.eventCreatedAt) ||
      typeof acceptance.receivedAt !== "number" ||
      !Number.isSafeInteger(acceptance.receivedAt) ||
      typeof acceptance.policyVersion !== "string" ||
      acceptance.status !== "accepted" ||
      acceptance.authorityBinding !== "civic_eligibility_only" ||
      typeof acceptance.receiptChecksum !== "string" ||
      !HEX64.test(acceptance.receiptChecksum)
    ) {
      throw new Error("citizen_adoption_public_projection_invalid");
    }
    const acceptanceCore = {
      schemaVersion: acceptance.schemaVersion,
      adoptionId: acceptance.adoptionId,
      adoptionEventId: acceptance.adoptionEventId,
      municipalityId: acceptance.municipalityId,
      topicId: acceptance.topicId,
      participantSuggestionId: acceptance.participantSuggestionId,
      adopterPubkey: acceptance.adopterPubkey,
      eligibilityReceiptId: acceptance.eligibilityReceiptId,
      requestChecksum: acceptance.requestChecksum,
      eventCreatedAt: acceptance.eventCreatedAt,
      receivedAt: acceptance.receivedAt,
      policyVersion: acceptance.policyVersion,
      status: acceptance.status,
      authorityBinding: acceptance.authorityBinding,
    };
    if (acceptance.receiptChecksum !== sha256(acceptanceCore)) {
      throw new Error("citizen_adoption_public_projection_invalid");
    }
    const references = adoptionReferences(event);
    if (
      !references ||
      references.participantSuggestionId !== input.participantSuggestionId ||
      references.eligibilityReceiptId !== acceptance.eligibilityReceiptId
    ) {
      throw new Error("citizen_adoption_public_projection_invalid");
    }
    const participantSuggestion =
      await dependencies.sources.resolveParticipantSuggestion({
        participantSuggestionId: input.participantSuggestionId,
      });
    if (!participantSuggestion) {
      throw new Error("citizen_adoption_public_projection_invalid");
    }
    let adoption: CitizenTopicSuggestionAdoptionV1;
    try {
      adoption = verifyCitizenTopicSuggestionAdoption({
        participantSuggestion,
        eligibilityReceipt: receipt,
        eligibilityPolicy: {
          municipalityId: dependencies.policy.municipalityId,
          policyVersion: dependencies.policy.policyVersion,
          issuer: dependencies.policy.issuer,
          statusBaseUrl: dependencies.policy.statusBaseUrl,
          verifiedAt: acceptance.receivedAt as number,
          verifyReceiptProof: receiptProofVerifier,
        },
        event,
      });
    } catch {
      throw new Error("citizen_adoption_public_projection_invalid");
    }
    const recomputedRequestChecksum = sha256({
      schemaVersion: "citizen_topic_suggestion_adoption_request_v1",
      adoptionEvent: event,
    });
    if (
      acceptance.requestChecksum !== recomputedRequestChecksum ||
      acceptance.adoptionId !== adoption.adoptionId ||
      acceptance.adoptionEventId !== adoption.event.id ||
      acceptance.municipalityId !== adoption.adoption.municipalityId ||
      acceptance.topicId !== adoption.adoption.topicId ||
      acceptance.adopterPubkey !== adoption.signerPubkey ||
      acceptance.eligibilityReceiptId !== adoption.eligibilityReceiptId ||
      acceptance.eventCreatedAt !== adoption.event.created_at ||
      acceptance.policyVersion !== dependencies.policy.policyVersion
    ) {
      throw new Error("citizen_adoption_public_projection_invalid");
    }
    return input.projection as PublicCitizenAdoptionProjectionV1;
  };

  return Object.freeze({
    async issueEligibilityChallenge(input: Readonly<{
      walletAddress: string;
      sessionBindingSha256: string;
      subjectPubkey: string;
      participantSuggestionId: string;
    }>): Promise<CitizenEligibilityChallengeV1> {
      if (
        !WALLET.test(input.walletAddress) ||
        !HEX64.test(input.sessionBindingSha256) ||
        !HEX64.test(input.subjectPubkey) ||
        !HEX64.test(input.participantSuggestionId)
      ) {
        throw new Error("citizen_eligibility_challenge_input_invalid");
      }
      const current = now();
      const issuedAt = Math.floor(current.getTime() / 1_000);
      if (!Number.isSafeInteger(issuedAt) || issuedAt < 0) {
        throw new Error("citizen_adoption_service_time_invalid");
      }
      const resolved = await dependencies.sources.resolveParticipantSuggestion(
        { participantSuggestionId: input.participantSuggestionId },
      );
      let suggestion: ParticipantTopicSuggestionV1 | null = null;
      if (resolved) {
        try {
          suggestion = verifyParticipantTopicSuggestionForAdoption(resolved);
        } catch {
          suggestion = null;
        }
      }
      if (
        !suggestion ||
        suggestion.schemaVersion !== "staging_participant_signed_topic_suggestion_v1" ||
        suggestion.suggestionId !== input.participantSuggestionId ||
        suggestion.event.id !== input.participantSuggestionId ||
        suggestion.draft.municipalityId !== dependencies.policy.municipalityId ||
        suggestion.draft.topicId !==
          `urn:stadtstack:topic:municipality:${dependencies.policy.municipalityId}:${suggestion.draft.topicId.split(":").at(-1)}`
      ) {
        throw new Error("citizen_adoption_participant_suggestion_unavailable");
      }
      const challengeId = nextChallengeId();
      if (!challengeId || !HEX32.test(challengeId)) {
        throw new Error("citizen_eligibility_challenge_id_unavailable");
      }
      const core = Object.freeze({
        schemaVersion: "municipal_civic_eligibility_challenge_v1" as const,
        challengeId,
        audience: "roebel-staging-citizen-adoption" as const,
        sessionBindingSha256: input.sessionBindingSha256,
        walletAddress: input.walletAddress,
        chainId: 100 as const,
        subjectPubkey: input.subjectPubkey,
        municipalityId: dependencies.policy.municipalityId,
        policyVersion: dependencies.policy.policyVersion,
        participantSuggestionId: suggestion.suggestionId,
        topicId: suggestion.draft.topicId,
        issuedAt,
        expiresAt: issuedAt + dependencies.policy.challengeTtlSeconds,
        authorityBinding: "civic_eligibility_only" as const,
      });
      const canonicalChallenge = stableJson(core);
      const challenge = Object.freeze({
        ...core,
        canonicalChallenge,
        message: canonicalChallenge,
      });
      return dependencies.challenges.issue(challenge);
    },
    async issueEligibilityReceipt(input: Readonly<{
      walletAddress: string;
      sessionBindingSha256: string;
      challengeId: string;
      walletSignature: string;
      nostrProofEvent: NostrEvent;
    }>): Promise<CitizenEligibilityIssuanceV1> {
      if (
        !WALLET.test(input.walletAddress) ||
        !HEX64.test(input.sessionBindingSha256) ||
        !HEX32.test(input.challengeId) ||
        !/^0x[0-9a-f]+$/u.test(input.walletSignature) ||
        (input.walletSignature.length - 2) % 2 !== 0
      ) {
        throw new Error("citizen_eligibility_proof_input_invalid");
      }
      const current = now();
      const issuedAt = Math.floor(current.getTime() / 1_000);
      if (!Number.isSafeInteger(issuedAt) || issuedAt < 0) {
        throw new Error("citizen_adoption_service_time_invalid");
      }
      const challenge = await dependencies.challenges.consume({
        challengeId: input.challengeId,
        walletAddress: input.walletAddress,
        sessionBindingSha256: input.sessionBindingSha256,
        consumedAt: issuedAt,
      });
      if (
        challenge.challengeId !== input.challengeId ||
        challenge.walletAddress !== input.walletAddress ||
        challenge.sessionBindingSha256 !== input.sessionBindingSha256 ||
        challenge.municipalityId !== dependencies.policy.municipalityId ||
        challenge.policyVersion !== dependencies.policy.policyVersion ||
        challenge.chainId !== 100 ||
        challenge.expiresAt <= issuedAt ||
        challenge.issuedAt > issuedAt ||
        challenge.expiresAt - challenge.issuedAt !==
          dependencies.policy.challengeTtlSeconds ||
        challenge.authorityBinding !== "civic_eligibility_only" ||
        challenge.canonicalChallenge !== stableJson(challengeCore(challenge)) ||
        challenge.message !== challenge.canonicalChallenge
      ) {
        throw new Error("citizen_eligibility_challenge_invalid");
      }
      const proof = input.nostrProofEvent;
      if (
        !verifyEvent(proof) ||
        proof.kind !== 1 ||
        proof.pubkey !== challenge.subjectPubkey ||
        proof.created_at !== challenge.issuedAt ||
        proof.content !== challenge.message ||
        stableJson(proof.tags) !== stableJson(expectedProofTags(challenge))
      ) {
        throw new Error("citizen_eligibility_nostr_proof_invalid");
      }
      let walletSignatureValid: boolean;
      try {
        walletSignatureValid =
          await dependencies.walletVerifier.verifyWalletSignature({
            address: challenge.walletAddress,
            message: challenge.message,
            signature: input.walletSignature,
          });
      } catch {
        throw new Error("citizen_eligibility_wallet_verification_unavailable");
      }
      if (!walletSignatureValid) {
        throw new Error("citizen_eligibility_wallet_signature_invalid");
      }
      let privateEligibilityEvidence: PinnedCitizenNftEligibilityEvidence;
      try {
        privateEligibilityEvidence =
          await dependencies.eligibilityVerifier.verifyActiveCitizen({
            address: challenge.walletAddress,
          });
      } catch {
        throw new Error("citizen_eligibility_verification_unavailable");
      }
      if (!privateEligibilityEvidence.active) {
        throw new Error("citizen_eligibility_active_citizen_nft_required");
      }
      const eligibilityCore = Object.freeze({
        municipalityId: challenge.municipalityId,
        eligibilityClass: "municipal_civic_participation" as const,
        subjectPubkey: challenge.subjectPubkey,
        participantSuggestionId: challenge.participantSuggestionId,
        topicId: challenge.topicId,
        policyVersion: challenge.policyVersion,
        issuer: dependencies.policy.issuer,
        issuedAt,
        expiresAt: issuedAt + dependencies.policy.receiptTtlSeconds,
        authorityBinding: "civic_eligibility_only" as const,
      });
      const payloadChecksum = sha256(eligibilityCore);
      const receiptId =
        `urn:stadtstack:municipal-civic-eligibility-receipt:${payloadChecksum}`;
      const statusRef = `${dependencies.policy.statusBaseUrl}/${payloadChecksum}`;
      const receiptProofInput = Object.freeze({
        domain: "municipal-civic-eligibility-receipt/v1" as const,
        schemaVersion: "municipal_civic_eligibility_receipt_v1" as const,
        receiptId,
        payloadChecksum,
        statusRef,
      });
      const receipt = Object.freeze({
        schemaVersion: "municipal_civic_eligibility_receipt_v1" as const,
        eligibilityCore,
        receiptId,
        payloadChecksum,
        statusRef,
        proof: signMunicipalCivicEligibilityReceiptProof(receiptProofInput, {
          privateKey: dependencies.issuer.privateKey,
          keyId: dependencies.issuer.keyId,
        }),
      });
      const stored = await dependencies.receipts.store({
        challenge,
        receipt,
        privateEligibilityEvidence,
      });
      if (stableJson(stored) !== stableJson(receipt)) {
        throw new Error("citizen_eligibility_receipt_store_mismatch");
      }
      const eligibilityPolicy = Object.freeze({
        schemaVersion: "municipal_civic_eligibility_public_policy_v1" as const,
        municipalityId: dependencies.policy.municipalityId,
        policyVersion: dependencies.policy.policyVersion,
        issuer: dependencies.policy.issuer,
        statusBaseUrl: dependencies.policy.statusBaseUrl,
        verifiedAt: issuedAt,
        proof: Object.freeze({
          algorithm: "Ed25519" as const,
          keyId: dependencies.issuer.keyId,
          publicKey: issuerPublicKey,
        }),
      });
      return Object.freeze({
        schemaVersion: "municipal_civic_eligibility_issuance_v1" as const,
        eligibilityReceipt: receipt,
        eligibilityPolicy,
        authorityBinding: "civic_eligibility_only" as const,
      });
    },
    async acceptAdoption(
      request: CitizenAdoptionRequestV1,
    ): Promise<PublicCitizenAdoptionProjectionV1> {
      if (
        !request ||
        typeof request !== "object" ||
        Array.isArray(request) ||
        Object.getPrototypeOf(request) !== Object.prototype ||
        !exactKeys(request as unknown as Record<string, unknown>, [
          "schemaVersion",
          "requestId",
          "idempotencyKey",
          "adoptionEvent",
        ]) ||
        request.schemaVersion !==
          "citizen_topic_suggestion_adoption_request_v1" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
          request.requestId,
        ) ||
        !/^[A-Za-z0-9._~-]{16,128}$/u.test(request.idempotencyKey) ||
        !verifyEvent(request.adoptionEvent)
      ) {
        throw new Error("citizen_adoption_request_invalid");
      }
      const references = adoptionReferences(request.adoptionEvent);
      if (!references) throw new Error("citizen_adoption_request_invalid");
      const requestChecksum = sha256({
        schemaVersion: request.schemaVersion,
        adoptionEvent: request.adoptionEvent,
      });
      const idempotencyKeySha256 = sha256Text(request.idempotencyKey);
      const replay = await dependencies.ledger.resolveReplay({
        requestId: request.requestId,
        idempotencyKeySha256,
        requestChecksum,
        adoptionEventId: request.adoptionEvent.id,
      });
      if (replay) {
        try {
          return await verifyStoredProjection({
            projection: replay,
            participantSuggestionId: references.participantSuggestionId,
            adoptionEvent: request.adoptionEvent,
            requestChecksum,
          });
        } catch {
          throw new Error("citizen_adoption_replay_mismatch");
        }
      }
      const current = now();
      const receivedAt = Math.floor(current.getTime() / 1_000);
      if (!Number.isSafeInteger(receivedAt) || receivedAt < 0) {
        throw new Error("citizen_adoption_service_time_invalid");
      }
      const [participantSuggestion, eligibilityReceipt] = await Promise.all([
        dependencies.sources.resolveParticipantSuggestion({
          participantSuggestionId: references.participantSuggestionId,
        }),
        dependencies.receipts.resolve({
          receiptId: references.eligibilityReceiptId,
        }),
      ]);
      if (!participantSuggestion || !eligibilityReceipt) {
        throw new Error("citizen_adoption_evidence_unavailable");
      }
      const eligibilityPolicy = {
        municipalityId: dependencies.policy.municipalityId,
        policyVersion: dependencies.policy.policyVersion,
        issuer: dependencies.policy.issuer,
        statusBaseUrl: dependencies.policy.statusBaseUrl,
        verifiedAt: receivedAt,
        verifyReceiptProof: receiptProofVerifier,
      };
      let adoption: CitizenTopicSuggestionAdoptionV1;
      try {
        adoption = verifyCitizenTopicSuggestionAdoption({
          participantSuggestion,
          eligibilityReceipt,
          eligibilityPolicy,
          event: request.adoptionEvent,
        });
      } catch {
        throw new Error("citizen_adoption_evidence_invalid");
      }
      const acceptanceCore = Object.freeze({
        schemaVersion:
          "citizen_topic_suggestion_adoption_acceptance_receipt_v1" as const,
        adoptionId: adoption.adoptionId,
        adoptionEventId: adoption.event.id,
        municipalityId: adoption.adoption.municipalityId,
        topicId: adoption.adoption.topicId,
        participantSuggestionId: adoption.participantSuggestionId,
        adopterPubkey: adoption.signerPubkey,
        eligibilityReceiptId: adoption.eligibilityReceiptId,
        requestChecksum,
        eventCreatedAt: adoption.event.created_at,
        receivedAt,
        policyVersion: dependencies.policy.policyVersion,
        status: "accepted" as const,
        authorityBinding: "civic_eligibility_only" as const,
      });
      const acceptanceReceipt = Object.freeze({
        ...acceptanceCore,
        receiptChecksum: sha256(acceptanceCore),
      });
      const accepted = await dependencies.ledger.accept({
        requestId: request.requestId,
        idempotencyKeySha256,
        requestChecksum,
        receivedAt,
        maxEventClockSkewSeconds:
          dependencies.policy.maxEventClockSkewSeconds,
        adoption,
        eligibilityReceipt,
        acceptanceReceipt,
      });
      try {
        return await verifyStoredProjection({
          projection: accepted,
          participantSuggestionId: references.participantSuggestionId,
          adoptionEvent: request.adoptionEvent,
          requestChecksum,
        });
      } catch {
        throw new Error("citizen_adoption_acceptance_mismatch");
      }
    },
    async readPublicAdoption(input: Readonly<{
      participantSuggestionId: string;
      adopterPubkey: string;
    }>): Promise<PublicCitizenAdoptionProjectionV1 | null> {
      if (
        !HEX64.test(input.participantSuggestionId) ||
        !HEX64.test(input.adopterPubkey)
      ) {
        throw new Error("citizen_adoption_public_read_invalid");
      }
      const projection = await dependencies.ledger.readPublic(input);
      if (!projection) return null;
      return verifyStoredProjection({
        projection,
        participantSuggestionId: input.participantSuggestionId,
        adopterPubkey: input.adopterPubkey,
      });
    },
  });
}
