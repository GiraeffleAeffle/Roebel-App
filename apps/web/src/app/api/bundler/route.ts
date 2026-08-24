import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth/session";
import {
  BUNDLER_MAX_ACTIVE_REQUESTS,
  BUNDLER_REQUEST_TIMEOUT_MS,
  BUNDLER_UPSTREAM_TIMEOUT_MS,
  GNOSIS_CHAIN_ID,
  MAX_BUNDLER_BODY_BYTES,
  createProposalBundlerBudget,
  hasBoundedJsonShape,
  isSameOrigin,
  parseGnosisBundlerConfig,
  parseProposalBundlerRequest,
  rpcError,
  sanitizeBundlerResponse,
} from "@/lib/server/gnosis-bundler-proxy";

/**
 * Optional, narrowly scoped bridge to Pimlico for the one self-paying
 * high-gas proposal operation. It is deliberately closed unless the caller
 * holds the existing signed dashboard session and makes a same-origin request.
 * The browser cannot choose a chain, upstream, URL, credentials, or arbitrary
 * JSON-RPC method; the smart account and Governor retain transaction authority.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const budget = createProposalBundlerBudget();
let activeRequests = 0;

function response(
  id: string | number | null,
  status: number,
  code: number,
  message: string
) {
  return NextResponse.json(rpcError(id, code, message), {
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
    status,
  });
}

async function readBoundedText(request: Request): Promise<string> {
  const length = request.headers.get("content-length");
  if (
    length !== null &&
    (!/^\d+$/u.test(length) || Number(length) > MAX_BUNDLER_BODY_BYTES)
  ) {
    throw new Error("request_too_large");
  }
  if (!request.body) throw new Error("request_body_missing");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    void reader.cancel("request_timeout");
  }, BUNDLER_REQUEST_TIMEOUT_MS);
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      size += item.value.byteLength;
      if (size > MAX_BUNDLER_BODY_BYTES) {
        await reader.cancel("request_too_large");
        throw new Error("request_too_large");
      }
      chunks.push(item.value);
    }
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
  }
  if (timedOut) throw new Error("request_timeout");
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

async function readBoundedUpstream(response: Response): Promise<unknown> {
  const length = response.headers.get("content-length");
  if (
    length !== null &&
    (!/^\d+$/u.test(length) || Number(length) > MAX_BUNDLER_BODY_BYTES)
  ) {
    throw new Error("upstream_too_large");
  }
  const body = await response.text();
  if (Buffer.byteLength(body, "utf8") > MAX_BUNDLER_BODY_BYTES) {
    throw new Error("upstream_too_large");
  }
  const parsed: unknown = JSON.parse(body);
  if (!hasBoundedJsonShape(parsed)) throw new Error("upstream_shape_invalid");
  return parsed;
}

export async function POST(request: Request) {
  const configured = parseGnosisBundlerConfig(
    process.env.GNOSIS_BUNDLER_RPC_URL,
    process.env.GNOSIS_BUNDLER_GOVERNOR_ADDRESS
  );
  if (!configured) {
    // Do not reveal which configuration field is missing or malformed.
    return response(null, 503, -32000, "Bundler unavailable.");
  }
  if (!isSameOrigin(request.url, request.headers.get("origin"))) {
    return response(null, 403, -32001, "Bundler request denied.");
  }
  const session = await getSession();
  if (!session) return response(null, 401, -32001, "Bundler request denied.");
  if (!budget.consume(session.username)) {
    return response(null, 429, -32005, "Bundler request rate limited.");
  }
  if (activeRequests >= BUNDLER_MAX_ACTIVE_REQUESTS) {
    return response(null, 503, -32000, "Bundler unavailable.");
  }
  activeRequests += 1;
  try {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readBoundedText(request));
    } catch {
      return response(null, 400, -32700, "Invalid JSON-RPC request.");
    }
    const rpc = parseProposalBundlerRequest(parsed, configured.governorAddress);
    if (!rpc)
      return response(null, 400, -32600, "Unsupported proposal operation.");
    // Chain identity is a fixed application invariant, not an upstream choice.
    if (rpc.method === "eth_chainId") {
      return NextResponse.json(
        { id: rpc.id, jsonrpc: "2.0", result: GNOSIS_CHAIN_ID },
        {
          headers: {
            "cache-control": "no-store",
            "x-content-type-options": "nosniff",
          },
        }
      );
    }

    const controller = new AbortController();
    const onClientAbort = () => controller.abort();
    request.signal.addEventListener("abort", onClientAbort, { once: true });
    const timeout = setTimeout(
      () => controller.abort(),
      BUNDLER_UPSTREAM_TIMEOUT_MS
    );
    try {
      const upstream = await fetch(configured.url, {
        body: JSON.stringify(rpc),
        headers: { "content-type": "application/json" },
        method: "POST",
        redirect: "error",
        signal: controller.signal,
      });
      if (
        !upstream.ok ||
        !upstream.headers
          .get("content-type")
          ?.toLowerCase()
          .startsWith("application/json")
      ) {
        return response(rpc.id, 502, -32000, "Bundler unavailable.");
      }
      const sanitized = sanitizeBundlerResponse(
        await readBoundedUpstream(upstream),
        rpc.id
      );
      if (!sanitized)
        return response(rpc.id, 502, -32000, "Bundler unavailable.");
      return NextResponse.json(sanitized, {
        headers: {
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
        },
      });
    } catch {
      return response(rpc.id, 502, -32000, "Bundler unavailable.");
    } finally {
      clearTimeout(timeout);
      request.signal.removeEventListener("abort", onClientAbort);
    }
  } finally {
    activeRequests -= 1;
  }
}
