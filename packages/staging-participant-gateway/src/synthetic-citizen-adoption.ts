import { createHash, randomBytes } from "node:crypto";
import {
  verifyEvent,
  verifyParticipantTopicSuggestionForAdoption,
  type NostrEvent,
  type ParticipantTopicSuggestionV1,
} from "@netizen-labs/nostr";
import type { PinnedCitizenNftEligibilityEvidence } from "@netizen-labs/relay-sync";

import type { WalletSignatureVerifier } from "./types.ts";

const HEX32 = /^[0-9a-f]{32}$/u;
const HEX64 = /^[0-9a-f]{64}$/u;
const WALLET = /^0x[0-9a-f]{40}$/u;
const CONTRACT = /^0x[0-9a-f]{40}$/u;
const CODE_HASH = /^0x[0-9a-f]{64}$/u;

export type SyntheticCitizenAdoptionPolicy = Readonly<{
  municipalityId: string;
  policyVersion: string;
  testCitizenNftAddress: string;
  testCitizenNftRuntimeCodeKeccak256: string;
  challengeTtlSeconds: number;
  maxEventClockSkewSeconds: number;
}>;

/**
 * A wallet- and session-bound challenge whose public message deliberately
 * omits both values. It proves control of one staging test NFT and one Nostr
 * key, but it can never be presented as a municipal eligibility receipt.
 */
export type StagingTestCitizenPassV1 = Readonly<{
  schemaVersion: "staging_test_citizen_pass_v1";
  challengeId: string;
  audience: "roebel-staging-synthetic-citizen-adoption";
  chainId: 100;
  testCitizenNftContract: string;
  subjectPubkey: string;
  municipalityId: string;
  policyVersion: string;
  participantSuggestionId: string;
  topicId: string;
  issuedAt: number;
  expiresAt: number;
  environment: "staging";
  testOnly: true;
  authorityBinding: "none";
  canonicalChallenge: string;
  message: string;
}>;

export type SyntheticCitizenAdoptionChallengeStore = Readonly<{
  issue(input: Readonly<{
    challenge: StagingTestCitizenPassV1;
    walletAddress: string;
    sessionBindingSha256: string;
  }>): Promise<StagingTestCitizenPassV1>;
  consume(input: Readonly<{
    challengeId: string;
    walletAddress: string;
    sessionBindingSha256: string;
    consumedAt: number;
  }>): Promise<StagingTestCitizenPassV1>;
}>;

export type SyntheticCitizenAdoptionSource = Readonly<{
  resolveParticipantSuggestion(input: Readonly<{
    participantSuggestionId: string;
  }>): Promise<ParticipantTopicSuggestionV1 | null>;
}>;

export type SyntheticCitizenAdoptionTracerRequestV1 = Readonly<{
  schemaVersion: "synthetic_citizen_adoption_tracer_request_v1";
  requestId: string;
  idempotencyKey: string;
  challengeId: string;
  walletSignature: string;
  nostrProofEvent: NostrEvent;
}>;

export type PublicSyntheticCitizenAdoptionProjectionV1 = Readonly<{
  schemaVersion: "public_synthetic_citizen_adoption_projection_v1";
  participantSuggestionId: string;
  proofEvent: NostrEvent;
  tracer: SyntheticCitizenAdoptionTracerV1;
  acceptanceReceipt: SyntheticCitizenAdoptionTracerAcceptanceV1;
  labels: Readonly<{
    citizenship: "Test-Bürger-Pass – keine reale Bürgerberechtigung";
    civicWorkflow: "Nur synthetische Vorschau – kein CivicCase und keine Verwaltungsbefürwortung";
    governance: "Keine bindende Abstimmung, kein Beschluss, keine Treasury-Wirkung und keine Zahlung";
  }>;
  entryState: "synthetic_journey_preview_only";
  environment: "staging";
  testOnly: true;
  authorityBinding: "none";
  submittedToCivicWorkflow: false;
  civicCaseCreated: false;
  administrativeEndorsement: false;
  bindingVote: false;
  councilDecision: false;
  treasuryEffect: false;
  paymentEffect: false;
}>;

