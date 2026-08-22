import { createHash } from "node:crypto";
import {
  parsePublicEvidence,
  type LocalNewsEvidence,
  type PublicEvidenceQuery,
  type PublicEvidenceSourceAdapter,
  type RatsinformationEvidence,
} from "./public-evidence";

/**
 * Consumer contract for source-specific, human-reviewed public projections.
 *
 * The answer path never crawls a publisher or council system. Stadtstack (or
 * another reviewed producer) publishes this closed projection; Röbel verifies
 * the whole response before admitting any record into the retrieval catalog.
 */

export const REVIEWED_PUBLIC_KNOWLEDGE_SOURCE_KINDS = [
  "local_news",
  "ratsinformation",
] as const;

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
  | RatsinformationEvidence;

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

export interface ReviewedPublicKnowledgeAdapterOptions {
  readonly baseUrl: string;
  readonly sourceKind: ReviewedPublicKnowledgeSourceKind;
  readonly allowClusterInternalHttp?: boolean;
  readonly timeoutMs?: number;
  readonly maxResponseBytes?: number;
  readonly maxRecords?: number;
  readonly fetch?: typeof globalThis.fetch;
}

const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_RESPONSE_BYTES = 512_000;
const DEFAULT_MAX_RECORDS = 50;
const MAX_RECORDS = 100;
const MUNICIPALITY_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;

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

function projectionPath(
  municipalityId: string,
  sourceKind: ReviewedPublicKnowledgeSourceKind,
): string {
  const sourceSegment = sourceKind === "local_news" ? "local-news" : "ratsinformation";
  return `/api/federation/v1/municipalities/${encodeURIComponent(
    municipalityId,
  )}/public-knowledge/${sourceSegment}`;
}

function providerOrigin(value: string, allowClusterInternalHttp = false): URL {
  try {
    const url = new URL(value.trim());
    const localHttp = url.protocol === "http:" &&
      ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname);
    const clusterInternalHttp = allowClusterInternalHttp && url.protocol === "http:" &&
      /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.svc\.cluster\.local$/u.test(url.hostname);
    if (
      (url.protocol !== "https:" && !localHttp && !clusterInternalHttp) ||
      url.username || url.password || url.search || url.hash ||
      (url.pathname !== "/" && url.pathname !== "")
    ) {
      throw new Error("unsafe provider origin");
    }
    url.pathname = "/";
    return url;
  } catch {
    throw knowledgeError(
      "configuration",
      "Reviewed knowledge baseUrl must be HTTPS, localhost HTTP, or an explicitly allowed cluster Service origin.",
    );
  }
}

