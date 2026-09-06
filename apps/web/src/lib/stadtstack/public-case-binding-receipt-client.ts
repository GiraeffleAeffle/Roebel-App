// Type-only imports keep the server's checksum implementation out of the browser.
import type {
  PublicCaseBindingReceiptV1,
  PublicAdoptedCaseBindingReceiptV2,
  PublicSyntheticCaseBindingReceiptV1,
} from "./public-case-binding-receipt-contract";

export type VerifiedPublicLegacyCaseBindingReceipt = PublicCaseBindingReceiptV1;
export type VerifiedPublicAdoptedCaseBindingReceipt =
  PublicAdoptedCaseBindingReceiptV2;
export type VerifiedPublicSyntheticCaseBindingReceipt =
  PublicSyntheticCaseBindingReceiptV1;
export type VerifiedPublicMunicipalCaseBindingReceipt =
  | VerifiedPublicLegacyCaseBindingReceipt
  | VerifiedPublicAdoptedCaseBindingReceipt;
export type VerifiedPublicCaseBindingReceipt =
  | VerifiedPublicMunicipalCaseBindingReceipt
  | VerifiedPublicSyntheticCaseBindingReceipt;

export function isMunicipalCaseBindingReceipt(
  value: VerifiedPublicCaseBindingReceipt | null
): value is VerifiedPublicMunicipalCaseBindingReceipt {
  return (
    value?.schemaVersion === "public_case_binding_receipt_v1" ||
    value?.schemaVersion === "public_case_binding_receipt_v2"
  );
}

const ROOT_EVENT_ID = /^[0-9a-f]{64}$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const HEX_SHA256 = /^[0-9a-f]{64}$/u;
const CASE_ID =
  /^urn:stadtstack:case:municipality:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?:[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SYNTHETIC_CASE_ID = new RegExp(
  CASE_ID.source.replace(":case:", ":synthetic-case:"),
  "u"
);
const TOPIC_ID = /^urn:stadtstack:topic:municipality:[a-z0-9-]+:[a-z0-9-]+$/u;
const V1_FIELDS = [
  "schemaVersion",
  "rootEventId",
  "topicId",
  "candidateId",
  "candidateEventId",
  "sourceAnswerEventId",
  "caseId",
  "caseVersion",
  "caseEventIds",
  "journalHeadChecksum",
  "admissionEventChecksum",
  "receiptChecksum",
  "authorityBinding",
  "openDeskWrite",
] as const;
const V2_FIELDS = [
  "schemaVersion",
  "rootEventId",
  "topicId",
  "candidateKind",
  "candidateId",
  "candidateEventId",
  "participantSuggestionEventId",
  "adopterPubkey",
  "eligibilityReceiptId",
  "eligibilityReceiptChecksum",
  "eligibilityPolicyVersion",
  "eligibilityIssuer",
  "adoptionAcceptanceReceiptChecksum",
  "sourceAnswerEventId",
  "sourceAnswerReceiptId",
  "caseId",
  "caseVersion",
  "caseEventIds",
  "journalHeadChecksum",
  "admissionEventChecksum",
  "receiptChecksum",
  "authorityBinding",
  "administrativeEndorsement",
  "bindingVote",
  "councilDecision",
  "openDeskWrite",
  "treasuryEffect",
  "paymentEffect",
] as const;

const SYNTHETIC_FIELDS = [
  ...V2_FIELDS.filter(
    (field) =>
      ![
        "eligibilityReceiptId",
        "eligibilityReceiptChecksum",
        "eligibilityPolicyVersion",
        "eligibilityIssuer",
      ].includes(field)
  ),
  "testPolicyVersion",
  "environment",
  "testOnly",
  "civicCaseCreated",
  "syntheticCaseCreated",
];

function exactRecord(
  value: unknown,
  fields: readonly string[]
): Record<string, unknown> | null {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    return null;
  }
  const parsed = value as Record<string, unknown>;
  const keys = Object.keys(parsed);
  if (
    keys.length !== fields.length ||
    keys.some((key) => !fields.includes(key))
  ) {
    return null;
  }
  return parsed;
}

function commonReceipt(
  parsed: Record<string, unknown>,
  rootEventId: string,
  casePattern = CASE_ID
): boolean {
  const caseEventIds = parsed.caseEventIds;
  return (
    parsed.rootEventId === rootEventId &&
    typeof parsed.topicId === "string" &&
    TOPIC_ID.test(parsed.topicId) &&
    typeof parsed.candidateId === "string" &&
    typeof parsed.candidateEventId === "string" &&
    ROOT_EVENT_ID.test(parsed.candidateEventId) &&
    typeof parsed.sourceAnswerEventId === "string" &&
    ROOT_EVENT_ID.test(parsed.sourceAnswerEventId) &&
    typeof parsed.caseId === "string" &&
    casePattern.test(parsed.caseId) &&
    parsed.caseVersion === 3 &&
    Array.isArray(caseEventIds) &&
    caseEventIds.length === 3 &&
    caseEventIds.every(
      (entry, index) =>
        entry === `urn:stadtstack:case-event:${parsed.caseId}:${index + 1}`
    ) &&
    typeof parsed.journalHeadChecksum === "string" &&
    SHA256.test(parsed.journalHeadChecksum) &&
    parsed.admissionEventChecksum === parsed.journalHeadChecksum &&
    typeof parsed.receiptChecksum === "string" &&
    SHA256.test(parsed.receiptChecksum) &&
    parsed.authorityBinding === "none" &&
    parsed.openDeskWrite === false
  );
}