export type SyntheticCitizenAdoptionTracerV1 = Readonly<{
  schemaVersion: "synthetic_citizen_adoption_tracer_v1";
  tracerId: string;
  municipalityId: string;
  topicId: string;
  participantSuggestionId: string;
  participantSuggestionRef: string;
  participantPubkey: string;
  sourceDiscussionId: string;
  sourceAnswerReceiptId: string;
  adopterPubkey: string;
  proofEventId: string;
  title: string;
  summary: string;
  entryState: "synthetic_journey_preview_only";
  environment: "staging";
  testOnly: true;
  authorityBinding: "none";
  submittedToCivicWorkflow: false;
}>;

export type SyntheticCitizenAdoptionTracerAcceptanceV1 = Readonly<{
  schemaVersion: "synthetic_citizen_adoption_tracer_acceptance_v1";
  tracerId: string;
  proofEventId: string;
  municipalityId: string;
  topicId: string;
  participantSuggestionId: string;
  adopterPubkey: string;
  requestChecksum: string;
  eventCreatedAt: number;
  receivedAt: number;
  policyVersion: string;
  status: "accepted_for_synthetic_preview";
  environment: "staging";
  testOnly: true;
  authorityBinding: "none";
  receiptChecksum: string;
}>;

export type SyntheticCitizenAdoptionLedger = Readonly<{
  resolveReplay(input: Readonly<{
    requestId: string;
    idempotencyKeySha256: string;
    requestChecksum: string;
    proofEventId: string;
  }>): Promise<PublicSyntheticCitizenAdoptionProjectionV1 | null>;
  accept(input: Readonly<{
    requestId: string;
    idempotencyKeySha256: string;
    requestChecksum: string;
    receivedAt: number;
    maxEventClockSkewSeconds: number;
    proofEvent: NostrEvent;
    privateEligibilityEvidence: PinnedCitizenNftEligibilityEvidence;
    projection: PublicSyntheticCitizenAdoptionProjectionV1;
  }>): Promise<PublicSyntheticCitizenAdoptionProjectionV1>;
  readPublic(input: Readonly<{
    participantSuggestionId: string;
    adopterPubkey: string;
  }>): Promise<PublicSyntheticCitizenAdoptionProjectionV1 | null>;
}>;

export type SyntheticCitizenAdoptionServiceDependencies = Readonly<{
  policy: SyntheticCitizenAdoptionPolicy;
  sources: SyntheticCitizenAdoptionSource;
  challenges: SyntheticCitizenAdoptionChallengeStore;
  walletVerifier: WalletSignatureVerifier;
  eligibilityVerifier: Readonly<{
    verifyActiveCitizen(input: Readonly<{
      address: string;
    }>): Promise<PinnedCitizenNftEligibilityEvidence>;
  }>;
  ledger: SyntheticCitizenAdoptionLedger;
  now?: () => Date;
  randomId?: () => string;
}>;

