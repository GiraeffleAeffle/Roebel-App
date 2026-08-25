import { createServer, type IncomingMessage, type Server } from "node:http";

import {
  CHALLENGE_COOKIE,
  PARTICIPANT_LABEL,
  SESSION_COOKIE,
  challengeMessage,
  clearCookie,
  consumeChallenge,
  cookie,
  decodeSignedChallenge,
  decodeSignedSession,
  issueChallenge,
  issueSession,
  normalizeWallet,
  readCookie,
  type ChallengeStore,
  validInvite,
} from "./protocol.ts";
import type {
  StagingParticipantDataAdapter,
  StagingParticipantGatewayConfig,
  WalletSignatureVerifier,
} from "./types.ts";

const MAX_REQUEST_BYTES = 8 * 1024;
const MAX_CONTENT_BYTES = 2_000;
const CHALLENGE_SCHEMA = "staging_participant_challenge_request_v1";
const SESSION_SCHEMA = "staging_participant_session_request_v1";
const POST_SCHEMA = "staging_participant_post_request_v1";
const COMMENT_SCHEMA = "staging_participant_comment_request_v1";

const STATUS_PATH = "/api/staging-participant/v1/status";
const CHALLENGE_PATH = "/api/staging-participant/v1/challenge";
const SESSION_PATH = "/api/staging-participant/v1/session";
const POSTS_PATH = "/api/staging-participant/v1/posts";
const COMMENTS_PATH = "/api/staging-participant/v1/comments";
const AUTHORITY_PATHS = new Set([
  "/api/staging-participant/v1/cases",
  "/api/staging-participant/v1/votes",
  "/api/staging-participant/v1/treasury",
  "/api/staging-participant/v1/municipal",
]);

export type StagingParticipantGatewayDependencies = Readonly<{
  config: StagingParticipantGatewayConfig;
  verifier: WalletSignatureVerifier;
  data: StagingParticipantDataAdapter;
  now?: () => Date;
  randomId?: () => string;
  /**
   * The default is process-local and intentionally makes this first slice a
   * single-replica gateway. A multi-replica deployment must inject a durable,
   * atomically-consuming store before it is enabled.
   */
  challengeStore?: ChallengeStore;
}>;

function json(value: unknown, status = 200, origin?: string): Response {
  const headers = new Headers({
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
  });
  if (origin) {
    headers.set("access-control-allow-origin", origin);
    headers.set("access-control-allow-credentials", "true");
    headers.set("vary", "Origin");
  }
  return new Response(JSON.stringify(value), { status, headers });
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function parsedObject(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype) return null;
  const record = value as Record<string, unknown>;
  return exactKeys(record, keys) ? record : null;
}

function boundedText(value: unknown): string | null {
  if (typeof value !== "string" || value !== value.trim() || !value) return null;
  return Buffer.byteLength(value, "utf8") <= MAX_CONTENT_BYTES ? value : null;
}

function validPostId(value: unknown): string | null {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)
    ? value.toLowerCase()
    : null;
}

function validRequestId(value: unknown): string | null {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)
    ? value.toLowerCase()
    : null;
}

function nodeResponseHeaders(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((value, name) => { result[name] = value; });
  return result;
}

function isAllowedOrigin(request: Request, config: StagingParticipantGatewayConfig): boolean {
  return request.headers.get("origin") === config.origin;
}

async function readJson(request: Request): Promise<unknown> {
  const declaredLengthHeader = request.headers.get("content-length");
  const declaredLength = Number(declaredLengthHeader ?? 0);
  if (declaredLengthHeader !== null &&
    (!Number.isSafeInteger(declaredLength) || declaredLength < 0 || declaredLength > MAX_REQUEST_BYTES)) {
    throw new Error(declaredLength > MAX_REQUEST_BYTES ? "too_large" : "invalid");
  }
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim() !== "application/json") {
    throw new Error("content_type");
  }
  const raw = await request.text();
  if (Buffer.byteLength(raw, "utf8") > MAX_REQUEST_BYTES) throw new Error("too_large");
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new Error("invalid");
  }
}

function clearChallenge(response: Response, secure: boolean): Response {
  response.headers.append("set-cookie", clearCookie(CHALLENGE_COOKIE, secure));
  return response;
}

/**
 * Exact, staging-only write surface. This handler has no generic proxy, no
 * caller-selected table/RPC, and no civic-authority verbs. It is designed to
 * sit behind one narrow ingress path rather than widening the read-only web
 * presentation ingress.
 */
