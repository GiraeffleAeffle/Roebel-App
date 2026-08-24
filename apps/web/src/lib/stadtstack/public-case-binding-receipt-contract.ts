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

const ROOT_EVENT_ID = /^[0-9a-f]{64}$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const MUNICIPALITY = /[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?/u;
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const CASE_ID = new RegExp(`^urn:stadtstack:case:municipality:(${MUNICIPALITY.source}):([0-9a-f-]{36})$`, "u");
const TOPIC_ID = /^urn:stadtstack:topic:municipality:[a-z0-9-]+:[a-z0-9-]+$/u;
const CANDIDATE_ID = /^urn:stadtstack:signed-topic-suggestion:[0-9a-f]{64}$/u;

function invalid(): never { throw new Error("public_case_binding_receipt_invalid"); }
function exactRecord(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
    utilTypes.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype) invalid();
  const record = value as Record<string, unknown>;
  const keys = Reflect.ownKeys(record);
  if (keys.length !== fields.length || keys.some((key) => typeof key !== "string" || !fields.includes(key))) invalid();
  for (const field of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(record, field);
    if (!descriptor || descriptor.get || descriptor.set || !descriptor.enumerable) invalid();
  }
  return record;
}
function exactString(value: unknown, pattern: RegExp, maxBytes: number): string {
  if (typeof value !== "string" || Buffer.byteLength(value, "utf8") > maxBytes || !pattern.test(value)) invalid();
  return value;
}
function exactTuple(value: unknown): readonly [string, string, string] {
  if (!Array.isArray(value) || value.length !== 3 || utilTypes.isProxy(value) ||
    Object.getPrototypeOf(value) !== Array.prototype) invalid();
  const keys = Reflect.ownKeys(value);
  if (keys.length !== 4 || keys.some((key) => key !== "length" &&
    (typeof key !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(key)))) invalid();
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || descriptor.get || descriptor.set || !descriptor.enumerable ||
      typeof descriptor.value !== "string") invalid();
  }
  const result = value.map((entry) => exactString(entry, /^urn:stadtstack:case-event:.+:[123]$/u, 512));
  return [result[0]!, result[1]!, result[2]!];
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
function checksum(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonical(value), "utf8").digest("hex")}`;
}

export function verifyPublicCaseBindingReceipt(value: unknown): PublicCaseBindingReceiptV1 {
  const record = exactRecord(value, [
    "schemaVersion", "rootEventId", "topicId", "candidateId", "candidateEventId",
    "sourceAnswerEventId", "caseId", "caseVersion", "caseEventIds", "journalHeadChecksum",
    "admissionEventChecksum", "receiptChecksum", "authorityBinding", "openDeskWrite",
  ]);
  if (record.schemaVersion !== "public_case_binding_receipt_v1" || record.caseVersion !== 3 ||
    record.authorityBinding !== "none" || record.openDeskWrite !== false) invalid();
  const rootEventId = exactString(record.rootEventId, ROOT_EVENT_ID, 64);
  const topicId = exactString(record.topicId, TOPIC_ID, 256);
  const candidateId = exactString(record.candidateId, CANDIDATE_ID, 128);
  const candidateEventId = exactString(record.candidateEventId, ROOT_EVENT_ID, 64);
  const sourceAnswerEventId = exactString(record.sourceAnswerEventId, ROOT_EVENT_ID, 64);
  const caseId = exactString(record.caseId, CASE_ID, 256);
  const caseIdParts = CASE_ID.exec(caseId);
  if (!caseIdParts || !UUID_V7.test(caseIdParts[2]!)) invalid();
  const caseEventIds = exactTuple(record.caseEventIds);
  if (caseEventIds.some((eventId, index) => eventId !== `urn:stadtstack:case-event:${caseId}:${index + 1}`) ||
    candidateId !== `urn:stadtstack:signed-topic-suggestion:${candidateEventId}`) invalid();
  const journalHeadChecksum = exactString(record.journalHeadChecksum, SHA256, 71);
  const admissionEventChecksum = exactString(record.admissionEventChecksum, SHA256, 71);
  const receiptChecksum = exactString(record.receiptChecksum, SHA256, 71);
  if (admissionEventChecksum !== journalHeadChecksum) invalid();
  const unsigned = {
    schemaVersion: "public_case_binding_receipt_v1" as const, rootEventId, topicId, candidateId,
    candidateEventId, sourceAnswerEventId, caseId, caseVersion: 3 as const, caseEventIds,
    journalHeadChecksum, admissionEventChecksum, authorityBinding: "none" as const,
    openDeskWrite: false as const,
  };
  if (checksum(unsigned) !== receiptChecksum) invalid();
  const frozenEventIds = Object.freeze([...caseEventIds]) as readonly [string, string, string];
  return Object.freeze({ ...unsigned, caseEventIds: frozenEventIds, receiptChecksum });
}

export function isPublicCaseBindingRootEventId(value: string): boolean {
  return ROOT_EVENT_ID.test(value);
}
