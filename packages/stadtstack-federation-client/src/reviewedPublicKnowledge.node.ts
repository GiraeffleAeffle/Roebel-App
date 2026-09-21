/**
 * Shared server-only contract for reviewed public knowledge. The public
 * producer and Mecky consumer validate exactly the same records and checksum.
 * Deliberately excluded from the browser-safe package entry point.
 */
import { createHash } from "node:crypto";

interface PublicEvidenceCommon {
  readonly evidenceId: `sha256:${string}`;
  readonly municipalityId: string;
  readonly title: string;
  readonly summary: string;
  readonly publishedAt: string;
  /** Public retrieval eligibility, not a claim that every source statement is true. */
  readonly admissionState: "admitted" | "pending_review";
  readonly lifecycle: "current" | "stale" | "superseded" | "withdrawn";
}

export interface LocalNewsEvidence extends PublicEvidenceCommon {
  readonly sourceKind: "local_news";
  readonly authority: "editorial_report";
  readonly publisher: string;
  readonly articleUrl: string;
  readonly reviewedAt: string;
}

export interface RatsinformationEvidence extends PublicEvidenceCommon {
  readonly sourceKind: "ratsinformation";
  readonly authority: "official_record";
  readonly body: string;
  readonly recordId: string;
  readonly recordUrl: string;
  readonly reviewedAt: string;
}

/** An attributed recommendation or meeting contribution, never a municipal decision. */
export interface CommunityDocumentEvidence extends Omit<PublicEvidenceCommon, "publishedAt"> {
  readonly sourceKind: "community_document";
  readonly authority: "community_statement";
  readonly publishedAt: string | null;
  readonly attributedTo: string;
  readonly publisher: string;
  readonly documentId: string;
  readonly documentTitle: string;
  readonly documentSha256: `sha256:${string}`;
  readonly documentUrl: string | null;
  readonly pageCount: number;
  readonly sectionId: string;
  /** One-based physical PDF pages; printed numbering can differ. */
  readonly pageStart: number;
  readonly pageEnd: number;
  readonly printedPageLabel: string;
  readonly topicIds: readonly string[];
  /** Public section reader, bound to this evidence version by its publisher. */
  readonly recordUrl: string;
  readonly reviewedAt: string;
}

export const REVIEWED_PUBLIC_KNOWLEDGE_SOURCE_KINDS = [
  "local_news",
  "ratsinformation",
  "community_document",
] as const;

export const REVIEWED_PUBLIC_KNOWLEDGE_SOURCE_SEGMENTS = {
  local_news: "local-news",
  ratsinformation: "ratsinformation",
  community_document: "community-documents",
} as const;

export type ReviewedPublicKnowledgeSourceKind =
  (typeof REVIEWED_PUBLIC_KNOWLEDGE_SOURCE_KINDS)[number];

/** Parse the closed, canonical manifest-to-runtime source declaration. */
export function parseReviewedPublicKnowledgeSourceKinds(
  value: string | undefined,
): readonly ReviewedPublicKnowledgeSourceKind[] {
  if (value === undefined || value === "") return Object.freeze([]);
  if (value !== value.trim()) {
    throw new Error("Reviewed public knowledge source declaration is invalid.");
  }
  const parsed = value.split(",");
  const indexes = parsed.map((kind) =>
    REVIEWED_PUBLIC_KNOWLEDGE_SOURCE_KINDS.indexOf(
      kind as ReviewedPublicKnowledgeSourceKind,
    )
  );
  if (
    parsed.length < 1 || parsed.length > REVIEWED_PUBLIC_KNOWLEDGE_SOURCE_KINDS.length ||
    new Set(parsed).size !== parsed.length || indexes.some((index) => index < 0) ||
    indexes.some((index, position) => position > 0 && index <= indexes[position - 1]!)
  ) {
    throw new Error("Reviewed public knowledge source declaration is invalid.");
  }
  return Object.freeze(parsed as ReviewedPublicKnowledgeSourceKind[]);
}

export type ReviewedPublicKnowledgeRecord =
  | LocalNewsEvidence
  | RatsinformationEvidence
  | CommunityDocumentEvidence;

