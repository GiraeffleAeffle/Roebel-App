import {
  createMunicipalCivicEligibilityReceiptProofVerifier,
  verifyEvent,
  type MunicipalCivicEligibilityReceiptV1,
  type MunicipalCivicEligibilityPolicyV1,
  type NostrEvent,
  type ParticipantTopicSuggestionV1,
} from "@netizen-labs/nostr";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";

import type { CitizenSession } from "@/lib/citizen-session/session";

const API_ROOT = "/api/staging-participant/v1/citizen-adoption";
const HEX64 = /^[0-9a-f]{64}$/u;
const WALLET = /^0x[0-9a-f]{40}$/u;
const ADOPTER_CACHE_PREFIX = "roebel:citizen-adopter-pubkey:v1";

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

function checksum(value: unknown): string {
  return bytesToHex(sha256(utf8ToBytes(stableJson(value))));
}

function browserStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function adopterCacheKey(walletAddress: string): string {
  return `${ADOPTER_CACHE_PREFIX}:${checksum(walletAddress.toLowerCase())}`;
}

/**
 * Read only a public Nostr pubkey used as a reload hint. The server projection,
 * signatures, and checksums remain the verification boundary.
 */
export function loadCachedCitizenAdopterPubkey(
  walletAddress: string
): string | null {
  const normalized = walletAddress.toLowerCase();
  if (!WALLET.test(normalized)) return null;
  try {
    const value =
      browserStorage()?.getItem(adopterCacheKey(normalized)) ?? null;
    return value && HEX64.test(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * Retain only the public adopter pubkey for same-tab reloads. Browser-session
 * closure clears the wallet-hash/pubkey correlation; proofs and receipts are
 * never cached.
 */
export function saveCachedCitizenAdopterPubkey(
  walletAddress: string,
  adopterPubkey: string
): void {
  const normalized = walletAddress.toLowerCase();
  if (!WALLET.test(normalized) || !HEX64.test(adopterPubkey)) return;
  try {
    browserStorage()?.setItem(adopterCacheKey(normalized), adopterPubkey);
  } catch {
    // The accepted server projection still remains available by its public key.
  }
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[]
): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return (
    actual.length === wanted.length &&
    actual.every((key, index) => key === wanted[index])
  );
}

export type CitizenAdoptionAcceptanceReceipt = Readonly<{
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

export type PublicCitizenAdoptionProjection = Readonly<{
  schemaVersion: "public_citizen_adoption_projection_v1";
  participantSuggestionId: string;
  adoptionEvent: NostrEvent;
  eligibilityReceipt: MunicipalCivicEligibilityReceiptV1;
  acceptanceReceipt: CitizenAdoptionAcceptanceReceipt;
  entryState: "case_steward_review_required";
  authorityBinding: "civic_eligibility_only";
  submittedToCivicWorkflow: false;
  administrativeEndorsement: false;
  bindingVote: false;
  councilDecision: false;
  treasuryEffect: false;
  paymentEffect: false;
}>;

export class CitizenAdoptionClientError extends Error {
  readonly code: string;
  readonly httpStatus?: number;

  constructor(code: string, httpStatus?: number) {
    super(code);
    this.name = "CitizenAdoptionClientError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function validReceipt(
  value: unknown,
  participantSuggestionId: string,
  adopterPubkey: string
): value is MunicipalCivicEligibilityReceiptV1 {
  const receipt = object(value);
  const core = object(receipt?.eligibilityCore);
  const proof = object(receipt?.proof);
  return Boolean(
    receipt &&
    exactKeys(receipt, [
      "schemaVersion",
      "eligibilityCore",
      "receiptId",
      "payloadChecksum",
      "statusRef",
      "proof",
    ]) &&
    receipt.schemaVersion === "municipal_civic_eligibility_receipt_v1" &&
    core &&
    exactKeys(core, [
      "municipalityId",
      "eligibilityClass",
      "subjectPubkey",
      "participantSuggestionId",
      "topicId",
      "policyVersion",
      "issuer",
      "issuedAt",
      "expiresAt",
      "authorityBinding",
    ]) &&
    core?.eligibilityClass === "municipal_civic_participation" &&
    core?.subjectPubkey === adopterPubkey &&
    core?.participantSuggestionId === participantSuggestionId &&
    core?.authorityBinding === "civic_eligibility_only" &&
    typeof core?.issuedAt === "number" &&
    Number.isSafeInteger(core.issuedAt) &&
    typeof core?.expiresAt === "number" &&
    Number.isSafeInteger(core.expiresAt) &&
    core.expiresAt > core.issuedAt &&
    typeof receipt?.payloadChecksum === "string" &&
    HEX64.test(receipt.payloadChecksum) &&
    receipt.payloadChecksum === checksum(core) &&
    receipt?.receiptId ===
      `urn:stadtstack:municipal-civic-eligibility-receipt:${receipt.payloadChecksum}` &&
    typeof receipt?.statusRef === "string" &&
    receipt.statusRef.endsWith(`/${receipt.payloadChecksum}`) &&
    proof &&
    exactKeys(proof, ["algorithm", "keyId", "signature"]) &&
    proof?.algorithm === "Ed25519" &&
    typeof proof?.keyId === "string" &&
    /^[A-Za-z0-9_-]+$/u.test(String(proof?.signature ?? ""))
  );
}

function validProjection(
  value: unknown,
  participantSuggestionId: string,
  adopterPubkey: string
): value is PublicCitizenAdoptionProjection {
  const projection = object(value);
  const event = object(projection?.adoptionEvent) as NostrEvent | null;
  const acceptance = object(projection?.acceptanceReceipt);
  if (
    !projection ||
    !exactKeys(projection, [
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
    ]) ||
    projection.schemaVersion !== "public_citizen_adoption_projection_v1" ||
    projection.participantSuggestionId !== participantSuggestionId ||
    projection.entryState !== "case_steward_review_required" ||
    projection.authorityBinding !== "civic_eligibility_only" ||
    projection.submittedToCivicWorkflow !== false ||
    projection.administrativeEndorsement !== false ||
    projection.bindingVote !== false ||
    projection.councilDecision !== false ||
    projection.treasuryEffect !== false ||
    projection.paymentEffect !== false ||
    !event ||
    !verifyEvent(event) ||
    event.pubkey !== adopterPubkey ||
    !validReceipt(
      projection.eligibilityReceipt,
      participantSuggestionId,
      event.pubkey
    ) ||
    !acceptance ||
    !exactKeys(acceptance, [
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
    ]) ||
    acceptance.schemaVersion !==
      "citizen_topic_suggestion_adoption_acceptance_receipt_v1" ||
    acceptance.participantSuggestionId !== participantSuggestionId ||
    acceptance.adoptionEventId !== event.id ||
    acceptance.adopterPubkey !== event.pubkey ||
    acceptance.eligibilityReceiptId !==
      projection.eligibilityReceipt.receiptId ||
    acceptance.status !== "accepted" ||
    acceptance.authorityBinding !== "civic_eligibility_only" ||
    acceptance.requestChecksum !==
      checksum({
        schemaVersion: "citizen_topic_suggestion_adoption_request_v1",
        adoptionEvent: event,
      }) ||
    acceptance.receiptChecksum !==
      checksum({
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
      })
  ) {
    return false;
  }
  try {
    const adoption = object(JSON.parse(event.content));
    if (
      !adoption ||
      !exactKeys(adoption, [
        "schemaVersion",
        "adoptionId",
        "municipalityId",
        "topicId",
        "participantSuggestionId",
        "participantSuggestionRef",
        "participantPubkey",
        "sourceDiscussionId",
        "sourceAnswerReceiptId",
        "adopterPubkey",
        "eligibilityReceiptId",
        "eligibilityReceiptChecksum",
        "title",
        "summary",
        "entryState",
        "authorityBinding",
        "submittedToCivicWorkflow",
      ])
    ) {
      return false;
    }
    const adoptionCore = {
      municipalityId: adoption.municipalityId,
      topicId: adoption.topicId,
      participantSuggestionId: adoption.participantSuggestionId,
      participantSuggestionRef: adoption.participantSuggestionRef,
      participantPubkey: adoption.participantPubkey,
      sourceDiscussionId: adoption.sourceDiscussionId,
      sourceAnswerReceiptId: adoption.sourceAnswerReceiptId,
      adopterPubkey: adoption.adopterPubkey,
      eligibilityReceiptId: adoption.eligibilityReceiptId,
      eligibilityReceiptChecksum: adoption.eligibilityReceiptChecksum,
      title: adoption.title,
      summary: adoption.summary,
    };
    const expectedTags = [
      ["schema", "citizen_adopted_topic_suggestion_v1"],
      ["municipality", adoption.municipalityId],
      ["topic", adoption.topicId],
      ["e", participantSuggestionId, "", "adopted-suggestion"],
      ["e", adoption.sourceDiscussionId, "", "root"],
      ["p", adoption.participantPubkey],
      ["eligibility-receipt", projection.eligibilityReceipt.receiptId],
      ["credential-class", "municipal-civic-eligibility"],
    ];
    return Boolean(
      adoption.schemaVersion ===
        "public_citizen_topic_suggestion_adoption_v1" &&
      adoption.adoptionId ===
        `urn:stadtstack:citizen-topic-suggestion-adoption:${checksum(adoptionCore)}` &&
      acceptance.adoptionId === adoption.adoptionId &&
      adoption?.participantSuggestionId === participantSuggestionId &&
      adoption?.adopterPubkey === event.pubkey &&
      adoption?.eligibilityReceiptId ===
        projection.eligibilityReceipt.receiptId &&
      adoption?.eligibilityReceiptChecksum ===
        projection.eligibilityReceipt.payloadChecksum &&
      adoption?.entryState === "case_steward_review_required" &&
      adoption?.authorityBinding === "civic_eligibility_only" &&
      adoption?.submittedToCivicWorkflow === false &&
      event.content === stableJson(adoption) &&
      stableJson(event.tags) === stableJson(expectedTags)
    );
  } catch {
    return false;
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export async function loadPublicCitizenAdoption(
  participantSuggestionId: string,
  adopterPubkey: string
): Promise<PublicCitizenAdoptionProjection | null> {
  if (!HEX64.test(participantSuggestionId) || !HEX64.test(adopterPubkey)) {
    throw new CitizenAdoptionClientError(
      "citizen_adoption_participant_suggestion_invalid"
    );
  }
  let response: Response;
  try {
    response = await fetch(
      `${API_ROOT}/by-suggestion/${participantSuggestionId}/adopter/${adopterPubkey}`,
      { cache: "no-store", credentials: "same-origin" }
    );
  } catch {
    throw new CitizenAdoptionClientError(
      "citizen_adoption_public_projection_unavailable"
    );
  }
  if (response.status === 404) return null;
  const payload = await readJson(response);
  if (!response.ok) {
    throw new CitizenAdoptionClientError(
      "citizen_adoption_public_projection_unavailable",
      response.status
    );
  }
  if (!validProjection(payload, participantSuggestionId, adopterPubkey)) {
    throw new CitizenAdoptionClientError(
      "citizen_adoption_public_projection_invalid",
      response.status
    );
  }
  return payload;
}

export type CitizenAdoptionSession = Pick<
  CitizenSession,
  | "getNostrPubkey"
  | "signMessage"
  | "signCitizenEligibilityChallenge"
  | "signCitizenTopicSuggestionAdoption"
>;

type CitizenEligibilityChallenge = Readonly<{
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

type CitizenEligibilityPublicPolicy = Readonly<{
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

type CitizenEligibilityIssuance = Readonly<{
  schemaVersion: "municipal_civic_eligibility_issuance_v1";
  eligibilityReceipt: MunicipalCivicEligibilityReceiptV1;
  eligibilityPolicy: CitizenEligibilityPublicPolicy;
  authorityBinding: "civic_eligibility_only";
}>;

function challengeCore(challenge: CitizenEligibilityChallenge) {
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
  };
}

function validChallenge(
  value: unknown,
  participantSuggestion: ParticipantTopicSuggestionV1,
  subjectPubkey: string
): value is CitizenEligibilityChallenge {
  const challenge = object(value);
  if (
    !challenge ||
    !exactKeys(challenge, [
      "schemaVersion",
      "challengeId",
      "audience",
      "sessionBindingSha256",
      "walletAddress",
      "chainId",
      "subjectPubkey",
      "municipalityId",
      "policyVersion",
      "participantSuggestionId",
      "topicId",
      "issuedAt",
      "expiresAt",
      "authorityBinding",
      "canonicalChallenge",
      "message",
    ]) ||
    challenge.schemaVersion !== "municipal_civic_eligibility_challenge_v1" ||
    challenge.audience !== "roebel-staging-citizen-adoption" ||
    typeof challenge.challengeId !== "string" ||
    !/^[0-9a-f]{32}$/u.test(challenge.challengeId) ||
    typeof challenge.sessionBindingSha256 !== "string" ||
    !HEX64.test(challenge.sessionBindingSha256) ||
    typeof challenge.walletAddress !== "string" ||
    !/^0x[0-9a-f]{40}$/u.test(challenge.walletAddress) ||
    challenge.chainId !== 100 ||
    challenge.subjectPubkey !== subjectPubkey ||
    challenge.participantSuggestionId !== participantSuggestion.suggestionId ||
    challenge.municipalityId !== participantSuggestion.draft.municipalityId ||
    challenge.topicId !== participantSuggestion.draft.topicId ||
    typeof challenge.issuedAt !== "number" ||
    !Number.isSafeInteger(challenge.issuedAt) ||
    typeof challenge.expiresAt !== "number" ||
    !Number.isSafeInteger(challenge.expiresAt) ||
    challenge.expiresAt <= challenge.issuedAt ||
    challenge.authorityBinding !== "civic_eligibility_only" ||
    typeof challenge.canonicalChallenge !== "string" ||
    challenge.canonicalChallenge !==
      stableJson(challengeCore(challenge as never)) ||
    challenge.message !== challenge.canonicalChallenge
  ) {
    return false;
  }
  return true;
}

function validatedIssuance(
  value: unknown,
  participantSuggestion: ParticipantTopicSuggestionV1,
  subjectPubkey: string
): Readonly<{
  receipt: MunicipalCivicEligibilityReceiptV1;
  policy: MunicipalCivicEligibilityPolicyV1;
}> {
  const issuance = object(value);
  const publicPolicy = object(issuance?.eligibilityPolicy);
  const proof = object(publicPolicy?.proof);
  const receipt = issuance?.eligibilityReceipt;
  if (
    !issuance ||
    !exactKeys(issuance, [
      "schemaVersion",
      "eligibilityReceipt",
      "eligibilityPolicy",
      "authorityBinding",
    ]) ||
    issuance.schemaVersion !== "municipal_civic_eligibility_issuance_v1" ||
    issuance.authorityBinding !== "civic_eligibility_only" ||
    !publicPolicy ||
    !exactKeys(publicPolicy, [
      "schemaVersion",
      "municipalityId",
      "policyVersion",
      "issuer",
      "statusBaseUrl",
      "verifiedAt",
      "proof",
    ]) ||
    publicPolicy.schemaVersion !==
      "municipal_civic_eligibility_public_policy_v1" ||
    publicPolicy.municipalityId !==
      participantSuggestion.draft.municipalityId ||
    typeof publicPolicy.policyVersion !== "string" ||
    typeof publicPolicy.issuer !== "string" ||
    typeof publicPolicy.statusBaseUrl !== "string" ||
    typeof publicPolicy.verifiedAt !== "number" ||
    !Number.isSafeInteger(publicPolicy.verifiedAt) ||
    !proof ||
    !exactKeys(proof, ["algorithm", "keyId", "publicKey"]) ||
    proof.algorithm !== "Ed25519" ||
    typeof proof.keyId !== "string" ||
    typeof proof.publicKey !== "string" ||
    !HEX64.test(proof.publicKey) ||
    !validReceipt(receipt, participantSuggestion.suggestionId, subjectPubkey)
  ) {
    throw new CitizenAdoptionClientError(
      "citizen_eligibility_issuance_invalid"
    );
  }
  const eligibilityReceipt = receipt as MunicipalCivicEligibilityReceiptV1;
  if (
    eligibilityReceipt.eligibilityCore.municipalityId !==
      publicPolicy.municipalityId ||
    eligibilityReceipt.eligibilityCore.policyVersion !==
      publicPolicy.policyVersion ||
    eligibilityReceipt.eligibilityCore.issuer !== publicPolicy.issuer ||
    !eligibilityReceipt.statusRef.startsWith(`${publicPolicy.statusBaseUrl}/`)
  ) {
    throw new CitizenAdoptionClientError(
      "citizen_eligibility_issuance_invalid"
    );
  }
  const verifyReceiptProof =
    createMunicipalCivicEligibilityReceiptProofVerifier({
      publicKey: proof.publicKey,
      keyId: proof.keyId,
    });
  if (
    !verifyReceiptProof(
      {
        domain: "municipal-civic-eligibility-receipt/v1",
        schemaVersion: eligibilityReceipt.schemaVersion,
        receiptId: eligibilityReceipt.receiptId,
        payloadChecksum: eligibilityReceipt.payloadChecksum,
        statusRef: eligibilityReceipt.statusRef,
      },
      eligibilityReceipt.proof
    )
  ) {
    throw new CitizenAdoptionClientError(
      "citizen_eligibility_issuer_proof_invalid"
    );
  }
  return {
    receipt: eligibilityReceipt,
    policy: {
      municipalityId: publicPolicy.municipalityId,
      policyVersion: publicPolicy.policyVersion,
      issuer: publicPolicy.issuer,
      statusBaseUrl: publicPolicy.statusBaseUrl,
      verifiedAt: publicPolicy.verifiedAt,
      verifyReceiptProof,
    },
  };
}

function responseErrorCode(payload: unknown, fallback: string): string {
  const value = object(payload);
  return typeof value?.error === "string" && value.error.length > 0
    ? value.error
    : fallback;
}

async function postJson(
  path: "challenge" | "eligibility" | "adoptions",
  body: Record<string, unknown>,
  options: Readonly<{ retryTransient?: boolean }> = {}
): Promise<unknown> {
  const encoded = JSON.stringify(body);
  const attempts = options.retryTransient ? 2 : 1;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(`${API_ROOT}/${path}`, {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: encoded,
      });
      const payload = await readJson(response);
      if (!response.ok) {
        if (
          attempt + 1 < attempts &&
          [502, 503, 504].includes(response.status)
        ) {
          continue;
        }
        throw new CitizenAdoptionClientError(
          responseErrorCode(payload, "citizen_adoption_gateway_rejected"),
          response.status
        );
      }
      return payload;
    } catch (cause) {
      if (cause instanceof CitizenAdoptionClientError) throw cause;
      if (attempt + 1 >= attempts) {
        throw new CitizenAdoptionClientError(
          "citizen_adoption_gateway_unavailable"
        );
      }
    }
  }
  throw new CitizenAdoptionClientError("citizen_adoption_gateway_unavailable");
}

function requestId(): string {
  if (!globalThis.crypto?.randomUUID) {
    throw new CitizenAdoptionClientError("secure_request_id_unavailable");
  }
  return globalThis.crypto.randomUUID().toLowerCase();
}

export async function adoptStagingParticipantSuggestion(
  input: Readonly<{
    participantSuggestion: ParticipantTopicSuggestionV1;
    session: CitizenAdoptionSession;
  }>
): Promise<PublicCitizenAdoptionProjection> {
  const { participantSuggestion, session } = input;
  const subjectPubkey = (await session.getNostrPubkey()).toLowerCase();
  if (
    participantSuggestion.schemaVersion !==
      "staging_participant_signed_topic_suggestion_v1" ||
    participantSuggestion.suggestionId !== participantSuggestion.event.id ||
    !HEX64.test(subjectPubkey)
  ) {
    throw new CitizenAdoptionClientError("citizen_adoption_input_invalid");
  }
  const persisted = await loadPublicCitizenAdoption(
    participantSuggestion.suggestionId,
    subjectPubkey
  );
  if (persisted) return persisted;
  const challengePayload = await postJson("challenge", {
    schemaVersion: "citizen_adoption_eligibility_challenge_request_v1",
    participantSuggestionId: participantSuggestion.suggestionId,
    subjectPubkey,
  });
  if (!validChallenge(challengePayload, participantSuggestion, subjectPubkey)) {
    throw new CitizenAdoptionClientError(
      "citizen_eligibility_challenge_invalid"
    );
  }
  const challenge = challengePayload;
  const [walletSignature, nostrProofEvent] = await Promise.all([
    session.signMessage(challenge.message),
    session.signCitizenEligibilityChallenge(challenge),
  ]);
  const issuancePayload = await postJson("eligibility", {
    schemaVersion: "citizen_adoption_eligibility_proof_request_v1",
    challengeId: challenge.challengeId,
    walletSignature,
    nostrProofEvent,
  });
  const issuance = validatedIssuance(
    issuancePayload,
    participantSuggestion,
    subjectPubkey
  );
  const now = Math.floor(Date.now() / 1_000);
  const createdAt = Math.max(
    now,
    participantSuggestion.event.created_at,
    issuance.receipt.eligibilityCore.issuedAt
  );
  if (createdAt >= issuance.receipt.eligibilityCore.expiresAt) {
    throw new CitizenAdoptionClientError("citizen_eligibility_receipt_expired");
  }
  const adoption = await session.signCitizenTopicSuggestionAdoption({
    participantSuggestion,
    eligibilityReceipt: issuance.receipt,
    eligibilityPolicy: issuance.policy,
    createdAt,
  });
  const id = requestId();
  const acceptedPayload = await postJson(
    "adoptions",
    {
      schemaVersion: "citizen_topic_suggestion_adoption_request_v1",
      requestId: id,
      idempotencyKey: `citizen-adoption.${id}`,
      adoptionEvent: adoption.event,
    },
    { retryTransient: true }
  );
  if (
    !validProjection(
      acceptedPayload,
      participantSuggestion.suggestionId,
      subjectPubkey
    )
  ) {
    throw new CitizenAdoptionClientError("citizen_adoption_acceptance_invalid");
  }
  return acceptedPayload;
}
