export type VerifiedPublicLegacyCaseBindingReceipt = Readonly<{
  schemaVersion: "public_case_binding_receipt_v1";
  rootEventId: string;
  topicId: string;
  candidateId: string;
  candidateEventId: string;
  sourceAnswerEventId: string;
  caseId: string;
  caseVersion: 3;
  caseEventIds: readonly [string, string, string];
  journalHeadChecksum: string;
  admissionEventChecksum: string;
  receiptChecksum: string;
  authorityBinding: "none";
  openDeskWrite: false;
}>;

export type VerifiedPublicAdoptedCaseBindingReceipt = Readonly<{
  schemaVersion: "public_case_binding_receipt_v2";
  rootEventId: string;
  topicId: string;
  candidateKind: "eligible_citizen_adopted_topic_suggestion_v1";
  candidateId: string;
  candidateEventId: string;
  participantSuggestionEventId: string;
  adopterPubkey: string;
  eligibilityReceiptId: string;
  eligibilityReceiptChecksum: string;
  eligibilityPolicyVersion: string;
  eligibilityIssuer: string;
  adoptionAcceptanceReceiptChecksum: string;
  sourceAnswerEventId: string;
  sourceAnswerReceiptId: string;
  caseId: string;
  caseVersion: 3;
  caseEventIds: readonly [string, string, string];
  journalHeadChecksum: string;
  admissionEventChecksum: string;
  receiptChecksum: string;
  authorityBinding: "none";
  administrativeEndorsement: false;
  bindingVote: false;
  councilDecision: false;
  openDeskWrite: false;
  treasuryEffect: false;
  paymentEffect: false;
}>;

export type VerifiedPublicCaseBindingReceipt =
  | VerifiedPublicLegacyCaseBindingReceipt
  | VerifiedPublicAdoptedCaseBindingReceipt;

const ROOT_EVENT_ID = /^[0-9a-f]{64}$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const HEX_SHA256 = /^[0-9a-f]{64}$/u;
const CASE_ID =
  /^urn:stadtstack:case:municipality:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?:[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
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
  rootEventId: string
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
    CASE_ID.test(parsed.caseId) &&
    parsed.caseVersion === 3 &&
    Array.isArray(caseEventIds) &&
    caseEventIds.length === 3 &&
    caseEventIds.every((entry) => typeof entry === "string") &&
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
  if (version === "public_case_binding_receipt_v2") {
    const parsed = exactRecord(value, V2_FIELDS);
    if (
      !parsed ||
      !commonReceipt(parsed, rootEventId) ||
      parsed.candidateKind !== "eligible_citizen_adopted_topic_suggestion_v1" ||
      typeof parsed.candidateId !== "string" ||
      !/^urn:stadtstack:citizen-topic-suggestion-adoption:[0-9a-f]{64}$/u.test(
        parsed.candidateId
      ) ||
      typeof parsed.participantSuggestionEventId !== "string" ||
      !ROOT_EVENT_ID.test(parsed.participantSuggestionEventId) ||
      typeof parsed.adopterPubkey !== "string" ||
      !ROOT_EVENT_ID.test(parsed.adopterPubkey) ||
      typeof parsed.eligibilityReceiptChecksum !== "string" ||
      !HEX_SHA256.test(parsed.eligibilityReceiptChecksum) ||
      parsed.eligibilityReceiptId !==
        `urn:stadtstack:municipal-civic-eligibility-receipt:${parsed.eligibilityReceiptChecksum}` ||
      typeof parsed.eligibilityPolicyVersion !== "string" ||
      parsed.eligibilityPolicyVersion.length === 0 ||
      typeof parsed.eligibilityIssuer !== "string" ||
      parsed.eligibilityIssuer.length === 0 ||
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