function receipt(
  value: unknown,
  rootEventId: string
): VerifiedPublicCaseBindingReceipt | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const version = (value as Record<string, unknown>).schemaVersion;
  if (version === "public_case_binding_receipt_v1") {
    const parsed = exactRecord(value, V1_FIELDS);
    if (
      !parsed ||
      !commonReceipt(parsed, rootEventId) ||
      typeof parsed.candidateId !== "string" ||
      parsed.candidateId !==
        `urn:stadtstack:signed-topic-suggestion:${parsed.candidateEventId}`
    ) {
      return null;
    }
    return parsed as unknown as VerifiedPublicLegacyCaseBindingReceipt;
  }
  if (
    version === "public_case_binding_receipt_v2" ||
    version === "public_synthetic_case_binding_receipt_v1"
  ) {
    const synthetic = version === "public_synthetic_case_binding_receipt_v1";
    const parsed = exactRecord(value, synthetic ? SYNTHETIC_FIELDS : V2_FIELDS);
    if (
      !parsed ||
      !commonReceipt(
        parsed,
        rootEventId,
        synthetic ? SYNTHETIC_CASE_ID : CASE_ID
      ) ||
      parsed.candidateKind !==
        (synthetic
          ? "synthetic_citizen_adoption_tracer_v1"
          : "eligible_citizen_adopted_topic_suggestion_v1") ||
      typeof parsed.candidateId !== "string" ||
      !(
        synthetic
          ? /^urn:stadtstack:synthetic-citizen-adoption-tracer:[0-9a-f]{64}$/u
          : /^urn:stadtstack:citizen-topic-suggestion-adoption:[0-9a-f]{64}$/u
      ).test(parsed.candidateId) ||
      typeof parsed.participantSuggestionEventId !== "string" ||
      !ROOT_EVENT_ID.test(parsed.participantSuggestionEventId) ||
      typeof parsed.adopterPubkey !== "string" ||
      !ROOT_EVENT_ID.test(parsed.adopterPubkey) ||
      typeof parsed.adoptionAcceptanceReceiptChecksum !== "string" ||
      !HEX_SHA256.test(parsed.adoptionAcceptanceReceiptChecksum) ||
      typeof parsed.sourceAnswerReceiptId !== "string" ||
      !/^urn:stadtstack:mecky-answer:[0-9a-f]{64}$/u.test(
        parsed.sourceAnswerReceiptId
      ) ||
      parsed.administrativeEndorsement !== false ||
      parsed.bindingVote !== false ||
      parsed.councilDecision !== false ||
      parsed.treasuryEffect !== false ||
      parsed.paymentEffect !== false
    ) {
      return null;
    }
    if (synthetic) {
      if (
        parsed.environment !== "staging" ||
        parsed.testOnly !== true ||
        parsed.civicCaseCreated !== false ||
        parsed.syntheticCaseCreated !== true ||
        typeof parsed.testPolicyVersion !== "string" ||
        !parsed.testPolicyVersion.trim() ||
        (parsed.caseId as string).split(":")[4] !==
          (parsed.topicId as string).split(":")[4]
      )
        return null;
      return parsed as unknown as VerifiedPublicSyntheticCaseBindingReceipt;
    }
    if (
      typeof parsed.eligibilityReceiptChecksum !== "string" ||
      !HEX_SHA256.test(parsed.eligibilityReceiptChecksum) ||
      parsed.eligibilityReceiptId !==
        `urn:stadtstack:municipal-civic-eligibility-receipt:${parsed.eligibilityReceiptChecksum}` ||
      typeof parsed.eligibilityPolicyVersion !== "string" ||
      parsed.eligibilityPolicyVersion.length === 0 ||
      typeof parsed.eligibilityIssuer !== "string" ||
      parsed.eligibilityIssuer.length === 0
    )
      return null;
    return parsed as unknown as VerifiedPublicAdoptedCaseBindingReceipt;
  }
  return null;
}

/**
 * The browser gets only the BFF result. The BFF verifies the canonical
 * checksum before returning it; this second structural guard keeps malformed
 * route responses from becoming UI state.
 */
export async function loadVerifiedPublicCaseBindingReceipt(
  rootEventId: string,
  fetchImpl: typeof fetch = fetch
): Promise<VerifiedPublicCaseBindingReceipt | null> {
  if (!ROOT_EVENT_ID.test(rootEventId)) return null;
  const response = await fetchImpl(
    `/api/stadtstack/case-bindings/by-discussion/${rootEventId}`,
    { method: "GET", cache: "no-store", credentials: "same-origin" }
  );
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("public_case_binding_unavailable");
  const value: unknown = await response.json();
  const verified = receipt(value, rootEventId);
  if (
    !verified ||
    response.headers.get("x-stadtstack-receipt-sha256") !==
      verified.receiptChecksum
  ) {
    throw new Error("public_case_binding_unavailable");
  }
  return verified;
}
