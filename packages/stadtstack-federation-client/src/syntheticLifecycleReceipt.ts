import {
  ROEBEL_R4_PUBLIC_RESPONSE_SHA256,
  roebelPublicSyntheticLifecycleReceiptSchema,
  type RoebelPublicSyntheticLifecycleReceiptV1,
} from "./syntheticLifecycleReceiptContracts";
import {
  StadtstackFederationError,
  type StadtstackFederationClientOptions,
} from "./client";

const LIFECYCLE_RECEIPT_PATH =
  "/api/demo/roebel-marienfelder/lifecycle-receipt";
const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RESPONSE_BYTES = 32_768;
const HARD_MAX_RESPONSE_BYTES = 65_536;

const REQUIRED_HEADERS = {
  "x-stadtstack-truth-state": "demo",
  "x-stadtstack-authority": "none",
  "x-stadtstack-review-state": "synthetic_demo",
} as const;

export interface SyntheticLifecycleReceiptClientOptions extends Omit<
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

function exactLifecycleReceiptUrl(value: string): URL {
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
    url.pathname = LIFECYCLE_RECEIPT_PATH;
    return url;
  } catch {
    fail(
      "configuration",
      "Stadtstack baseUrl must be an HTTPS origin (or localhost HTTP in development)."
    );
  }
}

function assertHeaders(response: Response): void {
  for (const [name, expected] of Object.entries(REQUIRED_HEADERS)) {
    if (response.headers.get(name) !== expected) {
      fail(
        "contract_mismatch",
        "Synthetic lifecycle receipt truth headers do not match the sealed R4 demo."
      );
    }
  }
}

async function sha256(bytes: Uint8Array): Promise<`sha256:${string}`> {
  if (!globalThis.crypto?.subtle) {
    fail(
      "configuration",
      "Cryptographic verification is unavailable in this browser."
    );
  }
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${Array.from(new Uint8Array(digest), (value) =>
    value.toString(16).padStart(2, "0")
  ).join("")}`;
}

async function readExactR4Json(
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
      fail("too_large", "Synthetic lifecycle receipt exceeds its size limit.");
    }
  }
  const body = new Uint8Array(await response.arrayBuffer());
  if (body.byteLength > maxBytes) {
    fail("too_large", "Synthetic lifecycle receipt exceeds its size limit.");
  }
  if ((await sha256(body)) !== ROEBEL_R4_PUBLIC_RESPONSE_SHA256) {
    fail(
      "contract_mismatch",
      "Synthetic lifecycle receipt bytes do not match the sealed R4 public projection."
    );
  }
  try {
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(body)
    ) as unknown;
  } catch {
    fail("invalid_json", "Synthetic lifecycle receipt contains invalid JSON.");
  }
}

/**
 * Reads the one immutable, public-safe R4 demo receipt. It is not a live
 * municipal status: exact response bytes, truth headers and all no-effect
 * fields must match before any part of the receipt is returned to the UI.
 */
export async function loadRoebelSyntheticLifecycleReceipt(
  options: SyntheticLifecycleReceiptClientOptions
): Promise<RoebelPublicSyntheticLifecycleReceiptV1> {
  const url = exactLifecycleReceiptUrl(options.baseUrl);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 100 ||
    timeoutMs > MAX_TIMEOUT_MS ||
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 12_000 ||
    maxBytes > HARD_MAX_RESPONSE_BYTES
  ) {
    fail(
      "configuration",
      "Invalid bounded synthetic lifecycle receipt client limits."
    );
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
        ? "Synthetic lifecycle receipt request timed out."
        : "Synthetic lifecycle receipt is unavailable."
    );
  } finally {
    clearTimeout(timeout);
  }

  if (response.redirected) {
    fail("unsafe_url", "Synthetic lifecycle receipt redirects are not accepted.");
  }
  if (response.status === 404) {
    fail("not_found", "Synthetic lifecycle receipt was not found.", 404);
  }
  if (!response.ok) {
    fail(
      "http",
      `Synthetic lifecycle receipt returned HTTP ${response.status}.`,
      response.status
    );
  }
  if (
    !(response.headers.get("content-type") ?? "")
      .toLowerCase()
      .includes("application/json")
  ) {
    fail("content_type", "Synthetic lifecycle receipt is not JSON.");
  }
  assertHeaders(response);
  const parsed = roebelPublicSyntheticLifecycleReceiptSchema.safeParse(
    await readExactR4Json(response, maxBytes)
  );
  if (!parsed.success) {
    fail(
      "invalid_schema",
      "Synthetic lifecycle receipt does not match the sealed public R4 schema."
    );
  }
  return parsed.data;
}
