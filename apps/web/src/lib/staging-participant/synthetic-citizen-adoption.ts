import {
  verifyEvent,
  type NostrEvent,
  type ParticipantTopicSuggestionV1,
} from "@netizen-labs/nostr";

import type { CitizenSession } from "@/lib/citizen-session/session";

const API_ROOT =
  "/api/staging-participant/v1/synthetic-citizen-adoption";
const HEX64 = /^[0-9a-f]{64}$/u;
const CACHE_PREFIX = "roebel-staging-synthetic-citizen-adopter-v1:";
export const STAGING_TEST_CITIZEN_NFT_ADDRESS =
  "0x0be374808a567c9088ac8208b90a4239432b3220" as const;

export type StagingTestCitizenPass = Readonly<{
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

export type PublicSyntheticCitizenAdoptionProjection = Readonly<{
  schemaVersion: "public_synthetic_citizen_adoption_projection_v1";
  participantSuggestionId: string;
  proofEvent: NostrEvent;
  tracer: Readonly<{
    schemaVersion: "synthetic_citizen_adoption_tracer_v1";
    tracerId: string;
    municipalityId: string;
    topicId: string;
    participantSuggestionId: string;
    adopterPubkey: string;
    proofEventId: string;
    entryState: "synthetic_journey_preview_only";
    environment: "staging";
    testOnly: true;
    authorityBinding: "none";
    submittedToCivicWorkflow: false;
  }>;
  acceptanceReceipt: Readonly<{
    schemaVersion: "synthetic_citizen_adoption_tracer_acceptance_v1";
    participantSuggestionId: string;
    adopterPubkey: string;
    proofEventId: string;
    environment: "staging";
    testOnly: true;
    authorityBinding: "none";
  }>;
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

export class SyntheticCitizenAdoptionClientError extends Error {
  readonly code: string;
  readonly status?: number;

  constructor(code: string, status?: number) {
    super(code);
    this.name = "SyntheticCitizenAdoptionClientError";
    this.code = code;
    this.status = status;
  }
}

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

function object(value: unknown): Record<string, unknown> | null {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length &&
    actual.every((key, index) => key === wanted[index]);
}

function challengeCore(challenge: StagingTestCitizenPass) {
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
  };
}

function validChallenge(
  value: unknown,
  suggestion: ParticipantTopicSuggestionV1,
  subjectPubkey: string,
): value is StagingTestCitizenPass {
  const challenge = object(value);
  if (
    !challenge ||
    !exactKeys(challenge, [
      "schemaVersion", "challengeId", "audience", "chainId",
      "testCitizenNftContract", "subjectPubkey", "municipalityId",
      "policyVersion", "participantSuggestionId", "topicId", "issuedAt",
      "expiresAt", "environment", "testOnly", "authorityBinding",
      "canonicalChallenge", "message",
    ]) ||
    challenge.schemaVersion !== "staging_test_citizen_pass_v1" ||
    challenge.audience !== "roebel-staging-synthetic-citizen-adoption" ||
    typeof challenge.challengeId !== "string" ||
    !/^[0-9a-f]{32}$/u.test(challenge.challengeId) ||
    challenge.chainId !== 100 ||
    challenge.testCitizenNftContract !== STAGING_TEST_CITIZEN_NFT_ADDRESS ||
    challenge.subjectPubkey !== subjectPubkey ||
    challenge.municipalityId !== suggestion.draft.municipalityId ||
    challenge.participantSuggestionId !== suggestion.suggestionId ||
    challenge.topicId !== suggestion.draft.topicId ||
    typeof challenge.policyVersion !== "string" ||
    typeof challenge.issuedAt !== "number" ||
    !Number.isSafeInteger(challenge.issuedAt) ||
    typeof challenge.expiresAt !== "number" ||
    !Number.isSafeInteger(challenge.expiresAt) ||
    challenge.expiresAt - challenge.issuedAt !== 300 ||
    challenge.environment !== "staging" || challenge.testOnly !== true ||
    challenge.authorityBinding !== "none" ||
    typeof challenge.canonicalChallenge !== "string" ||
    challenge.canonicalChallenge !== stableJson(challengeCore(challenge as never)) ||
    challenge.message !== challenge.canonicalChallenge
  ) return false;
  return true;
}

function validProjection(
  value: unknown,
  participantSuggestionId: string,
  adopterPubkey: string,
): value is PublicSyntheticCitizenAdoptionProjection {
  const projection = object(value);
  const tracer = object(projection?.tracer);
  const acceptance = object(projection?.acceptanceReceipt);
  const labels = object(projection?.labels);
  const proofEvent = projection?.proofEvent as NostrEvent | undefined;
  if (
    !projection ||
    !exactKeys(projection, [
      "schemaVersion", "participantSuggestionId", "proofEvent", "tracer",
      "acceptanceReceipt", "labels", "entryState", "environment", "testOnly",
      "authorityBinding", "submittedToCivicWorkflow", "civicCaseCreated",
      "administrativeEndorsement", "bindingVote", "councilDecision",
      "treasuryEffect", "paymentEffect",
    ]) ||
    projection.schemaVersion !== "public_synthetic_citizen_adoption_projection_v1" ||
    projection.participantSuggestionId !== participantSuggestionId ||
    projection.entryState !== "synthetic_journey_preview_only" ||
    projection.environment !== "staging" || projection.testOnly !== true ||
    projection.authorityBinding !== "none" ||
    projection.submittedToCivicWorkflow !== false ||
    projection.civicCaseCreated !== false ||
    projection.administrativeEndorsement !== false ||
    projection.bindingVote !== false || projection.councilDecision !== false ||
    projection.treasuryEffect !== false || projection.paymentEffect !== false ||
    !proofEvent || !verifyEvent(proofEvent) ||
    proofEvent.pubkey !== adopterPubkey ||
    !tracer ||
    !exactKeys(tracer, [
      "schemaVersion", "tracerId", "municipalityId", "topicId",
      "participantSuggestionId", "participantSuggestionRef", "participantPubkey",
      "sourceDiscussionId", "sourceAnswerReceiptId", "adopterPubkey",
      "proofEventId", "title", "summary", "entryState", "environment",
      "testOnly", "authorityBinding", "submittedToCivicWorkflow",
    ]) ||
    tracer.schemaVersion !== "synthetic_citizen_adoption_tracer_v1" ||
    tracer.participantSuggestionId !== participantSuggestionId ||
    tracer.adopterPubkey !== adopterPubkey || tracer.proofEventId !== proofEvent.id ||
    tracer.entryState !== "synthetic_journey_preview_only" ||
    tracer.environment !== "staging" || tracer.testOnly !== true ||
    tracer.authorityBinding !== "none" || tracer.submittedToCivicWorkflow !== false ||
    !acceptance ||
    !exactKeys(acceptance, [
      "schemaVersion", "tracerId", "proofEventId", "municipalityId", "topicId",
      "participantSuggestionId", "adopterPubkey", "requestChecksum",
      "eventCreatedAt", "receivedAt", "policyVersion", "status", "environment",
      "testOnly", "authorityBinding", "receiptChecksum",
    ]) ||
    acceptance.schemaVersion !== "synthetic_citizen_adoption_tracer_acceptance_v1" ||
    acceptance.participantSuggestionId !== participantSuggestionId ||
    acceptance.adopterPubkey !== adopterPubkey ||
    acceptance.proofEventId !== proofEvent.id ||
    acceptance.environment !== "staging" || acceptance.testOnly !== true ||
    acceptance.authorityBinding !== "none" ||
    !labels || !exactKeys(labels, ["citizenship", "civicWorkflow", "governance"]) ||
    labels.citizenship !== "Test-Bürger-Pass – keine reale Bürgerberechtigung" ||
    labels.civicWorkflow !==
      "Nur synthetische Vorschau – kein CivicCase und keine Verwaltungsbefürwortung" ||
    labels.governance !==
      "Keine bindende Abstimmung, kein Beschluss, keine Treasury-Wirkung und keine Zahlung" ||
    Object.hasOwn(projection, "eligibilityReceipt") ||
    Object.hasOwn(projection, "adoptionEvent") ||
    Object.hasOwn(projection, "caseBindingReceipt")
  ) return false;
  return true;
}

function storage(): Storage | null {
  return typeof window === "undefined" ? null : window.sessionStorage;
}

function cacheKey(walletAddress: string) {
  return `${CACHE_PREFIX}${walletAddress.toLowerCase()}`;
}

export function loadCachedSyntheticAdopterPubkey(walletAddress: string) {
  try {
    const value = storage()?.getItem(cacheKey(walletAddress))?.toLowerCase();
    return value && HEX64.test(value) ? value : null;
  } catch {
    return null;
  }
}

export function saveCachedSyntheticAdopterPubkey(
  walletAddress: string,
  pubkey: string,
) {
  if (!/^0x[0-9a-f]{40}$/u.test(walletAddress.toLowerCase()) || !HEX64.test(pubkey)) {
    throw new SyntheticCitizenAdoptionClientError("synthetic_citizen_adoption_cache_invalid");
  }
  try {
    storage()?.setItem(cacheKey(walletAddress), pubkey);
  } catch {
    // A blocked browser cache must not invalidate an already stored tracer.
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function responseError(value: unknown, fallback: string) {
  const payload = object(value);
  return typeof payload?.error === "string" ? payload.error : fallback;
}

async function post(path: "challenge" | "tracers", body: Record<string, unknown>) {
  const response = await fetch(`${API_ROOT}/${path}`, {
    method: "POST",
    cache: "no-store",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await readJson(response);
  if (!response.ok) {
    throw new SyntheticCitizenAdoptionClientError(
      responseError(payload, "synthetic_citizen_adoption_gateway_rejected"),
      response.status,
    );
  }
  return payload;
}

export async function loadPublicSyntheticCitizenAdoption(
  participantSuggestionId: string,
  adopterPubkey: string,
): Promise<PublicSyntheticCitizenAdoptionProjection | null> {
  if (!HEX64.test(participantSuggestionId) || !HEX64.test(adopterPubkey)) {
    throw new SyntheticCitizenAdoptionClientError("synthetic_citizen_adoption_public_read_invalid");
  }
  const response = await fetch(
    `${API_ROOT}/by-suggestion/${participantSuggestionId}/adopter/${adopterPubkey}`,
    { method: "GET", cache: "no-store", credentials: "same-origin" },
  );
  if (response.status === 404) return null;
  const payload = await readJson(response);
  if (!response.ok) {
    throw new SyntheticCitizenAdoptionClientError(
      "synthetic_citizen_adoption_projection_unavailable",
      response.status,
    );
  }
  if (!validProjection(payload, participantSuggestionId, adopterPubkey)) {
    throw new SyntheticCitizenAdoptionClientError(
      "synthetic_citizen_adoption_projection_invalid",
    );
  }
  return payload;
}

type SyntheticCitizenAdoptionSession = Pick<
  CitizenSession,
  "getNostrPubkey" | "signMessage" | "signSyntheticCitizenPassChallenge"
>;

export async function traceSyntheticCitizenAdoption(input: Readonly<{
  participantSuggestion: ParticipantTopicSuggestionV1;
  session: SyntheticCitizenAdoptionSession;
}>): Promise<PublicSyntheticCitizenAdoptionProjection> {
  const subjectPubkey = (await input.session.getNostrPubkey()).toLowerCase();
  if (
    input.participantSuggestion.schemaVersion !==
      "staging_participant_signed_topic_suggestion_v1" ||
    input.participantSuggestion.suggestionId !== input.participantSuggestion.event.id ||
    !HEX64.test(subjectPubkey)
  ) {
    throw new SyntheticCitizenAdoptionClientError("synthetic_citizen_adoption_input_invalid");
  }
  const challengeValue = await post("challenge", {
    schemaVersion: "synthetic_citizen_adoption_challenge_request_v1",
    participantSuggestionId: input.participantSuggestion.suggestionId,
    subjectPubkey,
  });
  if (!validChallenge(challengeValue, input.participantSuggestion, subjectPubkey)) {
    throw new SyntheticCitizenAdoptionClientError("synthetic_citizen_adoption_challenge_invalid");
  }
  const challenge = challengeValue;
  const [walletSignature, nostrProofEvent] = await Promise.all([
    input.session.signMessage(challenge.message),
    input.session.signSyntheticCitizenPassChallenge(challenge),
  ]);
  if (!globalThis.crypto?.randomUUID) {
    throw new SyntheticCitizenAdoptionClientError("secure_request_id_unavailable");
  }
  const requestId = globalThis.crypto.randomUUID().toLowerCase();
  const accepted = await post("tracers", {
    schemaVersion: "synthetic_citizen_adoption_tracer_request_v1",
    requestId,
    idempotencyKey: `synthetic-adoption.${requestId}`,
    challengeId: challenge.challengeId,
    walletSignature,
    nostrProofEvent,
  });
  if (!validProjection(accepted, input.participantSuggestion.suggestionId, subjectPubkey)) {
    throw new SyntheticCitizenAdoptionClientError("synthetic_citizen_adoption_acceptance_invalid");
  }
  return accepted;
}
