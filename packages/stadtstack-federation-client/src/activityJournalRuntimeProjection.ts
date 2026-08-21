import {
  roebelActivityJournalRuntimeProjectionSchema,
  type RoebelActivityJournalRuntimeProjectionV1,
} from "./activityJournalRuntimeProjectionContracts";
import {
  StadtstackFederationError,
  type StadtstackFederationClientOptions,
} from "./client";

const RUNTIME_PROJECTION_PATH =
  "/api/demo/roebel-marienfelder/activity-journal/runtime-projection";
const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RESPONSE_BYTES = 32_768;
const HARD_MAX_RESPONSE_BYTES = 65_536;

const REQUIRED_RUNTIME_RECEIPT_HEADERS = {
  "x-stadtstack-truth-state": "demo",
  "x-stadtstack-authority": "none",
  "x-stadtstack-projection-freshness":
    "historical-verified-receipt-not-live-health",
  "x-stadtstack-private-journal": "not-public",
  "x-stadtstack-public-projection": "candidate-not-publicly-routed",
} as const;

export interface ActivityJournalRuntimeProjectionClientOptions extends Omit<
  StadtstackFederationClientOptions,
  "municipalityId" | "maxCases"
> {}

function fail(
  code: ConstructorParameters<typeof StadtstackFederationError>[0],
  message: string,
  status: number | null = null
): never {
  throw new StadtstackFederationError(code, message, status);
}

function exactRuntimeProjectionUrl(value: string): URL {
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
    url.pathname = RUNTIME_PROJECTION_PATH;
    return url;
  } catch {
    fail(
      "configuration",
      "Stadtstack baseUrl must be an HTTPS origin (or localhost HTTP in development)."
    );
  }
}

function assertRuntimeReceiptHeaders(response: Response) {
  for (const [name, expected] of Object.entries(
    REQUIRED_RUNTIME_RECEIPT_HEADERS
  )) {
    if (response.headers.get(name) !== expected) {
      fail(
        "contract_mismatch",
        "Activity Journal runtime receipt does not prove its private historical boundary."
      );
    }
  }
}

async function readLimitedJson(
  response: Response,
  maxBytes: number
): Promise<unknown> {
  const declaredRaw = response.headers.get("content-length");
  if (declaredRaw !== null) {
    const declared = Number(declaredRaw);
    if (
      !Number.isSafeInteger(declared) ||
      declared < 0 ||
      declared > maxBytes
    ) {
      fail(
        "too_large",
        "Activity Journal runtime receipt exceeds its size limit."
      );
    }
  }
  if (!response.body) {
    fail("invalid_json", "Activity Journal runtime receipt has no body.");
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
        fail(
          "too_large",
          "Activity Journal runtime receipt exceeds its size limit."
        );
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
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes)
    ) as unknown;
  } catch {
    fail(
      "invalid_json",
      "Activity Journal runtime receipt contains invalid JSON."
    );
  }
}

/**
 * Reads one public-safe, historical technical receipt. This client cannot
 * reach the private Journal API and rejects any widened response body.
 */
export async function loadRoebelActivityJournalRuntimeProjection(
  options: ActivityJournalRuntimeProjectionClientOptions
): Promise<RoebelActivityJournalRuntimeProjectionV1> {
  const url = exactRuntimeProjectionUrl(options.baseUrl);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 100 ||
    timeoutMs > MAX_TIMEOUT_MS ||
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1_024 ||
    maxBytes > HARD_MAX_RESPONSE_BYTES
  ) {
    fail(
      "configuration",
      "Invalid bounded Activity Journal runtime receipt client limits."
    );
  }
  const fetcher = options.fetch ?? globalThis.fetch;
  if (typeof fetcher !== "function") {
    fail("configuration", "Fetch is unavailable in this browser.");
  }

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
          "Activity Journal runtime receipt request timed out."
        )
      );
    }, timeoutMs);
  });

  const requestAndRead =
    async (): Promise<RoebelActivityJournalRuntimeProjectionV1> => {
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
        fail(
          "unsafe_url",
          "Activity Journal runtime receipt redirects are not accepted."
        );
      }
      if (response.status === 404) {
        fail(
          "not_found",
          "Activity Journal runtime receipt was not found.",
          404
        );
      }
      if (!response.ok) {
        fail(
          "http",
          `Activity Journal runtime receipt returned HTTP ${response.status}.`,
          response.status
        );
      }
      if (
        !(response.headers.get("content-type") ?? "")
          .toLowerCase()
          .includes("application/json")
      ) {
        fail("content_type", "Activity Journal runtime receipt is not JSON.");
      }
      assertRuntimeReceiptHeaders(response);
      const parsed = roebelActivityJournalRuntimeProjectionSchema.safeParse(
        await readLimitedJson(response, maxBytes)
      );
      if (!parsed.success) {
        fail(
          "invalid_schema",
          "Activity Journal runtime receipt does not match the pinned public-safe schema."
        );
      }
      return parsed.data;
    };

  try {
    return await Promise.race([requestAndRead(), timeout]);
  } catch (error) {
    if (error instanceof StadtstackFederationError) throw error;
    fail(
      timedOut ? "timeout" : "network",
      timedOut
        ? "Activity Journal runtime receipt request timed out."
        : "Activity Journal runtime receipt is unavailable."
    );
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
  fail(
    "network",
    "Activity Journal runtime receipt reached an unreachable request state."
  );
}