export interface ReviewedPublicKnowledgeProjectionDraft {
  readonly schemaVersion: "reviewed_public_knowledge_projection_v1";
  readonly municipalityId: string;
  readonly sourceKind: ReviewedPublicKnowledgeSourceKind;
  readonly generatedAt: string;
  readonly records: readonly ReviewedPublicKnowledgeRecord[];
}

export interface ReviewedPublicKnowledgeProjection
  extends ReviewedPublicKnowledgeProjectionDraft {
  readonly contentSha256: `sha256:${string}`;
}

export type ReviewedPublicKnowledgeErrorCode =
  | "configuration"
  | "network"
  | "timeout"
  | "http"
  | "content_type"
  | "too_large"
  | "invalid_json"
  | "invalid_schema"
  | "unsafe_url"
  | "checksum"
  | "contract_mismatch";

export class ReviewedPublicKnowledgeError extends Error {
  constructor(
    readonly code: ReviewedPublicKnowledgeErrorCode,
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = "ReviewedPublicKnowledgeError";
  }
}

const MUNICIPALITY_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const MAX_RECORDS = 100;

function knowledgeError(
  code: ReviewedPublicKnowledgeErrorCode,
  message: string,
  status: number | null = null,
) {
  return new ReviewedPublicKnowledgeError(code, message, status);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype;
}

function exactKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length &&
    actual.every((key, index) => key === expected[index]);
}

function isCanonicalIsoDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const epoch = Date.parse(value);
  return Number.isFinite(epoch) && new Date(epoch).toISOString() === value;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw knowledgeError("invalid_schema", "Projection contains a non-finite number.");
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  if (!isPlainRecord(value)) {
    throw knowledgeError("invalid_schema", "Projection contains an unsupported value.");
  }
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`;
}

function projectionSha256(
  draft: ReviewedPublicKnowledgeProjectionDraft,
): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(canonicalJson(draft), "utf8").digest("hex")}`;
}

