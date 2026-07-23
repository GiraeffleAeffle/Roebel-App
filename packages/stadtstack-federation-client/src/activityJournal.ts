import {
  CIVIC_ACTIVITY_JOURNAL_MAX_PAGE_SIZE,
  civicActivityJournalCorrelationIdSchema,
  civicActivityJournalActionTimelineSchema,
  civicActivityJournalCapabilitiesSchema,
  civicActivityJournalCursorSchema,
  civicActivityJournalEventIdSchema,
  civicActivityJournalEventListSchema,
  civicActivityJournalEventSchema,
  type CivicActivityJournalActionTimelineV1,
  type CivicActivityJournalCapabilitiesV1,
  type CivicActivityJournalEventListV1,
  type CivicActivityJournalEventV1,
  type CivicActivityJournalSegmentSealV1,
  type CivicActivityJournalScopeV1,
} from "./activityJournalContracts";
import {
  StadtstackFederationError,
  type StadtstackFederationClientOptions,
} from "./client";

const JOURNAL_PATH = "/api/demo/roebel-marienfelder/activity-journal";
const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RESPONSE_BYTES = 192_000;
const HARD_MAX_RESPONSE_BYTES = 262_144;
const DEFAULT_PAGE_SIZE = 8;

const REQUIRED_DEMO_HEADERS = {
  "x-stadtstack-truth-state": "demo",
  "x-stadtstack-authority": "none",
  "x-stadtstack-demo-scenario": "walkthrough",
  "x-stadtstack-visibility": "public_reviewed",
  "x-stadtstack-historical-evidence": "true",
  "x-stadtstack-current-state-verified": "false",
  "x-stadtstack-backfilled": "true",
} as const;

export interface CivicActivityJournalClientOptions
  extends Omit<
    StadtstackFederationClientOptions,
    "municipalityId" | "maxCases"
  > {}

export interface CivicActivityJournalListOptions
  extends CivicActivityJournalClientOptions {
  limit?: number;
  cursor?: string;
}

export interface CivicActivityJournalDemoResult {
  capabilities: CivicActivityJournalCapabilitiesV1;
  eventList: CivicActivityJournalEventListV1;
}

function fail(
  code: ConstructorParameters<typeof StadtstackFederationError>[0],
  message: string,
  status: number | null = null,
): never {
  throw new StadtstackFederationError(code, message, status);
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
    fail(
      "configuration",
      "Stadtstack baseUrl must be an HTTPS origin (or localhost HTTP in development).",
    );
  }
}

function readLimits(options: CivicActivityJournalClientOptions) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxResponseBytes =
    options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 100 ||
    timeoutMs > MAX_TIMEOUT_MS ||
    !Number.isSafeInteger(maxResponseBytes) ||
    maxResponseBytes < 1_024 ||
    maxResponseBytes > HARD_MAX_RESPONSE_BYTES
  ) {
    fail("configuration", "Invalid bounded Activity Journal client limits.");
  }
  const fetcher = options.fetch ?? globalThis.fetch;
  if (typeof fetcher !== "function") {
    fail("configuration", "Fetch is unavailable in this browser.");
  }
  return { timeoutMs, maxResponseBytes, fetcher };
}

function exactJournalUrl(
  provider: URL,
  path: string,
  query?: URLSearchParams,
): URL {
  if (!path.startsWith(`${JOURNAL_PATH}/`) || path.includes("..")) {
    fail("unsafe_url", "Activity Journal path escaped its demo boundary.");
  }
  const url = new URL(path, provider);
  if (url.origin !== provider.origin || url.pathname !== path) {
    fail("unsafe_url", "Activity Journal URL escaped its configured provider.");
  }
  if (query) url.search = query.toString();
  return url;
}

async function readLimitedBody(
  response: Response,
  maxBytes: number,
): Promise<string> {
  const declaredRaw = response.headers.get("content-length");
  if (declaredRaw !== null) {
    const declared = Number(declaredRaw);
    if (
      !Number.isSafeInteger(declared) ||
      declared < 0 ||
      declared > maxBytes
    ) {
      fail("too_large", "Activity Journal response exceeds its size limit.");
    }
  }
  if (!response.body) {
    fail("invalid_json", "Activity Journal response has no body.");
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
        fail("too_large", "Activity Journal response exceeds its size limit.");
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
    fail("invalid_json", "Activity Journal response is not valid UTF-8.");
  }
}

