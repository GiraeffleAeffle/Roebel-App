import {
  REVIEWED_PUBLIC_KNOWLEDGE_SOURCE_KINDS,
  ReviewedPublicKnowledgeError,
  parseReviewedPublicKnowledgeProjection,
  type ReviewedPublicKnowledgeErrorCode,
  type ReviewedPublicKnowledgeRecord,
  type ReviewedPublicKnowledgeSourceKind,
} from "@roebel/stadtstack-federation-client/reviewed-public-knowledge";
import type { PublicEvidenceQuery, PublicEvidenceSourceAdapter } from "./public-evidence";

export {
  REVIEWED_PUBLIC_KNOWLEDGE_SOURCE_KINDS,
  ReviewedPublicKnowledgeError,
  parseReviewedPublicKnowledgeSourceKinds,
  sealReviewedPublicKnowledgeProjection,
  type ReviewedPublicKnowledgeErrorCode,
  type ReviewedPublicKnowledgeProjection,
  type ReviewedPublicKnowledgeProjectionDraft,
  type ReviewedPublicKnowledgeRecord,
  type ReviewedPublicKnowledgeSourceKind,
} from "@roebel/stadtstack-federation-client/reviewed-public-knowledge";

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

function knowledgeError(
  code: ReviewedPublicKnowledgeErrorCode,
  message: string,
  status: number | null = null,
) {
  return new ReviewedPublicKnowledgeError(code, message, status);
}

function isCanonicalIsoDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const epoch = Date.parse(value);
  return Number.isFinite(epoch) && new Date(epoch).toISOString() === value;
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
      return parseReviewedPublicKnowledgeProjection(
        value,
        municipalityId,
        options.sourceKind,
        query.now,
        maxRecords,
      ).records;
    },
  });
}
