import { createHash } from "node:crypto";
import { types as utilTypes } from "node:util";

export type PublicCaseBindingReceiptV1 = Readonly<{
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

/**
 * ADR 0023 successor to the direct-candidate v1 receipt. The trusted public
 * projection attests the exact participant suggestion, citizen adoption,
 * municipal eligibility receipt and durable adoption-ledger acceptance that
 * the Case Steward admitted. The negative-effect fields are deliberately part
 * of the checksum-bound envelope rather than UI assumptions.
 */
export type PublicAdoptedCaseBindingReceiptV2 = Readonly<{
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

export type PublicCaseBindingReceipt =
  | PublicCaseBindingReceiptV1
  | PublicAdoptedCaseBindingReceiptV2;

const ROOT_EVENT_ID = /^[0-9a-f]{64}$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const HEX_SHA256 = /^[0-9a-f]{64}$/u;
const CONTROL = /[\u0000-\u001f\u007f]/u;
const MUNICIPALITY = /[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?/u;
const UUID_V7 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const CASE_ID = new RegExp(
  `^urn:stadtstack:case:municipality:(${MUNICIPALITY.source}):([0-9a-f-]{36})$`,
  "u"
);
const TOPIC_ID = /^urn:stadtstack:topic:municipality:([a-z0-9-]+):[a-z0-9-]+$/u;
const DIRECT_CANDIDATE_ID =
  /^urn:stadtstack:signed-topic-suggestion:[0-9a-f]{64}$/u;
const ADOPTED_CANDIDATE_ID =
  /^urn:stadtstack:citizen-topic-suggestion-adoption:[0-9a-f]{64}$/u;
const ELIGIBILITY_RECEIPT_ID =
  /^urn:stadtstack:municipal-civic-eligibility-receipt:[0-9a-f]{64}$/u;
const MECKY_RECEIPT_ID = /^urn:stadtstack:mecky-answer:[0-9a-f]{64}$/u;

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

function invalid(): never {
  throw new Error("public_case_binding_receipt_invalid");
}

function exactRecord(
  value: unknown,
  fields: readonly string[]
): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    utilTypes.isProxy(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    invalid();
  }
  const record = value as Record<string, unknown>;
  const keys = Reflect.ownKeys(record);
  if (
    keys.length !== fields.length ||
    keys.some((key) => typeof key !== "string" || !fields.includes(key))
  ) {
    invalid();
  }
  for (const field of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(record, field);
    if (
      !descriptor ||
      descriptor.get ||
      descriptor.set ||
      !descriptor.enumerable
    ) {
      invalid();
    }
  }
  return record;
}

function schemaVersion(value: unknown): string {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    utilTypes.isProxy(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    invalid();
  }
  const descriptor = Object.getOwnPropertyDescriptor(value, "schemaVersion");
  if (
    !descriptor ||
    descriptor.get ||
    descriptor.set ||
    !descriptor.enumerable ||
    typeof descriptor.value !== "string"
  ) {
    invalid();
  }
  return descriptor.value;
}

function exactString(
  value: unknown,
  pattern: RegExp,
  maxBytes: number
): string {
  if (
    typeof value !== "string" ||
    Buffer.byteLength(value, "utf8") > maxBytes ||
    !pattern.test(value)
  ) {
    invalid();
  }
  return value;
}

function exactText(value: unknown, maxBytes: number): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value !== value.trim() ||
    CONTROL.test(value) ||
    Buffer.byteLength(value, "utf8") > maxBytes
  ) {
    invalid();
  }
  return value;
}