function assertDemoHeaders(response: Response) {
  for (const [name, expected] of Object.entries(REQUIRED_DEMO_HEADERS)) {
    if (response.headers.get(name) !== expected) {
      fail(
        "contract_mismatch",
        "Activity Journal response does not prove the public historical-demo boundary.",
      );
    }
  }
}

async function requestJson(
  url: URL,
  options: CivicActivityJournalClientOptions,
): Promise<unknown> {
  const { timeoutMs, maxResponseBytes, fetcher } = readLimits(options);
  const controller = new AbortController();
  let timedOut = false;
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(
        new StadtstackFederationError(
          "timeout",
          "Activity Journal request timed out.",
        ),
      );
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
      fail("unsafe_url", "Activity Journal redirects are not accepted.");
    }
    if (response.status === 404) {
      fail("not_found", "Activity Journal resource was not found.", 404);
    }
    if (!response.ok) {
      fail(
        "http",
        `Activity Journal returned HTTP ${response.status}.`,
        response.status,
      );
    }
    if (
      !(response.headers.get("content-type") ?? "")
        .toLowerCase()
        .includes("application/json")
    ) {
      fail("content_type", "Activity Journal response is not JSON.");
    }
    assertDemoHeaders(response);
    const body = await readLimitedBody(response, maxResponseBytes);
    try {
      return JSON.parse(body) as unknown;
    } catch {
      fail("invalid_json", "Activity Journal response contains invalid JSON.");
    }
  };

  try {
    return await Promise.race([requestAndRead(), timeout]);
  } catch (error) {
    if (error instanceof StadtstackFederationError) throw error;
    fail(
      timedOut ? "timeout" : "network",
      timedOut
        ? "Activity Journal request timed out."
        : "Activity Journal is unavailable.",
    );
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

function parseOrFail<T>(
  result: { success: true; data: T } | { success: false },
  label: string,
): T {
  if (!result.success) {
    fail("invalid_schema", `${label} does not match the pinned demo schema.`);
  }
  return result.data;
}

function sameScope(
  left: CivicActivityJournalScopeV1,
  right: CivicActivityJournalScopeV1,
) {
  return (
    left.municipalityId === right.municipalityId &&
    left.decisionCaseSlug === right.decisionCaseSlug &&
    left.audienceBoundary === right.audienceBoundary &&
    left.workspaceRoomRef === right.workspaceRoomRef &&
    left.coverageStartAt === right.coverageStartAt
  );
}

function canonicalJson(value: unknown): string {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      fail("invalid_schema", "Activity Journal contains a non-finite number.");
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  if (!value || typeof value !== "object") {
    fail(
      "invalid_schema",
      "Activity Journal contains an unsupported canonical JSON value.",
    );
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

async function sha256Canonical(value: unknown): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    fail(
      "configuration",
      "This browser cannot verify Activity Journal SHA-256 checksums.",
    );
  }
  const bytes = new TextEncoder().encode(canonicalJson(value));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `sha256:${hex}`;
}

async function verifyEventChecksums(
  events: readonly CivicActivityJournalEventV1[],
): Promise<void> {
  for (const event of events) {
    const { eventSha256: _eventSha256, ...unsignedEvent } = event;
    if ((await sha256Canonical(unsignedEvent)) !== event.eventSha256) {
      fail(
        "checksum",
        "Activity Journal event checksum verification failed.",
      );
    }
  }
}

async function verifySegmentSeal(
  seal: CivicActivityJournalSegmentSealV1,
): Promise<void> {
  const { sealSha256: _sealSha256, ...unsignedSeal } = seal;
  if ((await sha256Canonical(unsignedSeal)) !== seal.sealSha256) {
    fail("checksum", "Activity Journal segment-seal verification failed.");
  }
}

export async function loadRoebelActivityJournalCapabilities(
  options: CivicActivityJournalClientOptions,
): Promise<CivicActivityJournalCapabilitiesV1> {
  const provider = providerOrigin(options.baseUrl);
  const url = exactJournalUrl(provider, `${JOURNAL_PATH}/capabilities`);
  const capabilities = parseOrFail(
    civicActivityJournalCapabilitiesSchema.safeParse(
      await requestJson(url, options),
    ),
    "Activity Journal capabilities",
  );
  await verifySegmentSeal(capabilities.segmentSeal);
  return capabilities;
}

export async function listRoebelActivityJournalEvents(
  options: CivicActivityJournalListOptions,
): Promise<CivicActivityJournalEventListV1> {
  const provider = providerOrigin(options.baseUrl);
  const limit = options.limit ?? DEFAULT_PAGE_SIZE;
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > CIVIC_ACTIVITY_JOURNAL_MAX_PAGE_SIZE
  ) {
    fail("configuration", "Invalid Activity Journal page limit.");
  }
  if (
    options.cursor !== undefined &&
    !civicActivityJournalCursorSchema.safeParse(options.cursor).success
  ) {
    fail("configuration", "Invalid Activity Journal cursor.");
  }
  const query = new URLSearchParams({ limit: String(limit) });
  if (options.cursor) query.set("cursor", options.cursor);
  const url = exactJournalUrl(provider, `${JOURNAL_PATH}/events`, query);
  const result = parseOrFail(
    civicActivityJournalEventListSchema.safeParse(
      await requestJson(url, options),
    ),
    "Activity Journal event list",
  );
  if (result.page.limit !== limit) {
    fail(
      "contract_mismatch",
      "Activity Journal returned a different page limit than requested.",
    );
  }
  await verifyEventChecksums(result.events);
  return result;
}