export function createStagingParticipantGatewayHandler(
  dependencies: StagingParticipantGatewayDependencies,
): (request: Request) => Promise<Response> {
  const { config } = dependencies;
  if (config.sessionHmacKey.length < 32 || !/^[a-f0-9]{64}$/iu.test(config.inviteSha256)) {
    throw new Error("staging_participant_gateway_config_invalid");
  }
  let origin: string;
  try {
    origin = new URL(config.origin).origin;
  } catch {
    throw new Error("staging_participant_gateway_origin_invalid");
  }
  if (origin !== config.origin) throw new Error("staging_participant_gateway_origin_invalid");
  const now = dependencies.now ?? (() => new Date());
  const store = dependencies.challengeStore ?? new Map();

  return async (request) => {
    const url = new URL(request.url);
    if (url.search) return json({ error: "not_found" }, 404);
    if (!isAllowedOrigin(request, config)) return json({ error: "origin_forbidden" }, 403);

    if (AUTHORITY_PATHS.has(url.pathname)) {
      return json({ error: "authority_action_forbidden" }, 403, origin);
    }
    if (request.method === "OPTIONS" &&
      [STATUS_PATH, CHALLENGE_PATH, SESSION_PATH, POSTS_PATH, COMMENTS_PATH].includes(url.pathname)) {
      const response = new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": origin,
          "access-control-allow-credentials": "true",
          "cache-control": "no-store",
          "vary": "Origin",
          "x-content-type-options": "nosniff",
        },
      });
      response.headers.set("access-control-allow-methods", url.pathname === STATUS_PATH ? "GET" : "POST");
      response.headers.set("access-control-allow-headers", "content-type");
      response.headers.set("access-control-max-age", "600");
      return response;
    }
    if (url.pathname === STATUS_PATH) {
      if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405, origin);
      const time = now();
      const session = Number.isFinite(time.getTime())
        ? decodeSignedSession(readCookie(request.headers.get("cookie"), SESSION_COOKIE), config.sessionHmacKey, Math.floor(time.getTime() / 1_000))
        : null;
      return json({
        available: true,
        active: Boolean(session),
        walletAddress: session?.walletAddress ?? null,
        label: PARTICIPANT_LABEL,
        scope: session ? "main_text_post_comment" : null,
        authority: "none",
      }, 200, origin);
    }
    if (url.pathname !== CHALLENGE_PATH && url.pathname !== SESSION_PATH &&
      url.pathname !== POSTS_PATH && url.pathname !== COMMENTS_PATH) {
      return json({ error: "not_found" }, 404, origin);
    }
    if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405, origin);

    let body: unknown;
    try {
      body = await readJson(request);
    } catch (error) {
      const code = error instanceof Error ? error.message : "invalid";
      return json({ error: code === "too_large" ? "request_too_large" : code === "content_type" ? "content_type_invalid" : "request_invalid" }, code === "too_large" ? 413 : code === "content_type" ? 415 : 400, origin);
    }
    const time = now();
    if (!Number.isFinite(time.getTime())) return json({ error: "service_unavailable" }, 503, origin);
    const nowMs = time.getTime();

    if (url.pathname === CHALLENGE_PATH) {
      const record = parsedObject(body, ["schemaVersion", "walletAddress", "inviteToken"]);
      const walletAddress = record && record.schemaVersion === CHALLENGE_SCHEMA ? normalizeWallet(record.walletAddress) : null;
      if (!record || !walletAddress || !validInvite(record.inviteToken, config.inviteSha256)) {
        return json({ error: "admission_invalid" }, 401, origin);
      }
      let issued: ReturnType<typeof issueChallenge>;
      try {
        issued = issueChallenge({ walletAddress, nowMs, randomId: dependencies.randomId, key: config.sessionHmacKey, store });
      } catch {
        return json({ error: "service_unavailable" }, 503, origin);
      }
      const response = json({
        message: challengeMessage(issued.claim),
        expiresAt: issued.claim.expiresAt,
        label: PARTICIPANT_LABEL,
        authority: "none",
      }, 200, origin);
      response.headers.append("set-cookie", cookie(CHALLENGE_COOKIE, issued.token, issued.claim.expiresAt - issued.claim.issuedAt, config.cookieSecure));
      return response;
    }

    if (url.pathname === SESSION_PATH) {
      const record = parsedObject(body, ["schemaVersion", "signature"]);
      const signature = record && record.schemaVersion === SESSION_SCHEMA && typeof record.signature === "string" &&
        /^0x[0-9a-f]+$/iu.test(record.signature) && Buffer.byteLength(record.signature, "utf8") <= MAX_REQUEST_BYTES
        ? record.signature
        : null;
      const claim = decodeSignedChallenge(
        readCookie(request.headers.get("cookie"), CHALLENGE_COOKIE),
        config.sessionHmacKey,
        Math.floor(nowMs / 1_000),
      );
      if (!signature || !claim || !consumeChallenge({ claim, store, nowSeconds: Math.floor(nowMs / 1_000) })) {
        return clearChallenge(json({ error: "challenge_invalid" }, 401, origin), config.cookieSecure);
      }
      let valid = false;
      try {
        valid = await dependencies.verifier.verifyWalletSignature({
          address: claim.walletAddress,
          message: challengeMessage(claim),
          signature,
        });
      } catch {
        return clearChallenge(json({ error: "verification_unavailable" }, 503, origin), config.cookieSecure);
      }
      if (!valid) return clearChallenge(json({ error: "signature_invalid" }, 401, origin), config.cookieSecure);
      const issued = issueSession(claim.walletAddress, nowMs, config.sessionHmacKey);
      const response = clearChallenge(json({
        active: true,
        walletAddress: issued.claim.walletAddress,
        label: PARTICIPANT_LABEL,
        scope: issued.claim.scope,
        authority: "none",
      }, 200, origin), config.cookieSecure);
      response.headers.append("set-cookie", cookie(SESSION_COOKIE, issued.token, issued.claim.expiresAt - issued.claim.issuedAt, config.cookieSecure));
      return response;
    }

    const session = decodeSignedSession(
      readCookie(request.headers.get("cookie"), SESSION_COOKIE),
      config.sessionHmacKey,
      Math.floor(nowMs / 1_000),
    );
    if (!session) return json({ error: "session_required" }, 401, origin);

    if (url.pathname === POSTS_PATH) {
      const record = parsedObject(body, ["schemaVersion", "requestId", "content"]);
      const content = record && record.schemaVersion === POST_SCHEMA ? boundedText(record.content) : null;
      const requestId = record && record.schemaVersion === POST_SCHEMA ? validRequestId(record.requestId) : null;
      if (!content || !requestId) return json({ error: "request_invalid" }, 400, origin);
      try {
        const result = await dependencies.data.createMainTextPost({ walletAddress: session.walletAddress, content, requestId });
        return json({ data: result }, 201, origin);
      } catch {
        return json({ error: "write_unavailable" }, 503, origin);
      }
    }

    const record = parsedObject(body, ["schemaVersion", "requestId", "postId", "content"]);
    const postId = record && record.schemaVersion === COMMENT_SCHEMA ? validPostId(record.postId) : null;
    const content = record && record.schemaVersion === COMMENT_SCHEMA ? boundedText(record.content) : null;
    const requestId = record && record.schemaVersion === COMMENT_SCHEMA ? validRequestId(record.requestId) : null;
    if (!postId || !content || !requestId) return json({ error: "request_invalid" }, 400, origin);
    try {
      const result = await dependencies.data.createMainTextComment({ walletAddress: session.walletAddress, postId, content, requestId });
      return json({ data: result }, 201, origin);
    } catch {
      return json({ error: "write_unavailable" }, 503, origin);
    }
  };
}