export type SyntheticCitizenAdoptionService = Readonly<{
  preflight(): Promise<Readonly<{
    schemaVersion: "staging_synthetic_citizen_adoption_verifier_preflight_v1";
    chainId: 100;
    testCitizenNftContract: string;
    testCitizenNftRuntimeCodeKeccak256: string;
    finalizedBlockNumber: bigint;
    finalizedBlockHash: string;
    environment: "staging";
    testOnly: true;
    authorityBinding: "none";
  }>>;
  issueChallenge(input: Readonly<{
    walletAddress: string;
    sessionBindingSha256: string;
    subjectPubkey: string;
    participantSuggestionId: string;
  }>): Promise<StagingTestCitizenPassV1>;
  acceptTracer(
    input: Readonly<{
      walletAddress: string;
      sessionBindingSha256: string;
      request: SyntheticCitizenAdoptionTracerRequestV1;
    }>,
  ): Promise<PublicSyntheticCitizenAdoptionProjectionV1>;
  readPublicTracer(input: Readonly<{
    participantSuggestionId: string;
    adopterPubkey: string;
  }>): Promise<PublicSyntheticCitizenAdoptionProjectionV1 | null>;
}>;

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(
      (key) => `${JSON.stringify(key)}:${stableJson(record[key])}`,
    ).join(",")}}`;
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
  return actual.length === wanted.length &&
    actual.every((key, index) => key === wanted[index]);
}

function record(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) return null;
  const parsed = value as Record<string, unknown>;
  return exactKeys(parsed, keys) ? parsed : null;
}

function policyValid(policy: SyntheticCitizenAdoptionPolicy): boolean {
  return (
    /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/u.test(policy.municipalityId) &&
    /^[a-z0-9][a-z0-9._-]{2,99}$/u.test(policy.policyVersion) &&
    CONTRACT.test(policy.testCitizenNftAddress) &&
    CODE_HASH.test(policy.testCitizenNftRuntimeCodeKeccak256) &&
    Number.isSafeInteger(policy.challengeTtlSeconds) &&
    policy.challengeTtlSeconds >= 60 &&
    policy.challengeTtlSeconds <= 300 &&
    Number.isSafeInteger(policy.maxEventClockSkewSeconds) &&
    policy.maxEventClockSkewSeconds >= 0 &&
    policy.maxEventClockSkewSeconds <= 300
  );
}

function challengeCore(challenge: StagingTestCitizenPassV1) {
  return {
    schemaVersion: challenge.schemaVersion,
    challengeId: challenge.challengeId,
    audience: challenge.audience,
    chainId: challenge.chainId,
    testCitizenNftContract: challenge.testCitizenNftContract,
    subjectPubkey: challenge.subjectPubkey,
    municipalityId: challenge.municipalityId,
    policyVersion: challenge.policyVersion,
    participantSuggestionId: challenge.participantSuggestionId,
    topicId: challenge.topicId,
    issuedAt: challenge.issuedAt,
    expiresAt: challenge.expiresAt,
    environment: challenge.environment,
    testOnly: challenge.testOnly,
    authorityBinding: challenge.authorityBinding,
  } as const;
}

function parseChallengeMessage(value: string): ReturnType<typeof challengeCore> | null {
  try {
    const parsed: unknown = JSON.parse(value);
    const challenge = record(parsed, [
      "schemaVersion",
      "challengeId",
      "audience",
      "chainId",
      "testCitizenNftContract",
      "subjectPubkey",
      "municipalityId",
      "policyVersion",
      "participantSuggestionId",
      "topicId",
      "issuedAt",
      "expiresAt",
      "environment",
      "testOnly",
      "authorityBinding",
    ]);
    return challenge ? challenge as ReturnType<typeof challengeCore> : null;
  } catch {
    return null;
  }
}

function expectedProofTags(challenge: StagingTestCitizenPassV1) {
  return [
    ["schema", "staging_test_citizen_pass_proof_v1"],
    ["challenge", challenge.challengeId],
    ["e", challenge.participantSuggestionId, "", "synthetic-adoption-test"],
    ["municipality", challenge.municipalityId],
    ["test-only", "true"],
  ];
}

const SYNTHETIC_LABELS = Object.freeze({
  citizenship: "Test-Bürger-Pass – keine reale Bürgerberechtigung" as const,
  civicWorkflow:
    "Nur synthetische Vorschau – kein CivicCase und keine Verwaltungsbefürwortung" as const,
  governance:
    "Keine bindende Abstimmung, kein Beschluss, keine Treasury-Wirkung und keine Zahlung" as const,
});

function validSuggestion(
  value: ParticipantTopicSuggestionV1 | null,
  policy: SyntheticCitizenAdoptionPolicy,
  participantSuggestionId: string,
): ParticipantTopicSuggestionV1 | null {
  if (!value) return null;
  try {
    const suggestion = verifyParticipantTopicSuggestionForAdoption(value);
    return suggestion.schemaVersion ===
        "staging_participant_signed_topic_suggestion_v1" &&
      suggestion.suggestionId === participantSuggestionId &&
      suggestion.event.id === participantSuggestionId &&
      suggestion.draft.municipalityId === policy.municipalityId
      ? suggestion
      : null;
  } catch {
    return null;
  }
}

/**
 * Deep synthetic-only module. Its interface cannot express a municipal
 * receipt, real adoption, Case, ballot, administration, or treasury write.
 */
export function createSyntheticCitizenAdoptionService(
  dependencies: SyntheticCitizenAdoptionServiceDependencies,
): SyntheticCitizenAdoptionService {
  if (!policyValid(dependencies.policy)) {
    throw new Error("synthetic_citizen_adoption_service_config_invalid");
  }
  const now = dependencies.now ?? (() => new Date());
  const nextChallengeId =
    dependencies.randomId ?? (() => randomBytes(16).toString("hex"));

  const verifyStoredProjection = async (input: Readonly<{
    projection: unknown;
    participantSuggestionId: string;
    adopterPubkey?: string;
    proofEvent?: NostrEvent;
    requestChecksum?: string;
  }>): Promise<PublicSyntheticCitizenAdoptionProjectionV1> => {
    const projection = record(input.projection, [
      "schemaVersion",
      "participantSuggestionId",
      "proofEvent",
      "tracer",
      "acceptanceReceipt",
      "labels",
      "entryState",
      "environment",
      "testOnly",
      "authorityBinding",
      "submittedToCivicWorkflow",
      "civicCaseCreated",
      "administrativeEndorsement",
      "bindingVote",
      "councilDecision",
      "treasuryEffect",
      "paymentEffect",
    ]);
    const tracer = projection && record(projection.tracer, [
      "schemaVersion",
      "tracerId",
      "municipalityId",
      "topicId",
      "participantSuggestionId",
      "participantSuggestionRef",
      "participantPubkey",
      "sourceDiscussionId",
      "sourceAnswerReceiptId",
      "adopterPubkey",
      "proofEventId",
      "title",
      "summary",
      "entryState",
      "environment",
      "testOnly",
      "authorityBinding",
      "submittedToCivicWorkflow",
    ]);
    const acceptance = projection && record(projection.acceptanceReceipt, [
      "schemaVersion",
      "tracerId",
      "proofEventId",
      "municipalityId",
      "topicId",
      "participantSuggestionId",
      "adopterPubkey",
      "requestChecksum",
      "eventCreatedAt",
      "receivedAt",
      "policyVersion",
      "status",
      "environment",
      "testOnly",
      "authorityBinding",
      "receiptChecksum",
    ]);
    const labels = projection && record(projection.labels, [
      "citizenship",
      "civicWorkflow",
      "governance",
    ]);
    const proofEvent = projection?.proofEvent as NostrEvent | undefined;
    const challenge = proofEvent && parseChallengeMessage(proofEvent.content);
    if (
      !projection || !tracer || !acceptance || !labels || !proofEvent ||
      !challenge || !verifyEvent(proofEvent) ||
      (input.proofEvent !== undefined && stableJson(input.proofEvent) !== stableJson(proofEvent)) ||
      projection.schemaVersion !== "public_synthetic_citizen_adoption_projection_v1" ||
      projection.participantSuggestionId !== input.participantSuggestionId ||
      projection.entryState !== "synthetic_journey_preview_only" ||
      projection.environment !== "staging" || projection.testOnly !== true ||
      projection.authorityBinding !== "none" ||
      projection.submittedToCivicWorkflow !== false ||
      projection.civicCaseCreated !== false ||
      projection.administrativeEndorsement !== false ||
      projection.bindingVote !== false || projection.councilDecision !== false ||
      projection.treasuryEffect !== false || projection.paymentEffect !== false ||
      stableJson(labels) !== stableJson(SYNTHETIC_LABELS) ||
      tracer.schemaVersion !== "synthetic_citizen_adoption_tracer_v1" ||
      typeof tracer.tracerId !== "string" ||
      !/^urn:stadtstack:synthetic-citizen-adoption-tracer:[0-9a-f]{64}$/u.test(tracer.tracerId) ||
      tracer.municipalityId !== dependencies.policy.municipalityId ||
      typeof tracer.topicId !== "string" ||
      tracer.participantSuggestionId !== input.participantSuggestionId ||
      tracer.participantSuggestionRef !== `nostr://event/${input.participantSuggestionId}` ||
      typeof tracer.participantPubkey !== "string" || !HEX64.test(tracer.participantPubkey) ||
      typeof tracer.sourceDiscussionId !== "string" || !HEX64.test(tracer.sourceDiscussionId) ||
      typeof tracer.sourceAnswerReceiptId !== "string" ||
      typeof tracer.adopterPubkey !== "string" || !HEX64.test(tracer.adopterPubkey) ||
      (input.adopterPubkey !== undefined && tracer.adopterPubkey !== input.adopterPubkey) ||
      tracer.proofEventId !== proofEvent.id ||
      typeof tracer.title !== "string" || typeof tracer.summary !== "string" ||
      tracer.entryState !== "synthetic_journey_preview_only" ||
      tracer.environment !== "staging" || tracer.testOnly !== true ||
      tracer.authorityBinding !== "none" || tracer.submittedToCivicWorkflow !== false ||
      acceptance.schemaVersion !== "synthetic_citizen_adoption_tracer_acceptance_v1" ||
      acceptance.tracerId !== tracer.tracerId ||
      acceptance.proofEventId !== proofEvent.id ||
      acceptance.municipalityId !== tracer.municipalityId ||
      acceptance.topicId !== tracer.topicId ||
      acceptance.participantSuggestionId !== tracer.participantSuggestionId ||
      acceptance.adopterPubkey !== tracer.adopterPubkey ||
      typeof acceptance.requestChecksum !== "string" || !HEX64.test(acceptance.requestChecksum) ||
      (input.requestChecksum !== undefined && acceptance.requestChecksum !== input.requestChecksum) ||
      acceptance.eventCreatedAt !== proofEvent.created_at ||
      typeof acceptance.receivedAt !== "number" || !Number.isSafeInteger(acceptance.receivedAt) ||
      acceptance.policyVersion !== dependencies.policy.policyVersion ||
      acceptance.status !== "accepted_for_synthetic_preview" ||
      acceptance.environment !== "staging" || acceptance.testOnly !== true ||
      acceptance.authorityBinding !== "none" ||
      typeof acceptance.receiptChecksum !== "string" || !HEX64.test(acceptance.receiptChecksum) ||
      proofEvent.kind !== 1 || proofEvent.pubkey !== tracer.adopterPubkey ||
      challenge.schemaVersion !== "staging_test_citizen_pass_v1" ||
      challenge.audience !== "roebel-staging-synthetic-citizen-adoption" ||
      challenge.chainId !== 100 ||
      challenge.testCitizenNftContract !== dependencies.policy.testCitizenNftAddress ||
      challenge.subjectPubkey !== tracer.adopterPubkey ||
      challenge.municipalityId !== tracer.municipalityId ||
      challenge.policyVersion !== dependencies.policy.policyVersion ||
      challenge.participantSuggestionId !== tracer.participantSuggestionId ||
      challenge.topicId !== tracer.topicId ||
      challenge.environment !== "staging" || challenge.testOnly !== true ||
      challenge.authorityBinding !== "none"
    ) {
      throw new Error("synthetic_citizen_adoption_public_projection_invalid");
    }
    const tracerCore = {
      municipalityId: tracer.municipalityId,
      topicId: tracer.topicId,
      participantSuggestionId: tracer.participantSuggestionId,
      participantSuggestionRef: tracer.participantSuggestionRef,
      participantPubkey: tracer.participantPubkey,
      sourceDiscussionId: tracer.sourceDiscussionId,
      sourceAnswerReceiptId: tracer.sourceAnswerReceiptId,
      adopterPubkey: tracer.adopterPubkey,
      proofEventId: tracer.proofEventId,
      title: tracer.title,
      summary: tracer.summary,
    };
    if (
      tracer.tracerId !==
        `urn:stadtstack:synthetic-citizen-adoption-tracer:${sha256(tracerCore)}`
    ) {
      throw new Error("synthetic_citizen_adoption_public_projection_invalid");
    }
    const acceptanceCore = {
      schemaVersion: acceptance.schemaVersion,
      tracerId: acceptance.tracerId,
      proofEventId: acceptance.proofEventId,
      municipalityId: acceptance.municipalityId,
      topicId: acceptance.topicId,
      participantSuggestionId: acceptance.participantSuggestionId,
      adopterPubkey: acceptance.adopterPubkey,
      requestChecksum: acceptance.requestChecksum,
      eventCreatedAt: acceptance.eventCreatedAt,
      receivedAt: acceptance.receivedAt,
      policyVersion: acceptance.policyVersion,
      status: acceptance.status,
      environment: acceptance.environment,
      testOnly: acceptance.testOnly,
      authorityBinding: acceptance.authorityBinding,
    };
    if (acceptance.receiptChecksum !== sha256(acceptanceCore)) {
      throw new Error("synthetic_citizen_adoption_public_projection_invalid");
    }
    const suggestion = validSuggestion(
      await dependencies.sources.resolveParticipantSuggestion({
        participantSuggestionId: input.participantSuggestionId,
      }),
      dependencies.policy,
      input.participantSuggestionId,
    );
    if (
      !suggestion || tracer.topicId !== suggestion.draft.topicId ||
      tracer.participantPubkey !== suggestion.signerPubkey ||
      tracer.sourceDiscussionId !== suggestion.draft.sourceDiscussionId ||
      tracer.sourceAnswerReceiptId !== suggestion.draft.sourceAnswerReceiptId ||
      tracer.title !== suggestion.draft.title || tracer.summary !== suggestion.draft.summary
    ) {
      throw new Error("synthetic_citizen_adoption_public_projection_invalid");
    }
    return input.projection as PublicSyntheticCitizenAdoptionProjectionV1;
  };

  return Object.freeze({
    async preflight() {
      let evidence: PinnedCitizenNftEligibilityEvidence;
      try {
        evidence = await dependencies.eligibilityVerifier.verifyActiveCitizen({
          address: "0x0000000000000000000000000000000000000000",
        });
      } catch {
        throw new Error("synthetic_test_citizen_pass_verifier_not_ready");
      }
      if (
        evidence.chainId !== 100 ||
        evidence.contractAddress !== dependencies.policy.testCitizenNftAddress ||
        evidence.finalizedBlockNumber < 0n ||
        !/^0x[0-9a-f]{64}$/u.test(evidence.finalizedBlockHash)
      ) {
        throw new Error("synthetic_test_citizen_pass_verifier_not_ready");
      }
      return Object.freeze({
        schemaVersion:
          "staging_synthetic_citizen_adoption_verifier_preflight_v1" as const,
        chainId: 100 as const,
        testCitizenNftContract: dependencies.policy.testCitizenNftAddress,
        testCitizenNftRuntimeCodeKeccak256:
          dependencies.policy.testCitizenNftRuntimeCodeKeccak256,
        finalizedBlockNumber: evidence.finalizedBlockNumber,
        finalizedBlockHash: evidence.finalizedBlockHash,
        environment: "staging" as const,
        testOnly: true as const,
        authorityBinding: "none" as const,
      });
    },
    async issueChallenge(input) {
      if (
        !WALLET.test(input.walletAddress) ||
        !HEX64.test(input.sessionBindingSha256) ||
        !HEX64.test(input.subjectPubkey) ||
        !HEX64.test(input.participantSuggestionId)
      ) {
        throw new Error("synthetic_citizen_adoption_challenge_input_invalid");
      }
      const issuedAt = Math.floor(now().getTime() / 1_000);
      if (!Number.isSafeInteger(issuedAt) || issuedAt < 0) {
        throw new Error("synthetic_citizen_adoption_service_time_invalid");
      }
      const suggestion = validSuggestion(
        await dependencies.sources.resolveParticipantSuggestion({
          participantSuggestionId: input.participantSuggestionId,
        }),
        dependencies.policy,
        input.participantSuggestionId,
      );
      if (!suggestion) {
        throw new Error("synthetic_citizen_adoption_suggestion_unavailable");
      }
      const challengeId = nextChallengeId();
      if (!HEX32.test(challengeId)) {
        throw new Error("synthetic_citizen_adoption_challenge_id_unavailable");
      }
      const core = Object.freeze({
        schemaVersion: "staging_test_citizen_pass_v1" as const,
        challengeId,
        audience: "roebel-staging-synthetic-citizen-adoption" as const,
        chainId: 100 as const,
        testCitizenNftContract: dependencies.policy.testCitizenNftAddress,
        subjectPubkey: input.subjectPubkey,
        municipalityId: dependencies.policy.municipalityId,
        policyVersion: dependencies.policy.policyVersion,
        participantSuggestionId: suggestion.suggestionId,
        topicId: suggestion.draft.topicId,
        issuedAt,
        expiresAt: issuedAt + dependencies.policy.challengeTtlSeconds,
        environment: "staging" as const,
        testOnly: true as const,
        authorityBinding: "none" as const,
      });
      const canonicalChallenge = stableJson(core);
      const challenge = Object.freeze({
        ...core,
        canonicalChallenge,
        message: canonicalChallenge,
      });
      if (challenge.canonicalChallenge !== stableJson(challengeCore(challenge))) {
        throw new Error("synthetic_citizen_adoption_challenge_invalid");
      }
      return dependencies.challenges.issue({
        challenge,
        walletAddress: input.walletAddress,
        sessionBindingSha256: input.sessionBindingSha256,
      });
    },
    async acceptTracer(input) {
      const { request } = input;
      if (
        !WALLET.test(input.walletAddress) ||
        !HEX64.test(input.sessionBindingSha256) ||
        !request || typeof request !== "object" || Array.isArray(request) ||
        Object.getPrototypeOf(request) !== Object.prototype ||
        !exactKeys(request as unknown as Record<string, unknown>, [
          "schemaVersion",
          "requestId",
          "idempotencyKey",
          "challengeId",
          "walletSignature",
          "nostrProofEvent",
        ]) ||
        request.schemaVersion !== "synthetic_citizen_adoption_tracer_request_v1" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(request.requestId) ||
        !/^[A-Za-z0-9._~-]{16,128}$/u.test(request.idempotencyKey) ||
        !HEX32.test(request.challengeId) ||
        !/^0x[0-9a-f]+$/u.test(request.walletSignature) ||
        (request.walletSignature.length - 2) % 2 !== 0 ||
        !verifyEvent(request.nostrProofEvent)
      ) {
        throw new Error("synthetic_citizen_adoption_request_invalid");
      }
      const requestChecksum = sha256({
        schemaVersion: request.schemaVersion,
        challengeId: request.challengeId,
        walletSignature: request.walletSignature,
        nostrProofEvent: request.nostrProofEvent,
      });
      const idempotencyKeySha256 = sha256Text(request.idempotencyKey);
      const replay = await dependencies.ledger.resolveReplay({
        requestId: request.requestId,
        idempotencyKeySha256,
        requestChecksum,
        proofEventId: request.nostrProofEvent.id,
      });
      if (replay) {
        try {
          return await verifyStoredProjection({
            projection: replay,
            participantSuggestionId:
              parseChallengeMessage(request.nostrProofEvent.content)?.participantSuggestionId ?? "",
            proofEvent: request.nostrProofEvent,
            requestChecksum,
          });
        } catch {
          throw new Error("synthetic_citizen_adoption_replay_mismatch");
        }
      }
      const receivedAt = Math.floor(now().getTime() / 1_000);
      if (!Number.isSafeInteger(receivedAt) || receivedAt < 0) {
        throw new Error("synthetic_citizen_adoption_service_time_invalid");
      }
      let challenge: StagingTestCitizenPassV1;
      try {
        challenge = await dependencies.challenges.consume({
          challengeId: request.challengeId,
          walletAddress: input.walletAddress,
          sessionBindingSha256: input.sessionBindingSha256,
          consumedAt: receivedAt,
        });
      } catch {
        throw new Error("synthetic_citizen_adoption_challenge_invalid");
      }
      if (
        challenge.challengeId !== request.challengeId ||
        challenge.canonicalChallenge !== stableJson(challengeCore(challenge)) ||
        challenge.message !== challenge.canonicalChallenge ||
        challenge.audience !== "roebel-staging-synthetic-citizen-adoption" ||
        challenge.chainId !== 100 ||
        challenge.testCitizenNftContract !== dependencies.policy.testCitizenNftAddress ||
        challenge.municipalityId !== dependencies.policy.municipalityId ||
        challenge.policyVersion !== dependencies.policy.policyVersion ||
        challenge.environment !== "staging" || challenge.testOnly !== true ||
        challenge.authorityBinding !== "none" ||
        challenge.issuedAt > receivedAt || challenge.expiresAt <= receivedAt ||
        challenge.expiresAt - challenge.issuedAt !== dependencies.policy.challengeTtlSeconds
      ) {
        throw new Error("synthetic_citizen_adoption_challenge_invalid");
      }
      const proofEvent = request.nostrProofEvent;
      if (
        proofEvent.kind !== 1 || proofEvent.pubkey !== challenge.subjectPubkey ||
        proofEvent.created_at !== challenge.issuedAt ||
        proofEvent.content !== challenge.message ||
        stableJson(proofEvent.tags) !== stableJson(expectedProofTags(challenge))
      ) {
        throw new Error("synthetic_citizen_adoption_nostr_proof_invalid");
      }
      let walletValid: boolean;
      try {
        walletValid = await dependencies.walletVerifier.verifyWalletSignature({
          address: input.walletAddress,
          message: challenge.message,
          signature: request.walletSignature,
        });
      } catch {
        throw new Error("synthetic_citizen_adoption_wallet_verification_unavailable");
      }
      if (!walletValid) {
        throw new Error("synthetic_citizen_adoption_wallet_signature_invalid");
      }
      let privateEligibilityEvidence: PinnedCitizenNftEligibilityEvidence;
      try {
        privateEligibilityEvidence =
          await dependencies.eligibilityVerifier.verifyActiveCitizen({
            address: input.walletAddress,
          });
      } catch {
        throw new Error("synthetic_test_citizen_pass_verification_unavailable");
      }
      if (!privateEligibilityEvidence.active) {
        throw new Error("synthetic_test_citizen_pass_required");
      }
      if (
        privateEligibilityEvidence.chainId !== 100 ||
        privateEligibilityEvidence.contractAddress !== dependencies.policy.testCitizenNftAddress ||
        privateEligibilityEvidence.finalizedBlockNumber < 0n ||
        !/^0x[0-9a-f]{64}$/u.test(privateEligibilityEvidence.finalizedBlockHash)
      ) {
        throw new Error("synthetic_test_citizen_pass_evidence_invalid");
      }
      const suggestion = validSuggestion(
        await dependencies.sources.resolveParticipantSuggestion({
          participantSuggestionId: challenge.participantSuggestionId,
        }),
        dependencies.policy,
        challenge.participantSuggestionId,
      );
      if (!suggestion || suggestion.draft.topicId !== challenge.topicId) {
        throw new Error("synthetic_citizen_adoption_suggestion_unavailable");
      }
      const tracerCore = Object.freeze({
        municipalityId: suggestion.draft.municipalityId,
        topicId: suggestion.draft.topicId,
        participantSuggestionId: suggestion.suggestionId,
        participantSuggestionRef: `nostr://event/${suggestion.suggestionId}`,
        participantPubkey: suggestion.signerPubkey,
        sourceDiscussionId: suggestion.draft.sourceDiscussionId,
        sourceAnswerReceiptId: suggestion.draft.sourceAnswerReceiptId,
        adopterPubkey: proofEvent.pubkey,
        proofEventId: proofEvent.id,
        title: suggestion.draft.title,
        summary: suggestion.draft.summary,
      });
      const tracer: SyntheticCitizenAdoptionTracerV1 = Object.freeze({
        schemaVersion: "synthetic_citizen_adoption_tracer_v1",
        tracerId:
          `urn:stadtstack:synthetic-citizen-adoption-tracer:${sha256(tracerCore)}`,
        ...tracerCore,
        entryState: "synthetic_journey_preview_only",
        environment: "staging",
        testOnly: true,
        authorityBinding: "none",
        submittedToCivicWorkflow: false,
      });
      const acceptanceCore = Object.freeze({
        schemaVersion: "synthetic_citizen_adoption_tracer_acceptance_v1" as const,
        tracerId: tracer.tracerId,
        proofEventId: proofEvent.id,
        municipalityId: tracer.municipalityId,
        topicId: tracer.topicId,
        participantSuggestionId: tracer.participantSuggestionId,
        adopterPubkey: tracer.adopterPubkey,
        requestChecksum,
        eventCreatedAt: proofEvent.created_at,
        receivedAt,
        policyVersion: dependencies.policy.policyVersion,
        status: "accepted_for_synthetic_preview" as const,
        environment: "staging" as const,
        testOnly: true as const,
        authorityBinding: "none" as const,
      });
      const acceptanceReceipt: SyntheticCitizenAdoptionTracerAcceptanceV1 =
        Object.freeze({
          ...acceptanceCore,
          receiptChecksum: sha256(acceptanceCore),
        });
      const projection: PublicSyntheticCitizenAdoptionProjectionV1 =
        Object.freeze({
          schemaVersion: "public_synthetic_citizen_adoption_projection_v1",
          participantSuggestionId: suggestion.suggestionId,
          proofEvent,
          tracer,
          acceptanceReceipt,
          labels: SYNTHETIC_LABELS,
          entryState: "synthetic_journey_preview_only",
          environment: "staging",
          testOnly: true,
          authorityBinding: "none",
          submittedToCivicWorkflow: false,
          civicCaseCreated: false,
          administrativeEndorsement: false,
          bindingVote: false,
          councilDecision: false,
          treasuryEffect: false,
          paymentEffect: false,
        });
      const accepted = await dependencies.ledger.accept({
        requestId: request.requestId,
        idempotencyKeySha256,
        requestChecksum,
        receivedAt,
        maxEventClockSkewSeconds: dependencies.policy.maxEventClockSkewSeconds,
        proofEvent,
        privateEligibilityEvidence,
        projection,
      });
      try {
        return await verifyStoredProjection({
          projection: accepted,
          participantSuggestionId: suggestion.suggestionId,
          proofEvent,
          requestChecksum,
        });
      } catch {
        throw new Error("synthetic_citizen_adoption_acceptance_mismatch");
      }
    },
    async readPublicTracer(input) {
      if (
        !HEX64.test(input.participantSuggestionId) ||
        !HEX64.test(input.adopterPubkey)
      ) {
        throw new Error("synthetic_citizen_adoption_public_read_invalid");
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
