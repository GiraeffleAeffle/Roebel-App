import {
  civicTopicContextSchema,
  type CivicTopicContextV1,
} from "./topicContextContracts";
import {
  StadtstackFederationError,
  type StadtstackFederationClientOptions,
} from "./client";

const TOPIC_CONTEXT_PATH =
  "/api/demo/roebel-marienfelder/topic-context";
const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RESPONSE_BYTES = 64_000;
const HARD_MAX_RESPONSE_BYTES = 128_000;

const REQUIRED_DEMO_HEADERS = {
  "x-stadtstack-truth-state": "demo",
  "x-stadtstack-authority": "none",
  "x-stadtstack-demo-scenario": "walkthrough",
  "x-stadtstack-visibility": "public_reviewed",
  "x-stadtstack-historical-evidence": "true",
  "x-stadtstack-current-state-verified": "false",
  "x-stadtstack-backfilled": "true",
} as const;

export interface CivicTopicContextClientOptions
  extends Omit<
    StadtstackFederationClientOptions,
    "municipalityId" | "maxCases"
  > {}

function fail(
  code: ConstructorParameters<typeof StadtstackFederationError>[0],
  message: string,
  status: number | null = null,
): never {
  throw new StadtstackFederationError(code, message, status);
}

function exactTopicContextUrl(value: string): URL {
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
    url.pathname = TOPIC_CONTEXT_PATH;
    return url;
  } catch {
    fail(
      "configuration",
      "Stadtstack baseUrl must be an HTTPS origin (or localhost HTTP in development).",
    );
  }
}

function assertDemoHeaders(response: Response) {
  for (const [name, expected] of Object.entries(REQUIRED_DEMO_HEADERS)) {
    if (response.headers.get(name) !== expected) {
      fail(
        "contract_mismatch",
        "Topic context response does not prove the public historical-demo boundary.",
      );
    }
  }
}

async function readLimitedJson(
  response: Response,
  maxBytes: number,
): Promise<unknown> {
  const declaredRaw = response.headers.get("content-length");
  if (declaredRaw !== null) {
    const declared = Number(declaredRaw);
    if (
      !Number.isSafeInteger(declared) ||
      declared < 0 ||
      declared > maxBytes
    ) {
      fail("too_large", "Topic context response exceeds its size limit.");
    }
  }
  const body = await response.arrayBuffer();
  if (body.byteLength > maxBytes) {
    fail("too_large", "Topic context response exceeds its size limit.");
  }
  try {
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(body),
    ) as unknown;
  } catch {
    fail("invalid_json", "Topic context response contains invalid JSON.");
  }
}

export async function loadRoebelMarienfelderTopicContext(
  options: CivicTopicContextClientOptions,
): Promise<CivicTopicContextV1> {
  const url = exactTopicContextUrl(options.baseUrl);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes =
    options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 100 ||
    timeoutMs > MAX_TIMEOUT_MS ||
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1_024 ||
    maxBytes > HARD_MAX_RESPONSE_BYTES
  ) {
    fail("configuration", "Invalid bounded topic context client limits.");
  }
  const fetcher = options.fetch ?? globalThis.fetch;
  if (typeof fetcher !== "function") {
    fail("configuration", "Fetch is unavailable in this browser.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetcher(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      credentials: "omit",
      redirect: "error",
      cache: "no-store",
      referrerPolicy: "no-referrer",
      signal: controller.signal,
    });
  } catch {
    fail(
      controller.signal.aborted ? "timeout" : "network",
      controller.signal.aborted
        ? "Topic context request timed out."
        : "Topic context is unavailable.",
    );
  } finally {
    clearTimeout(timeout);
  }

  if (response.redirected) {
    fail("unsafe_url", "Topic context redirects are not accepted.");
  }
  if (response.status === 404) {
    fail("not_found", "Topic context was not found.", 404);
  }
  if (!response.ok) {
    fail(
      "http",
      `Topic context returned HTTP ${response.status}.`,
      response.status,
    );
  }
  if (
    !(response.headers.get("content-type") ?? "")
      .toLowerCase()
      .includes("application/json")
  ) {
    fail("content_type", "Topic context response is not JSON.");
  }
  assertDemoHeaders(response);

  const parsed = civicTopicContextSchema.safeParse(
    await readLimitedJson(response, maxBytes),
  );
  if (!parsed.success) {
    fail(
      "invalid_schema",
      "Topic context does not match the pinned synthetic unbound schema.",
    );
  }
  return parsed.data;
}