async function readIncomingBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const value of request) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    bytes += chunk.byteLength;
    if (bytes > MAX_REQUEST_BYTES) throw new Error("request_too_large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/** Node adapter: tests call the Fetch handler; the executable uses this adapter. */
export function createStagingParticipantGatewayServer(
  dependencies: StagingParticipantGatewayDependencies,
): Server {
  const handle = createStagingParticipantGatewayHandler(dependencies);
  return createServer(async (incoming, outgoing) => {
    try {
      const body = incoming.method === "GET" || incoming.method === "HEAD" || incoming.method === "OPTIONS"
        ? undefined
        : await readIncomingBody(incoming);
      const headers = new Headers();
      for (const [name, value] of Object.entries(incoming.headers)) {
        if (Array.isArray(value)) value.forEach((entry) => headers.append(name, entry));
        else if (value !== undefined) headers.set(name, value);
      }
      const response = await handle(new Request(new URL(incoming.url ?? "/", "http://staging-participant.internal"), {
        method: incoming.method,
        headers,
        ...(body ? { body: new Uint8Array(body) } : {}),
      }));
      const setCookie = response.headers.getSetCookie();
      const outputHeaders = nodeResponseHeaders(response.headers);
      if (setCookie.length) outputHeaders["set-cookie"] = setCookie.join(", ");
      outgoing.writeHead(response.status, outputHeaders);
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      const tooLarge = error instanceof Error && error.message === "request_too_large";
      const response = json({ error: tooLarge ? "request_too_large" : "service_unavailable" }, tooLarge ? 413 : 503);
      outgoing.writeHead(response.status, nodeResponseHeaders(response.headers));
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    }
  });
}

export async function listenStagingParticipantGatewayServer(input: Readonly<{
  server: Server;
  host: string;
  port: number;
}>): Promise<void> {
  if (!['127.0.0.1', '0.0.0.0'].includes(input.host) || !Number.isSafeInteger(input.port) || input.port < 1 || input.port > 65535) {
    throw new Error("staging_participant_gateway_listener_invalid");
  }
  await new Promise<void>((resolve, reject) => {
    input.server.once("error", reject);
    input.server.listen(input.port, input.host, () => {
      input.server.off("error", reject);
      resolve();
    });
  });
}