function exactTuple(value: unknown): readonly [string, string, string] {
  if (
    !Array.isArray(value) ||
    value.length !== 3 ||
    utilTypes.isProxy(value) ||
    Object.getPrototypeOf(value) !== Array.prototype
  ) {
    invalid();
  }
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== 4 ||
    keys.some(
      (key) =>
        key !== "length" &&
        (typeof key !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(key))
    )
  ) {
    invalid();
  }
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (
      !descriptor ||
      descriptor.get ||
      descriptor.set ||
      !descriptor.enumerable ||
      typeof descriptor.value !== "string"
    ) {
      invalid();
    }
  }
  const result = value.map((entry) =>
    exactString(entry, /^urn:stadtstack:case-event:.+:[123]$/u, 512)
  );
  return [result[0]!, result[1]!, result[2]!];
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function checksum(value: unknown): string {
  return `sha256:${createHash("sha256")
    .update(canonical(value), "utf8")
    .digest("hex")}`;
}

function verifiedCaseFields(record: Record<string, unknown>) {
  if (record.caseVersion !== 3) invalid();
  const caseId = exactString(record.caseId, CASE_ID, 256);
  const caseIdParts = CASE_ID.exec(caseId);
  if (!caseIdParts || !UUID_V7.test(caseIdParts[2]!)) invalid();
  const caseEventIds = exactTuple(record.caseEventIds);
  if (
    caseEventIds.some(
      (eventId, index) =>
        eventId !== `urn:stadtstack:case-event:${caseId}:${index + 1}`
    )
  ) {
    invalid();
  }
  const journalHeadChecksum = exactString(
    record.journalHeadChecksum,
    SHA256,
    71
  );
  const admissionEventChecksum = exactString(
    record.admissionEventChecksum,
    SHA256,
    71
  );
  if (admissionEventChecksum !== journalHeadChecksum) invalid();
  return { caseId, caseEventIds, journalHeadChecksum, admissionEventChecksum };
}

function verifyV1(value: unknown): PublicCaseBindingReceiptV1 {
  const record = exactRecord(value, V1_FIELDS);
  if (
    record.schemaVersion !== "public_case_binding_receipt_v1" ||
    record.authorityBinding !== "none" ||
    record.openDeskWrite !== false
  ) {
    invalid();
  }
  const rootEventId = exactString(record.rootEventId, ROOT_EVENT_ID, 64);
  const topicId = exactString(record.topicId, TOPIC_ID, 256);
  const candidateId = exactString(record.candidateId, DIRECT_CANDIDATE_ID, 128);
  const candidateEventId = exactString(
    record.candidateEventId,
    ROOT_EVENT_ID,
    64
  );
  const sourceAnswerEventId = exactString(
    record.sourceAnswerEventId,
    ROOT_EVENT_ID,
    64
  );
  const caseFields = verifiedCaseFields(record);
  if (
    candidateId !== `urn:stadtstack:signed-topic-suggestion:${candidateEventId}`
  ) {
    invalid();
  }
  const receiptChecksum = exactString(record.receiptChecksum, SHA256, 71);
  const unsigned = {
    schemaVersion: "public_case_binding_receipt_v1" as const,
    rootEventId,
    topicId,
    candidateId,
    candidateEventId,
    sourceAnswerEventId,
    ...caseFields,
    caseVersion: 3 as const,
    authorityBinding: "none" as const,
    openDeskWrite: false as const,
  };
  if (checksum(unsigned) !== receiptChecksum) invalid();
  const frozenEventIds = Object.freeze([
    ...caseFields.caseEventIds,
  ]) as readonly [string, string, string];
  return Object.freeze({
    ...unsigned,
    caseEventIds: frozenEventIds,
    receiptChecksum,
  });
}