function exactProviderUrl(provider: URL, expectedPath: string): URL {
  const resolved = new URL(expectedPath, provider);
  if (
    resolved.origin !== provider.origin || resolved.protocol !== provider.protocol ||
    resolved.username || resolved.password || resolved.search || resolved.hash ||
    resolved.pathname !== expectedPath
  ) {
    throw knowledgeError("unsafe_url", "Reviewed knowledge URL escaped its configured provider path.");
  }
  return resolved;
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
  const records = value.records.map((recordValue) => {
    const record = parsePublicEvidence(recordValue);
    if (record.sourceKind !== value.sourceKind ||
      (record.sourceKind !== "local_news" && record.sourceKind !== "ratsinformation") ||
      record.municipalityId !== value.municipalityId ||
      record.admissionState !== "admitted" ||
      !isCanonicalIsoDate(record.publishedAt) || !isCanonicalIsoDate(record.reviewedAt) ||
      Date.parse(record.publishedAt) > Date.parse(record.reviewedAt) ||
      Date.parse(record.reviewedAt) > generatedAt) {
      throw knowledgeError(
        "contract_mismatch",
        "Reviewed knowledge record escaped its source, municipality, admission, or review boundary.",
      );
    }
    const sourceIdentity = record.sourceKind === "local_news"
      ? record.articleUrl
      : record.recordId;
    if (seenEvidence.has(record.evidenceId) || seenSourceRecords.has(sourceIdentity)) {
      throw knowledgeError("contract_mismatch", "Reviewed knowledge projection contains a duplicate record.");
    }
    seenEvidence.add(record.evidenceId);
    seenSourceRecords.add(sourceIdentity);
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

function parseProjection(
  value: unknown,
  expectedMunicipalityId: string,
  expectedSourceKind: ReviewedPublicKnowledgeSourceKind,
  queryNow: string,
  maxRecords: number,
): ReviewedPublicKnowledgeProjection {
  if (!isPlainRecord(value) || !exactKeys(value, [
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

async function readLimitedBody(response: Response, maxBytes: number): Promise<string> {
  const declaredRaw = response.headers.get("content-length");
  if (declaredRaw !== null) {
    const declared = Number(declaredRaw);
    if (!Number.isSafeInteger(declared) || declared < 0 || declared > maxBytes) {
      throw knowledgeError("too_large", "Reviewed knowledge response exceeds its size limit.");
    }
  }
  if (!response.body) {
    throw knowledgeError("invalid_json", "Reviewed knowledge response has no body.");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw knowledgeError("too_large", "Reviewed knowledge response exceeds its size limit.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw knowledgeError("invalid_json", "Reviewed knowledge response is not valid UTF-8.");
  }
}

async function fetchJson(
  url: URL,
  fetcher: typeof globalThis.fetch,
  timeoutMs: number,
  maxBytes: number,
): Promise<unknown> {
  const controller = new AbortController();
  let timedOut = false;
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(knowledgeError("timeout", "Reviewed knowledge request timed out."));
    }, timeoutMs);
  });
  const requestAndRead = async () => {
    const response = await fetcher(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      credentials: "omit",
      redirect: "error",
      cache: "no-store",
      referrerPolicy: "no-referrer",
      signal: controller.signal,
    });
    if (response.redirected) {
      throw knowledgeError("unsafe_url", "Reviewed knowledge redirects are not accepted.");
    }
    if (!response.ok) {
      throw knowledgeError("http", `Reviewed knowledge returned HTTP ${response.status}.`, response.status);
    }
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (!contentType.includes("application/json")) {
      throw knowledgeError("content_type", "Reviewed knowledge response is not JSON.");
    }
    const body = await readLimitedBody(response, maxBytes);
    try {
      return JSON.parse(body) as unknown;
    } catch {
      throw knowledgeError("invalid_json", "Reviewed knowledge response contains invalid JSON.");
    }
  };
  try {
    return await Promise.race([requestAndRead(), timeout]);
  } catch (error) {
    if (error instanceof ReviewedPublicKnowledgeError) throw error;
    throw knowledgeError(
      timedOut ? "timeout" : "network",
      timedOut ? "Reviewed knowledge request timed out." : "Reviewed knowledge source is unavailable.",
    );
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

/**
 * Builds one source-specific GET-only adapter. Compose separate news and RIS
 * adapters with `createPublicKnowledgeCatalog` so one outage cannot admit
 * partial or cross-authority data from the other source.
 */
export function createReviewedPublicKnowledgeSourceAdapter(
  options: ReviewedPublicKnowledgeAdapterOptions,
): PublicEvidenceSourceAdapter {
  if (options.allowClusterInternalHttp !== undefined &&
    typeof options.allowClusterInternalHttp !== "boolean") {
    throw knowledgeError("configuration", "Invalid cluster-internal HTTP option.");
  }
  if (!REVIEWED_PUBLIC_KNOWLEDGE_SOURCE_KINDS.includes(options.sourceKind)) {
    throw knowledgeError("configuration", "Invalid reviewed knowledge source kind.");
  }
  const provider = providerOrigin(options.baseUrl, options.allowClusterInternalHttp === true);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  const maxRecords = options.maxRecords ?? DEFAULT_MAX_RECORDS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30_000 ||
    !Number.isSafeInteger(maxResponseBytes) || maxResponseBytes < 1_024 ||
    maxResponseBytes > 2_000_000 || !Number.isSafeInteger(maxRecords) ||
    maxRecords < 1 || maxRecords > MAX_RECORDS) {
    throw knowledgeError("configuration", "Invalid reviewed knowledge client limits.");
  }
  const fetcher = options.fetch ?? globalThis.fetch;
  if (typeof fetcher !== "function") {
    throw knowledgeError("configuration", "Fetch is unavailable.");
  }

  return Object.freeze({
    sourceKind: options.sourceKind,
    async load(query: PublicEvidenceQuery): Promise<readonly ReviewedPublicKnowledgeRecord[]> {
      const municipalityId = query.municipalityId;
      if (!MUNICIPALITY_ID.test(municipalityId) || municipalityId.length > 80 ||
        !isCanonicalIsoDate(query.now)) {
        throw knowledgeError("configuration", "Invalid reviewed knowledge query scope.");
      }
      const path = projectionPath(municipalityId, options.sourceKind);
      const url = exactProviderUrl(provider, path);
      const value = await fetchJson(url, fetcher, timeoutMs, maxResponseBytes);
      return parseProjection(
        value,
        municipalityId,
        options.sourceKind,
        query.now,
        maxRecords,
      ).records;
    },
  });
}
