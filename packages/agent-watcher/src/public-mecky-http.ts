import { createServer, type IncomingMessage, type Server } from "node:http";

import type { PublicMecky } from "./public-mecky";

const REQUEST_SCHEMA = "public_mecky_chat_request_v1" as const;
const RESPONSE_SCHEMA = "public_mecky_chat_response_v1" as const;
const MAX_REQUEST_BYTES = 4 * 1024;
const MAX_QUESTION_BYTES = 2_000;
const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

export type PublicMeckyChatBounds = Readonly<{
  perMinute: number;
  perDay: number;
}>;

export const DEFAULT_PUBLIC_MECKY_CHAT_BOUNDS: PublicMeckyChatBounds = {
  perMinute: 10,
  perDay: 100,
};

type PublicMeckyHttpDependencies = Readonly<{
  publicMecky: PublicMecky;
  municipalityId: string;
  now?: () => Date;
  bounds?: PublicMeckyChatBounds;
}>;

function json(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

function rateLimited(retryAfterSeconds: number): Response {
  return Response.json({ error: "rate_limited" }, {
    status: 429,
    headers: {
      "cache-control": "no-store",
      "retry-after": String(Math.max(1, Math.ceil(retryAfterSeconds))),
      "x-content-type-options": "nosniff",
    },
  });
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length &&
    actual.every((key, index) => key === wanted[index]);
}

function parseQuestion(value: unknown): string {
  if (
    !value || typeof value !== "object" || Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new Error("public_mecky_chat_request_invalid");
  }
  const record = value as Record<string, unknown>;
  if (
    !exactKeys(record, ["schemaVersion", "question"]) ||
    record.schemaVersion !== REQUEST_SCHEMA ||
    typeof record.question !== "string" ||
    record.question !== record.question.trim() ||
    !record.question ||
    Buffer.byteLength(record.question, "utf8") > MAX_QUESTION_BYTES
  ) {
    throw new Error("public_mecky_chat_request_invalid");
  }
  return record.question;
}

/**
 * One bounded, stateless HTTP turn over the same reviewed Public Mecky engine
 * used by Nostr mentions. The caller cannot choose the municipality, clock,
 * evidence, model, tools, or inference credentials.
 */
export function createPublicMeckyHttpHandler(
  dependencies: PublicMeckyHttpDependencies,
): (request: Request) => Promise<Response> {
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/u.test(dependencies.municipalityId)) {
    throw new Error("public_mecky_chat_municipality_invalid");
  }
  const now = dependencies.now ?? (() => new Date());
  const bounds = dependencies.bounds ?? DEFAULT_PUBLIC_MECKY_CHAT_BOUNDS;
  if (!Number.isSafeInteger(bounds.perMinute) || bounds.perMinute < 1 ||
    !Number.isSafeInteger(bounds.perDay) || bounds.perDay < bounds.perMinute) {
    throw new Error("public_mecky_chat_bounds_invalid");
  }
  let admittedAt: number[] = [];

  return async (request) => {
    const url = new URL(request.url);
    if (url.pathname === "/healthz" && !url.search) {
      if (request.method !== "GET") {
        return json({ error: "method_not_allowed" }, 405);
      }
      return json({ status: "ok" });
    }
    if (url.pathname !== "/v1/answer" || url.search) {
      return json({ error: "not_found" }, 404);
    }
    if (request.method !== "POST") {
      return json({ error: "method_not_allowed" }, 405);
    }
    const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim();
    if (contentType !== "application/json") {
      return json({ error: "content_type_invalid" }, 415);
    }
    const declaredLengthHeader = request.headers.get("content-length");
    const declaredLength = Number(declaredLengthHeader ?? 0);
    if (declaredLengthHeader !== null &&
      (!Number.isSafeInteger(declaredLength) || declaredLength < 0)) {
      return json({ error: "request_invalid" }, 400);
    }
    if (declaredLength > MAX_REQUEST_BYTES) {
      return json({ error: "request_too_large" }, 413);
    }

    let raw: string;
    try {
      raw = await request.text();
    } catch {
      return json({ error: "request_invalid" }, 400);
    }
    if (Buffer.byteLength(raw, "utf8") > MAX_REQUEST_BYTES) {
      return json({ error: "request_too_large" }, 413);
    }

    let value: unknown;
    try {
      value = JSON.parse(raw) as unknown;
    } catch {
      return json({ error: "request_invalid" }, 400);
    }

    let question: string;
    try {
      question = parseQuestion(value);
    } catch {
      return json({ error: "request_invalid" }, 400);
    }

    const askedAt = now();
    if (!Number.isFinite(askedAt.getTime())) {
      return json({ error: "service_unavailable" }, 503);
    }
    const askedAtMs = askedAt.getTime();
    admittedAt = admittedAt.filter((entry) => askedAtMs - entry < DAY_MS);
    const minute = admittedAt.filter((entry) => askedAtMs - entry < MINUTE_MS);
    if (minute.length >= bounds.perMinute) {
      return rateLimited((MINUTE_MS - (askedAtMs - minute[0])) / 1_000);
    }
    if (admittedAt.length >= bounds.perDay) {
      return rateLimited((DAY_MS - (askedAtMs - admittedAt[0])) / 1_000);
    }

    // Reserve the provider budget before awaiting inference so concurrent
    // requests cannot all pass the same limit check.
    admittedAt.push(askedAtMs);
    let result: Awaited<ReturnType<PublicMecky["answerMention"]>>;
    try {
      result = await dependencies.publicMecky.answerMention({
        municipalityId: dependencies.municipalityId,
        question,
        now: askedAt.toISOString(),
      });
    } catch {
      return json({ error: "service_unavailable" }, 503);
    }
    if (result.status === "answered") {
      return json({
        schemaVersion: RESPONSE_SCHEMA,
        status: "answered",
        content: result.content,
        evidenceRefs: result.evidenceRefs,
        authorityBinding: "none",
        effects: {
          civicStateMutation: false,
          suggestionSubmission: false,
          vote: false,
        },
      });
    }
    return json({
      schemaVersion: RESPONSE_SCHEMA,
      status: "refused",
      reason: result.reason,
      retryable: result.retryable,
      diagnosticCode: result.diagnosticCode,
      authorityBinding: "none",
      effects: {
        civicStateMutation: false,
        suggestionSubmission: false,
        vote: false,
      },
    });
  };
}

