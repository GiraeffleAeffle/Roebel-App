import {
  roebelDepartmentConnectionDemoSchema,
  type RoebelDepartmentConnectionDemoV1,
} from "./contracts";
import {
  StadtstackFederationError,
  type StadtstackFederationClientOptions,
} from "./client";

const DEMO_PATH = "/api/demo/roebel-marienfelder/department-status";
const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_RESPONSE_BYTES = 128_000;

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
    url.pathname = DEMO_PATH;
    url.search = "?scenario=walkthrough";
    return url;
  } catch {
    fail(
      "configuration",
      "Stadtstack baseUrl must be an HTTPS origin (or localhost HTTP in development).",
    );
  }
}

async function readLimitedJson(response: Response, maxBytes: number): Promise<unknown> {
  const declared = response.headers.get("content-length");
  if (declared !== null && Number(declared) > maxBytes) {
    fail("too_large", "Stadtstack demo response exceeds its size limit.");
  }
  const body = await response.arrayBuffer();
  if (body.byteLength > maxBytes) {
    fail("too_large", "Stadtstack demo response exceeds its size limit.");
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)) as unknown;
  } catch {
    fail("invalid_json", "Stadtstack demo response contains invalid JSON.");
  }
}

/**
 * Loads the explicitly opted-in synthetic department walkthrough. It is kept
 * separate from reviewed federation data and is accepted only when the body
 * and all three public truth headers agree that it is a non-authoritative demo.
 */
export async function loadRoebelDepartmentDemo(
  options: Omit<StadtstackFederationClientOptions, "municipalityId" | "maxCases">,
): Promise<RoebelDepartmentConnectionDemoV1> {
  const url = providerOrigin(options.baseUrl);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 100 ||
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1_024
  ) {
    fail("configuration", "Invalid Stadtstack demo client limits.");
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
  } catch (error) {
    fail(
      controller.signal.aborted ? "timeout" : "network",
      controller.signal.aborted
        ? "Stadtstack demo request timed out."
        : "Stadtstack demo is unavailable.",
    );
  } finally {
    clearTimeout(timeout);
  }

  if (response.redirected) {
    fail("unsafe_url", "Stadtstack demo redirects are not accepted.");
  }
  if (!response.ok) {
    fail("http", `Stadtstack demo returned HTTP ${response.status}.`, response.status);
  }
  if (!(response.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) {
    fail("content_type", "Stadtstack demo response is not JSON.");
  }
  if (
    response.headers.get("x-stadtstack-truth-state") !== "demo" ||
    response.headers.get("x-stadtstack-authority") !== "none" ||
    response.headers.get("x-stadtstack-demo-scenario") !== "walkthrough"
  ) {
    fail("contract_mismatch", "Stadtstack demo truth headers do not match the walkthrough.");
  }

  const parsed = roebelDepartmentConnectionDemoSchema.safeParse(
    await readLimitedJson(response, maxBytes),
  );
  if (!parsed.success) {
    fail("invalid_schema", "Department walkthrough does not match the pinned demo schema.");
  }
  return parsed.data;
}
