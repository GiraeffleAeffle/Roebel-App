import {
  civicCaseStageSnapshotSchema,
  civicFederationCaseIndexSchema,
  civicFederationCaseManifestSchema,
  type CivicCaseStageSnapshotV1,
  type CivicFederationCaseManifestV1,
  type CivicFederationCaseSummaryV1,
} from "./contracts";

export type StadtstackFederationErrorCode =
  | "configuration"
  | "network"
  | "timeout"
  | "not_found"
  | "withdrawn"
  | "http"
  | "content_type"
  | "too_large"
  | "invalid_json"
  | "invalid_schema"
  | "unsafe_url"
  | "checksum"
  | "contract_mismatch";

export class StadtstackFederationError extends Error {
  constructor(
    readonly code: StadtstackFederationErrorCode,
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = "StadtstackFederationError";
  }
}

export interface StadtstackFederationClientOptions {
  baseUrl: string;
  municipalityId?: string;
  timeoutMs?: number;
  maxResponseBytes?: number;
  maxCases?: number;
  fetch?: typeof globalThis.fetch;
}

export interface ReviewedCivicCase {
  summary: Omit<
    CivicFederationCaseSummaryV1,
    "manifestUrl" | "stageMapUrl" | "publicCaseUrl"
  > & {
    manifestUrl: string;
    stageMapUrl: string;
    publicCaseUrl: string;
  };
  manifest: CivicFederationCaseManifestV1;
  stageMap: CivicCaseStageSnapshotV1;
}

export interface ReviewedCivicCasesResult {
  municipality: {
    id: string;
    name: string;
    state: string;
    country: string;
  };
  generatedAt: string;
  cases: ReviewedCivicCase[];
}

const DEFAULT_MUNICIPALITY_ID = "roebel-mueritz";
const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_RESPONSE_BYTES = 512_000;
const DEFAULT_MAX_CASES = 25;

function federationError(
  code: StadtstackFederationErrorCode,
  message: string,
  status: number | null = null,
) {
  return new StadtstackFederationError(code, message, status);
}

function providerOrigin(value: string): URL {
  try {
    const url = new URL(value.trim());
    const localHttp =
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname);
    if (
      (url.protocol !== "https:" && !localHttp) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.pathname !== "/" && url.pathname !== "")
    ) {
      throw new Error("unsafe provider origin");
    }
    url.pathname = "/";
    return url;
  } catch {
    throw federationError(
      "configuration",
      "Stadtstack baseUrl must be an HTTPS origin (or localhost HTTP in development).",
    );
  }
}

function expectedCasePath(municipalityId: string, slug: string) {
  return `/api/federation/v1/municipalities/${encodeURIComponent(
    municipalityId,
  )}/cases/${encodeURIComponent(slug)}`;
}

function exactProviderUrl(reference: string, provider: URL, expectedPath: string): URL {
  let resolved: URL;
  try {
    resolved = new URL(reference, provider);
  } catch {
    throw federationError("unsafe_url", "Federation response contains an invalid URL.");
  }
  if (
    resolved.origin !== provider.origin ||
    resolved.protocol !== provider.protocol ||
    resolved.username ||
    resolved.password ||
    resolved.search ||
    resolved.hash ||
    resolved.pathname !== expectedPath
  ) {
    throw federationError(
      "unsafe_url",
      "Federation URL escaped its configured provider path.",
    );
  }
  return resolved;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw federationError("invalid_schema", "Non-finite number.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  if (!value || typeof value !== "object") {
    throw federationError("invalid_schema", "Unsupported canonical JSON value.");
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

function stableStageProjection(snapshot: CivicCaseStageSnapshotV1) {
  const { derivedAt: _derivedAt, ...stable } = snapshot;
  return stable;
}

async function stageMapSha256(snapshot: CivicCaseStageSnapshotV1): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw federationError(
      "configuration",
      "This browser cannot verify Stadtstack SHA-256 checksums.",
    );
  }
  const bytes = new TextEncoder().encode(canonicalJson(stableStageProjection(snapshot)));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `sha256:${hex}`;
}