function verifyV2(value: unknown): PublicAdoptedCaseBindingReceiptV2 {
  const record = exactRecord(value, V2_FIELDS);
  if (
    record.schemaVersion !== "public_case_binding_receipt_v2" ||
    record.candidateKind !== "eligible_citizen_adopted_topic_suggestion_v1" ||
    record.authorityBinding !== "none" ||
    record.administrativeEndorsement !== false ||
    record.bindingVote !== false ||
    record.councilDecision !== false ||
    record.openDeskWrite !== false ||
    record.treasuryEffect !== false ||
    record.paymentEffect !== false
  ) {
    invalid();
  }
  const rootEventId = exactString(record.rootEventId, ROOT_EVENT_ID, 64);
  const topicId = exactString(record.topicId, TOPIC_ID, 256);
  const candidateId = exactString(
    record.candidateId,
    ADOPTED_CANDIDATE_ID,
    160
  );
  const candidateEventId = exactString(
    record.candidateEventId,
    ROOT_EVENT_ID,
    64
  );
  const participantSuggestionEventId = exactString(
    record.participantSuggestionEventId,
    ROOT_EVENT_ID,
    64
  );
  const adopterPubkey = exactString(record.adopterPubkey, ROOT_EVENT_ID, 64);
  const eligibilityReceiptId = exactString(
    record.eligibilityReceiptId,
    ELIGIBILITY_RECEIPT_ID,
    160
  );
  const eligibilityReceiptChecksum = exactString(
    record.eligibilityReceiptChecksum,
    HEX_SHA256,
    64
  );
  if (
    eligibilityReceiptId !==
    `urn:stadtstack:municipal-civic-eligibility-receipt:${eligibilityReceiptChecksum}`
  ) {
    invalid();
  }
  const eligibilityPolicyVersion = exactText(
    record.eligibilityPolicyVersion,
    256
  );
  const eligibilityIssuer = exactText(record.eligibilityIssuer, 256);
  const adoptionAcceptanceReceiptChecksum = exactString(
    record.adoptionAcceptanceReceiptChecksum,
    HEX_SHA256,
    64
  );
  const sourceAnswerEventId = exactString(
    record.sourceAnswerEventId,
    ROOT_EVENT_ID,
    64
  );
  const sourceAnswerReceiptId = exactString(
    record.sourceAnswerReceiptId,
    MECKY_RECEIPT_ID,
    160
  );
  const caseFields = verifiedCaseFields(record);
  const caseMunicipality = CASE_ID.exec(caseFields.caseId)?.[1];
  const topicMunicipality = TOPIC_ID.exec(topicId)?.[1];
  if (!caseMunicipality || caseMunicipality !== topicMunicipality) invalid();

  const receiptChecksum = exactString(record.receiptChecksum, SHA256, 71);
  const unsigned = {
    schemaVersion: "public_case_binding_receipt_v2" as const,
    rootEventId,
    topicId,
    candidateKind: "eligible_citizen_adopted_topic_suggestion_v1" as const,
    candidateId,
    candidateEventId,
    participantSuggestionEventId,
    adopterPubkey,
    eligibilityReceiptId,
    eligibilityReceiptChecksum,
    eligibilityPolicyVersion,
    eligibilityIssuer,
    adoptionAcceptanceReceiptChecksum,
    sourceAnswerEventId,
    sourceAnswerReceiptId,
    ...caseFields,
    caseVersion: 3 as const,
    authorityBinding: "none" as const,
    administrativeEndorsement: false as const,
    bindingVote: false as const,
    councilDecision: false as const,
    openDeskWrite: false as const,
    treasuryEffect: false as const,
    paymentEffect: false as const,
  };
  if (checksum(unsigned) !== receiptChecksum) invalid();
  const frozenEventIds = Object.freeze([
    ...caseFields.caseEventIds,
  ]) as readonly [string, string, string];
  return Object.freeze({
    ...unsigned,
    caseEventIds: frozenEventIds,
    receiptChecksum,
  });
}

export function verifyPublicCaseBindingReceipt(
  value: unknown
): PublicCaseBindingReceipt {
  const version = schemaVersion(value);
  if (version === "public_case_binding_receipt_v1") return verifyV1(value);
  if (version === "public_case_binding_receipt_v2") return verifyV2(value);
  return invalid();
}

export function isPublicCaseBindingRootEventId(value: string): boolean {
  return ROOT_EVENT_ID.test(value);
}