async function readIncomingBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const value of request) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    bytes += chunk.byteLength;
    if (bytes > MAX_REQUEST_BYTES) {
      throw new Error("public_mecky_chat_request_too_large");
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/** Node HTTP adapter kept outside the answer engine so tests can call the Fetch handler directly. */
export function createPublicMeckyHttpServer(
  dependencies: PublicMeckyHttpDependencies,
): Server {
  const handle = createPublicMeckyHttpHandler(dependencies);
  return createServer(async (incoming, outgoing) => {
    try {
      const body = incoming.method === "GET" || incoming.method === "HEAD"
        ? undefined
        : await readIncomingBody(incoming);
      const headers = new Headers();
      for (const [name, value] of Object.entries(incoming.headers)) {
        if (Array.isArray(value)) {
          for (const entry of value) headers.append(name, entry);
        } else if (value !== undefined) {
          headers.set(name, value);
        }
      }
      const request = new Request(
        new URL(incoming.url ?? "/", "http://public-mecky.internal"),
        {
          method: incoming.method,
          headers,
          ...(body ? { body: new Uint8Array(body) } : {}),
        },
      );
      const response = await handle(request);
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      const tooLarge = error instanceof Error &&
        error.message === "public_mecky_chat_request_too_large";
      const response = json(
        { error: tooLarge ? "request_too_large" : "service_unavailable" },
        tooLarge ? 413 : 503,
      );
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    }
  });
}

export async function listenPublicMeckyHttpServer(input: {
  server: Server;
  host: string;
  port: number;
}): Promise<void> {
  if (
    !["127.0.0.1", "0.0.0.0"].includes(input.host) ||
    !Number.isSafeInteger(input.port) || input.port < 1 || input.port > 65_535
  ) {
    throw new Error("public_mecky_chat_listener_invalid");
  }
  await new Promise<void>((resolve, reject) => {
    input.server.once("error", reject);
    input.server.listen(input.port, input.host, () => {
      input.server.off("error", reject);
      resolve();
    });
  });
}
