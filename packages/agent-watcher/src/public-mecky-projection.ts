import type { NostrEvent } from "@netizen-labs/nostr";

export interface PublicMeckyReplyProjectionSinkOptions {
  endpoint: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export type PublicMeckyReplyProjectionSink = (
  event: NostrEvent,
) => Promise<void>;

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Project a signed Public Mecky reply into the Röbel application's read model.
 *
 * The signed Nostr event is the credential: this adapter deliberately accepts
 * no database key or bearer token. The receiving edge function independently
 * verifies the event, exact agent pubkey and source-app tags before it may
 * write. A failed projection is retryable and never changes the relay reply.
 */
export function createPublicMeckyReplyProjectionSink(
  options: PublicMeckyReplyProjectionSinkOptions,
): PublicMeckyReplyProjectionSink {
  let endpoint: URL;
  try {
    endpoint = new URL(options.endpoint);
  } catch {
    throw new Error("public_mecky_projection_url_invalid");
  }
  if (
    endpoint.protocol !== "https:" ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash
  ) {
    throw new Error("public_mecky_projection_url_invalid");
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 30_000) {
    throw new Error("public_mecky_projection_timeout_invalid");
  }
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new Error("public_mecky_projection_fetch_unavailable");
  }

  return async (event) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(endpoint, {
        method: "POST",
        redirect: "error",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
        },
        body: JSON.stringify({ event }),
        signal: controller.signal,
      });
      if (response.status !== 200 && response.status !== 201) {
        throw new Error(`public_mecky_projection_http_${response.status}`);
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("public_mecky_projection_timeout");
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  };
}