async function readLimitedBody(response: Response, maxBytes: number): Promise<string> {
  const declaredRaw = response.headers.get("content-length");
  if (declaredRaw !== null) {
    const declared = Number(declaredRaw);
    if (!Number.isSafeInteger(declared) || declared < 0 || declared > maxBytes) {
      throw federationError("too_large", "Federation response exceeds its size limit.");
    }
  }
  if (!response.body) {
    throw federationError("invalid_json", "Federation response has no body.");
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
        throw federationError("too_large", "Federation response exceeds its size limit.");
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
    throw federationError("invalid_json", "Federation response is not valid UTF-8.");
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
      reject(federationError("timeout", "Stadtstack request timed out."));
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
      throw federationError("unsafe_url", "Federation redirects are not accepted.");
    }
    if (response.status === 404) {
      throw federationError("not_found", "Reviewed federation resource was not found.", 404);
    }
    if (response.status === 410) {
      // v0.1 deliberately does not trust or render a 410 body. Retraction
      // notice verification is a separate additive contract; until it is
      // implemented, all formerly cached case content stays hidden.
      throw federationError("withdrawn", "Reviewed federation resource was withdrawn.", 410);
    }
    if (!response.ok) {
      throw federationError("http", `Federation returned HTTP ${response.status}.`, response.status);
    }
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (!contentType.includes("application/json")) {
      throw federationError("content_type", "Federation response is not JSON.");
    }
    const body = await readLimitedBody(response, maxBytes);
    try {
      return JSON.parse(body) as unknown;
    } catch {
      throw federationError("invalid_json", "Federation response contains invalid JSON.");
    }
  };

  try {
    return await Promise.race([requestAndRead(), timeout]);
  } catch (error) {
    if (error instanceof StadtstackFederationError) throw error;
    throw federationError(
      timedOut ? "timeout" : "network",
      timedOut ? "Stadtstack request timed out." : "Stadtstack is unavailable.",
    );
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

function parseIndex(value: unknown) {
  const parsed = civicFederationCaseIndexSchema.safeParse(value);
  if (!parsed.success) {
    throw federationError("invalid_schema", "Case index does not match the pinned v1 schema.");
  }
  return parsed.data;
}

function parseManifest(value: unknown) {
  const parsed = civicFederationCaseManifestSchema.safeParse(value);
  if (!parsed.success) {
    throw federationError("invalid_schema", "Case manifest does not match the pinned v1 schema.");
  }
  return parsed.data;
}

function parseStageMap(value: unknown) {
  const parsed = civicCaseStageSnapshotSchema.safeParse(value);
  if (!parsed.success) {
    throw federationError("invalid_schema", "Stage map does not match the pinned v1 schema.");
  }
  return parsed.data;
}

async function readCase(
  summary: CivicFederationCaseSummaryV1,
  municipality: ReviewedCivicCasesResult["municipality"],
  provider: URL,
  fetcher: typeof globalThis.fetch,
  timeoutMs: number,
  maxBytes: number,
): Promise<ReviewedCivicCase> {
  const municipalityId = municipality.id;
  const casePath = expectedCasePath(municipalityId, summary.decisionCaseSlug);
  const manifestUrl = exactProviderUrl(
    summary.manifestUrl,
    provider,
    `${casePath}/manifest`,
  );
  const stageMapUrl = exactProviderUrl(
    summary.stageMapUrl,
    provider,
    `${casePath}/stage-map`,
  );
  const publicCaseUrl = exactProviderUrl(
    summary.publicCaseUrl,
    provider,
    `/kommunen/${encodeURIComponent(municipalityId)}/entscheidungen/${encodeURIComponent(
      summary.decisionCaseSlug,
    )}`,
  );

  const [manifestValue, stageMapValue] = await Promise.all([
    fetchJson(manifestUrl, fetcher, timeoutMs, maxBytes),
    fetchJson(stageMapUrl, fetcher, timeoutMs, maxBytes),
  ]);
  const manifest = parseManifest(manifestValue);
  const stageMap = parseStageMap(stageMapValue);

  exactProviderUrl(manifest.stageMap.url, provider, `${casePath}/stage-map`);
  exactProviderUrl(manifest.publicCaseUrl, provider, publicCaseUrl.pathname);
  manifest.artifacts.forEach((artifact) => {
    exactProviderUrl(
      artifact.url,
      provider,
      `/api/federation/v1/municipalities/${encodeURIComponent(
        municipalityId,
      )}/artifacts/${encodeURIComponent(artifact.artifactId)}/${artifact.artifactVersion}`,
    );
  });

  const stableFetched = canonicalJson(stableStageProjection(stageMap));
  const stableEmbedded = canonicalJson(stableStageProjection(manifest.stageMap.snapshot));
  const contentSha256 = await stageMapSha256(stageMap);
  const contractMatches =
    canonicalJson(manifest.municipality) === canonicalJson(municipality) &&
    manifest.decisionCaseSlug === summary.decisionCaseSlug &&
    stageMap.caseKey.municipalityId === municipalityId &&
    stageMap.caseKey.decisionCaseSlug === summary.decisionCaseSlug &&
    summary.truthState === "reviewed" &&
    stageMap.truthState === "reviewed" &&
    stageMap.participationAuthorityState === summary.participationAuthorityState &&
    canonicalJson(stageMap.current) === canonicalJson(summary.currentStage) &&
    stableFetched === stableEmbedded;
  if (!contractMatches) {
    throw federationError(
      "contract_mismatch",
      "Case index, manifest and stage map do not describe the same reviewed case.",
    );
  }
  if (contentSha256 !== manifest.stageMap.contentSha256) {
    throw federationError("checksum", "Stage map checksum verification failed.");
  }

  return {
    summary: {
      ...summary,
      manifestUrl: manifestUrl.toString(),
      stageMapUrl: stageMapUrl.toString(),
      publicCaseUrl: publicCaseUrl.toString(),
    },
    manifest,
    stageMap,
  };
}

/**
 * Loads reviewed public cases only. A valid `200` index with `cases: []` is
 * returned as an honest empty list; missing, withdrawn or invalid resources
 * are errors and never use cached or synthetic fallback content.
 */
export async function loadReviewedCivicCases(
  options: StadtstackFederationClientOptions,
): Promise<ReviewedCivicCasesResult> {
  const provider = providerOrigin(options.baseUrl);
  const municipalityId = options.municipalityId ?? DEFAULT_MUNICIPALITY_ID;
  if (!/^[a-z0-9][a-z0-9-]{0,119}$/.test(municipalityId)) {
    throw federationError("configuration", "Invalid municipality id.");
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  const maxCases = options.maxCases ?? DEFAULT_MAX_CASES;
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 100 ||
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1_024 ||
    !Number.isSafeInteger(maxCases) ||
    maxCases < 1
  ) {
    throw federationError("configuration", "Invalid federation client limits.");
  }
  const fetcher = options.fetch ?? globalThis.fetch;
  if (typeof fetcher !== "function") {
    throw federationError("configuration", "Fetch is unavailable in this browser.");
  }
  const indexPath = `/api/federation/v1/municipalities/${encodeURIComponent(
    municipalityId,
  )}/cases`;
  const indexUrl = exactProviderUrl(indexPath, provider, indexPath);
  const index = parseIndex(await fetchJson(indexUrl, fetcher, timeoutMs, maxBytes));
  if (
    index.municipality.id !== municipalityId ||
    index.cases.some((entry) => entry.truthState !== "reviewed")
  ) {
    throw federationError(
      "contract_mismatch",
      "Case index contains a different municipality or an unreviewed case.",
    );
  }
  if (index.cases.length > maxCases) {
    throw federationError("too_large", "Case index contains too many cases.");
  }

  const cases: ReviewedCivicCase[] = [];
  for (const summary of index.cases) {
    cases.push(
      await readCase(
        summary,
        index.municipality,
        provider,
        fetcher,
        timeoutMs,
        maxBytes,
      ),
    );
  }
  return { municipality: index.municipality, generatedAt: index.generatedAt, cases };
}