export async function getRoebelActivityJournalActionTimeline(
  options: CivicActivityJournalClientOptions,
  correlationId: string,
): Promise<CivicActivityJournalActionTimelineV1> {
  const provider = providerOrigin(options.baseUrl);
  const parsedCorrelationId =
    civicActivityJournalCorrelationIdSchema.safeParse(correlationId);
  if (!parsedCorrelationId.success) {
    fail("configuration", "Invalid Activity Journal correlation id.");
  }
  const exactCorrelationId = parsedCorrelationId.data;
  const url = exactJournalUrl(
    provider,
    `${JOURNAL_PATH}/actions/${encodeURIComponent(exactCorrelationId)}`,
  );
  const timeline = parseOrFail(
    civicActivityJournalActionTimelineSchema.safeParse(
      await requestJson(url, options),
    ),
    "Activity Journal action timeline",
  );
  if (timeline.correlationId !== exactCorrelationId) {
    fail(
      "contract_mismatch",
      "Activity Journal returned a different action timeline than requested.",
    );
  }
  await verifyEventChecksums(timeline.events);
  return timeline;
}

export async function getRoebelActivityJournalEvent(
  options: CivicActivityJournalClientOptions,
  eventId: string,
): Promise<CivicActivityJournalEventV1> {
  const provider = providerOrigin(options.baseUrl);
  const parsedEventId = civicActivityJournalEventIdSchema.safeParse(eventId);
  if (!parsedEventId.success) {
    fail("configuration", "Invalid Activity Journal event id.");
  }
  const exactEventId = parsedEventId.data;
  const url = exactJournalUrl(
    provider,
    `${JOURNAL_PATH}/events/${encodeURIComponent(exactEventId)}`,
  );
  const event = parseOrFail(
    civicActivityJournalEventSchema.safeParse(await requestJson(url, options)),
    "Activity Journal event",
  );
  if (event.eventId !== exactEventId) {
    fail(
      "contract_mismatch",
      "Activity Journal returned a different event than requested.",
    );
  }
  await verifyEventChecksums([event]);
  return event;
}

export async function loadRoebelActivityJournalDemo(
  options: CivicActivityJournalClientOptions,
): Promise<CivicActivityJournalDemoResult> {
  const capabilities = await loadRoebelActivityJournalCapabilities(options);
  const { segmentSeal } = capabilities;
  const limit = segmentSeal.eventCount;
  const eventList = await listRoebelActivityJournalEvents({
    ...options,
    limit,
  });
  const firstEvent = eventList.events[0];
  const lastEvent = eventList.events[eventList.events.length - 1];
  if (
    !sameScope(capabilities.scope, eventList.scope) ||
    eventList.page.limit !== segmentSeal.eventCount ||
    eventList.page.returned !== segmentSeal.eventCount ||
    eventList.page.nextCursor !== null ||
    eventList.events.length !== segmentSeal.eventCount ||
    firstEvent?.scopeSequence !== segmentSeal.firstSequence ||
    firstEvent?.eventSha256 !== segmentSeal.genesisEventSha256 ||
    lastEvent?.scopeSequence !== segmentSeal.lastSequence ||
    lastEvent?.eventSha256 !== segmentSeal.headEventSha256 ||
    eventList.events.some(
      (event) => event.segmentId !== segmentSeal.segmentId,
    ) ||
    eventList.events.some(
      (event) =>
        !capabilities.supportedEventTypes.includes(event.eventType) ||
        !capabilities.supportedStatuses.includes(event.status),
    )
  ) {
    fail(
      "contract_mismatch",
      "Activity Journal capabilities and event page do not describe the same bounded journal.",
    );
  }
  return { capabilities, eventList };
}