/** Stable section identity with a new digest for every content, provenance or lifecycle change. */
export function communityDocumentSectionEvidenceId(
  draft: Omit<CommunityDocumentEvidence, "evidenceId" | "recordUrl">,
): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(canonicalJson(draft), "utf8").digest("hex")}`;
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && Number.isFinite(Date.parse(value));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isPublicHttpsUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.hash;
  } catch {
    return false;
  }
}

function isEvidenceId(value: unknown): value is `sha256:${string}` {
  return typeof value === "string" && /^sha256:[0-9a-f]{64}$/.test(value);
}

function commonIsValid(record: Record<string, unknown>): boolean {
  return isEvidenceId(record.evidenceId) &&
    typeof record.municipalityId === "string" &&
    record.municipalityId.length <= 80 &&
    MUNICIPALITY_ID.test(record.municipalityId) &&
    isNonEmptyString(record.title) &&
    isNonEmptyString(record.summary) &&
    (isIsoDate(record.publishedAt) || (record.sourceKind === "community_document" && record.publishedAt === null)) &&
    (record.admissionState === "admitted" || record.admissionState === "pending_review") &&
    (record.lifecycle === "current" || record.lifecycle === "stale" || record.lifecycle === "superseded" || record.lifecycle === "withdrawn");
}

/** Closed public source record; admission is checked by the projection. */
export function parseReviewedPublicKnowledgeRecord(value: unknown): ReviewedPublicKnowledgeRecord {
  if (!isPlainRecord(value) || !commonIsValid(value)) {
    throw knowledgeError("invalid_schema", "Invalid reviewed public knowledge record.");
  }
  const common = ["evidenceId", "municipalityId", "sourceKind", "authority", "title", "summary", "publishedAt", "admissionState", "lifecycle"];
  if (value.sourceKind === "local_news" &&
      exactKeys(value, [...common, "publisher", "articleUrl", "reviewedAt"]) &&
      value.authority === "editorial_report" && isNonEmptyString(value.publisher) &&
      isPublicHttpsUrl(value.articleUrl) && isIsoDate(value.reviewedAt)) {
    return value as unknown as LocalNewsEvidence;
  }
  if (value.sourceKind === "ratsinformation" &&
      exactKeys(value, [...common, "body", "recordId", "recordUrl", "reviewedAt"]) &&
      value.authority === "official_record" && isNonEmptyString(value.body) &&
      isNonEmptyString(value.recordId) && isPublicHttpsUrl(value.recordUrl) && isIsoDate(value.reviewedAt)) {
    return value as unknown as RatsinformationEvidence;
  }
  const slug = (item: unknown): item is string =>
    typeof item === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(item) && item.length <= 80;
  if (value.sourceKind === "community_document" &&
      exactKeys(value, [...common, "attributedTo", "publisher", "documentId", "documentTitle",
        "documentSha256", "documentUrl", "pageCount", "sectionId", "pageStart", "pageEnd",
        "printedPageLabel", "topicIds", "recordUrl", "reviewedAt"]) &&
      value.authority === "community_statement" &&
      isNonEmptyString(value.attributedTo) && isNonEmptyString(value.publisher) &&
      slug(value.documentId) && slug(value.sectionId) && isNonEmptyString(value.documentTitle) &&
      isEvidenceId(value.documentSha256) && (value.documentUrl === null || isPublicHttpsUrl(value.documentUrl)) &&
      Number.isSafeInteger(value.pageCount) && (value.pageCount as number) >= 1 && (value.pageCount as number) <= 10_000 &&
      Number.isSafeInteger(value.pageStart) && Number.isSafeInteger(value.pageEnd) &&
      (value.pageStart as number) >= 1 && (value.pageEnd as number) >= (value.pageStart as number) &&
      (value.pageEnd as number) <= (value.pageCount as number) &&
      isNonEmptyString(value.printedPageLabel) && value.printedPageLabel.length <= 80 &&
      Array.isArray(value.topicIds) && value.topicIds.length <= 16 &&
      new Set(value.topicIds).size === value.topicIds.length &&
      value.topicIds.every((topic) => typeof topic === "string" && topic.length <= 240 &&
        topic.split(":").length === 6 &&
        topic.startsWith(`urn:stadtstack:topic:municipality:${value.municipalityId}:`) &&
        /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(topic.split(":").at(-1)!)) &&
      isPublicHttpsUrl(value.recordUrl) && isIsoDate(value.reviewedAt)) {
    const record = value as unknown as CommunityDocumentEvidence;
    const { evidenceId, recordUrl: _url, ...draft } = record;
    if (communityDocumentSectionEvidenceId(draft) !== evidenceId) {
      throw knowledgeError("checksum", "Document section content does not match its evidence version.");
    }
    const versions = new URL(record.recordUrl).searchParams.getAll("version");
    if (versions.length !== 1 || versions[0] !== evidenceId.slice(7)) {
      throw knowledgeError("contract_mismatch", "Document citation must identify the exact section version.");
    }
    return record;
  }
  throw knowledgeError("invalid_schema", "Invalid reviewed public knowledge record.");
}

function validateDraft(
  value: unknown,
  maxRecords: number,
): ReviewedPublicKnowledgeProjectionDraft {
  if (!isPlainRecord(value) || !exactKeys(value, [
    "schemaVersion",
    "municipalityId",
    "sourceKind",
    "generatedAt",
    "records",
  ]) || value.schemaVersion !== "reviewed_public_knowledge_projection_v1" ||
    typeof value.municipalityId !== "string" || value.municipalityId.length > 80 ||
    !MUNICIPALITY_ID.test(value.municipalityId) ||
    !REVIEWED_PUBLIC_KNOWLEDGE_SOURCE_KINDS.includes(
      value.sourceKind as ReviewedPublicKnowledgeSourceKind,
    ) || !isCanonicalIsoDate(value.generatedAt) || !Array.isArray(value.records) ||
    value.records.length > maxRecords) {
    throw knowledgeError("invalid_schema", "Reviewed knowledge projection has an invalid envelope.");
  }

  const generatedAt = Date.parse(value.generatedAt);
  const seenEvidence = new Set<string>();
  const seenSourceRecords = new Set<string>();
  const documents = new Map<string, string>();
  const records = value.records.map((recordValue) => {
    const record = parseReviewedPublicKnowledgeRecord(recordValue);
    if (record.sourceKind !== value.sourceKind ||
      record.municipalityId !== value.municipalityId ||
      record.admissionState !== "admitted" ||
      (record.publishedAt !== null && !isCanonicalIsoDate(record.publishedAt)) || !isCanonicalIsoDate(record.reviewedAt) ||
      (record.publishedAt !== null && Date.parse(record.publishedAt) > Date.parse(record.reviewedAt)) ||
      Date.parse(record.reviewedAt) > generatedAt) {
      throw knowledgeError(
        "contract_mismatch",
        "Reviewed knowledge record escaped its source, municipality, admission, or review boundary.",
      );
    }
    const sourceIdentity = record.sourceKind === "local_news"
      ? record.articleUrl
      : record.sourceKind === "ratsinformation" ? record.recordId
      : `${record.documentId}/${record.sectionId}`;
    if (seenEvidence.has(record.evidenceId) || seenSourceRecords.has(sourceIdentity)) {
      throw knowledgeError("contract_mismatch", "Reviewed knowledge projection contains a duplicate record.");
    }
    seenEvidence.add(record.evidenceId);
    seenSourceRecords.add(sourceIdentity);
    if (record.sourceKind === "community_document") {
      const identity = canonicalJson([record.documentTitle, record.documentSha256, record.documentUrl,
        record.publisher, record.pageCount, record.publishedAt]);
      if (documents.has(record.documentId) && documents.get(record.documentId) !== identity) {
        throw knowledgeError("contract_mismatch", "Document sections disagree on their source version.");
      }
      documents.set(record.documentId, identity);
      return Object.freeze({ ...record, topicIds: Object.freeze([...record.topicIds]) });
    }
    return Object.freeze({ ...record }) as ReviewedPublicKnowledgeRecord;
  });

  return {
    schemaVersion: "reviewed_public_knowledge_projection_v1",
    municipalityId: value.municipalityId,
    sourceKind: value.sourceKind as ReviewedPublicKnowledgeSourceKind,
    generatedAt: value.generatedAt,
    records: Object.freeze(records),
  };
}

/** Producer helper: validate first, then seal the exact canonical projection. */
export function sealReviewedPublicKnowledgeProjection(
  draft: ReviewedPublicKnowledgeProjectionDraft,
): ReviewedPublicKnowledgeProjection {
  const parsed = validateDraft(draft, MAX_RECORDS);
  return Object.freeze({
    ...parsed,
    contentSha256: projectionSha256(parsed),
  });
}

export function parseReviewedPublicKnowledgeProjection(
  value: unknown,
  expectedMunicipalityId: string,
  expectedSourceKind: ReviewedPublicKnowledgeSourceKind,
  queryNow: string,
  maxRecords = 50,
): ReviewedPublicKnowledgeProjection {
  if (!isCanonicalIsoDate(queryNow) || !Number.isSafeInteger(maxRecords) ||
    maxRecords < 1 || maxRecords > MAX_RECORDS ||
    !isPlainRecord(value) || !exactKeys(value, [
    "schemaVersion",
    "municipalityId",
    "sourceKind",
    "generatedAt",
    "records",
    "contentSha256",
  ]) || typeof value.contentSha256 !== "string" || !SHA256.test(value.contentSha256)) {
    throw knowledgeError("invalid_schema", "Reviewed knowledge response has an invalid envelope.");
  }
  const { contentSha256, ...draftValue } = value;
  const parsed = validateDraft(draftValue, maxRecords);
  if (parsed.municipalityId !== expectedMunicipalityId || parsed.sourceKind !== expectedSourceKind ||
    Date.parse(parsed.generatedAt) > Date.parse(queryNow)) {
    throw knowledgeError(
      "contract_mismatch",
      "Reviewed knowledge response does not match the requested source snapshot.",
    );
  }
  if (projectionSha256(parsed) !== contentSha256) {
    throw knowledgeError("checksum", "Reviewed knowledge projection checksum verification failed.");
  }
  return Object.freeze({ ...parsed, contentSha256: contentSha256 as `sha256:${string}` });
}
