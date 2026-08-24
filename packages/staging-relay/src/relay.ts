import { timingSafeEqual } from "node:crypto";
import { appendFile, mkdir, readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { verifyEvent, type Filter, type NostrEvent } from "@netizen-labs/nostr";
import { WebSocketServer, type RawData, type WebSocket } from "ws";

const HEX_64 = /^[0-9a-f]{64}$/;
const MAX_FRAME_BYTES = 131_072;
const MAX_CONTENT_BYTES = 65_536;
const MAX_TAGS = 256;
const MAX_FILTERS = 8;
const MAX_QUERY_RESULTS = 500;
const MAX_ADMISSION_BODY_BYTES = 512;
const ADMISSION_SCHEMA_VERSION = "roebel_staging_relay_admission_v1";
const MAX_PERSISTED_BYTES = 128 * 1024 * 1024;
const MAX_PERSISTED_RECORDS = 100_000;
const DEFAULT_EVENT_STORE_BYTES = 128 * 1024 * 1024;
const DEFAULT_EVENT_COUNT = 50_000;
const DEFAULT_ADMISSION_STORE_BYTES = 16 * 1024 * 1024;
const DEFAULT_ADMISSION_COUNT = 10_000;

type StoreLimits = {
  maxBytes: number;
  maxRecords: number;
};

export interface RelayConfig {
  admissionStorePath?: string;
  admissionToken?: string;
  allowedPubkeys: readonly string[];
  bindHost: "127.0.0.1" | "0.0.0.0";
  name: string;
  maxAdmissionCount?: number;
  maxAdmissionStoreBytes?: number;
  maxEventCount?: number;
  maxEventStoreBytes?: number;
  port: number;
  storePath: string;
  websocketPath?: string;
}

function boundedLimit(
  value: number | undefined,
  fallback: number,
  label: string
): number {
  const resolved = value ?? fallback;
  if (
    !Number.isSafeInteger(resolved) ||
    resolved < 1 ||
    resolved >
      (label.endsWith("bytes") ? MAX_PERSISTED_BYTES : MAX_PERSISTED_RECORDS)
  ) {
    throw new Error(`relay_${label}_invalid`);
  }
  return resolved;
}

interface AdmissionRecord {
  pubkey: string;
  schemaVersion: typeof ADMISSION_SCHEMA_VERSION;
}

export interface PublishDecision {
  message: string;
  ok: boolean;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function admissionRecord(value: unknown): AdmissionRecord | null {
  if (!isPlainObject(value)) return null;
  const keys = Object.keys(value).sort();
  if (keys.length !== 2 || keys[0] !== "pubkey" || keys[1] !== "schemaVersion")
    return null;
  if (
    value.schemaVersion !== ADMISSION_SCHEMA_VERSION ||
    typeof value.pubkey !== "string"
  )
    return null;
  if (!HEX_64.test(value.pubkey)) return null;
  return {
    schemaVersion: ADMISSION_SCHEMA_VERSION,
    pubkey: value.pubkey,
  };
}

class AdmissionStore {
  private writeQueue: Promise<void> = Promise.resolve();
  private storedBytes = 0;
  private storedRecords = 0;

  constructor(
    private readonly storePath: string,
    private readonly allowedPubkeys: Set<string>,
    private readonly limits: StoreLimits
  ) {}

  async open(): Promise<void> {
    await mkdir(dirname(this.storePath), { recursive: true });
    let text = "";
    try {
      const metadata = await stat(this.storePath);
      if (metadata.size > this.limits.maxBytes)
        throw new Error("relay_admission_store_capacity_exceeded");
      text = await readFile(this.storePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    this.storedBytes = Buffer.byteLength(text, "utf8");
    for (const line of text.split("\n")) {
      if (!line) continue;
      this.storedRecords += 1;
      if (this.storedRecords > this.limits.maxRecords)
        throw new Error("relay_admission_store_capacity_exceeded");
      try {
        const record = admissionRecord(JSON.parse(line));
        if (!record) throw new Error("admission_record_invalid");
        this.allowedPubkeys.add(record.pubkey);
      } catch {
        throw new Error("relay_admission_store_corrupt");
      }
    }
  }

  async allow(pubkey: string): Promise<void> {
    this.writeQueue = this.writeQueue.then(async () => {
      if (this.allowedPubkeys.has(pubkey)) return;
      const record: AdmissionRecord = {
        schemaVersion: ADMISSION_SCHEMA_VERSION,
        pubkey,
      };
      const line = `${JSON.stringify(record)}\n`;
      const lineBytes = Buffer.byteLength(line, "utf8");
      if (
        this.storedRecords >= this.limits.maxRecords ||
        this.storedBytes + lineBytes > this.limits.maxBytes
      ) {
        throw new Error("relay_admission_store_capacity_exceeded");
      }
      await appendFile(this.storePath, line, {
        encoding: "utf8",
        mode: 0o600,
      });
      this.storedBytes += lineBytes;
      this.storedRecords += 1;
      this.allowedPubkeys.add(pubkey);
    });
    await this.writeQueue;
  }
}

function authorized(request: IncomingMessage, token: string): boolean {
  const authorization = request.headers.authorization;
  if (typeof authorization !== "string" || !authorization.startsWith("Bearer "))
    return false;
  const supplied = Buffer.from(authorization.slice("Bearer ".length), "utf8");
  const expected = Buffer.from(token, "utf8");
  return (
    supplied.length === expected.length && timingSafeEqual(supplied, expected)
  );
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  let bytes = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.byteLength;
    if (bytes > MAX_ADMISSION_BODY_BYTES)
      throw new Error("admission_body_too_large");
    chunks.push(buffer);
  }
  if (bytes === 0) throw new Error("admission_body_required");
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-type": "application/json",
  });
  response.end(JSON.stringify(body));
}

function isEventShape(value: unknown): value is NostrEvent {
  if (!isPlainObject(value)) return false;
  if (
    Object.keys(value).sort().join(",") !==
    "content,created_at,id,kind,pubkey,sig,tags"
  )
    return false;
  if (
    typeof value.id !== "string" ||
    typeof value.pubkey !== "string" ||
    typeof value.sig !== "string" ||
    typeof value.created_at !== "number" ||
    !Number.isSafeInteger(value.created_at) ||
    typeof value.kind !== "number" ||
    !Number.isSafeInteger(value.kind) ||
    !Array.isArray(value.tags) ||
    typeof value.content !== "string"
  )
    return false;
  if (
    !HEX_64.test(value.id) ||
    !HEX_64.test(value.pubkey) ||
    !/^[0-9a-f]{128}$/.test(value.sig)
  ) {
    return false;
  }
  if (value.tags.length > MAX_TAGS) return false;
  return value.tags.every(
    (tag) =>
      Array.isArray(tag) &&
      tag.length <= 32 &&
      tag.every((part) => typeof part === "string")
  );
}

function replacementKey(event: NostrEvent): string | null {
  if (
    event.kind === 0 ||
    event.kind === 3 ||
    (event.kind >= 10_000 && event.kind < 20_000)
  ) {
    return `${event.pubkey}:${event.kind}:`;
  }
  if (event.kind >= 30_000 && event.kind < 40_000) {
    const d = event.tags.find((tag) => tag[0] === "d")?.[1] ?? "";
    return `${event.pubkey}:${event.kind}:${d}`;
  }
  return null;
}

function newerThan(left: NostrEvent, right: NostrEvent): boolean {
  return (
    left.created_at > right.created_at ||
    (left.created_at === right.created_at &&
      left.id.localeCompare(right.id) > 0)
  );
}

function matchesTag(
  event: NostrEvent,
  key: string,
  expected: unknown
): boolean {
  if (!key.startsWith("#") || key.length !== 2 || !Array.isArray(expected))
    return false;
  const tagName = key.slice(1);
  const values = expected.filter(
    (value): value is string => typeof value === "string"
  );
  return (
    values.length > 0 &&
    event.tags.some(
      (tag) => tag[0] === tagName && values.includes(tag[1] ?? "")
    )
  );
}

function matchesFilter(event: NostrEvent, filter: Filter): boolean {
  if (filter.ids && !filter.ids.some((prefix) => event.id.startsWith(prefix)))
    return false;
  if (
    filter.authors &&
    !filter.authors.some((prefix) => event.pubkey.startsWith(prefix))
  )
    return false;
  if (filter.kinds && !filter.kinds.includes(event.kind)) return false;
  if (filter.since !== undefined && event.created_at < filter.since)
    return false;
  if (filter.until !== undefined && event.created_at > filter.until)
    return false;
  for (const [key, value] of Object.entries(filter)) {
    if (key.startsWith("#") && !matchesTag(event, key, value)) return false;
  }
  return true;
}

function normalizeFilter(value: unknown): Filter | null {
  if (!isPlainObject(value)) return null;
  const allowed = new Set([
    "ids",
    "authors",
    "kinds",
    "since",
    "until",
    "limit",
  ]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key) && !/^#[a-zA-Z]$/.test(key)) return null;
  }
  if (
    value.ids !== undefined &&
    (!Array.isArray(value.ids) ||
      !value.ids.every((v) => typeof v === "string"))
  )
    return null;
  if (
    value.authors !== undefined &&
    (!Array.isArray(value.authors) ||
      !value.authors.every((v) => typeof v === "string"))
  )
    return null;
  if (
    value.kinds !== undefined &&
    (!Array.isArray(value.kinds) || !value.kinds.every(Number.isSafeInteger))
  )
    return null;
  for (const key of ["since", "until", "limit"] as const) {
    if (value[key] !== undefined && !Number.isSafeInteger(value[key]))
      return null;
  }
  return value as Filter;
}

export class PersistentEventStore {
  private readonly events = new Map<string, NostrEvent>();
  private readonly replacements = new Map<string, NostrEvent>();
  private writeQueue: Promise<void> = Promise.resolve();
  private storedBytes = 0;
  private storedRecords = 0;
  private readonly limits: StoreLimits;

  constructor(
    private readonly storePath: string,
    private readonly allowedPubkeys: ReadonlySet<string>,
    limits: StoreLimits = {
      maxBytes: DEFAULT_EVENT_STORE_BYTES,
      maxRecords: DEFAULT_EVENT_COUNT,
    }
  ) {
    this.limits = {
      maxBytes: boundedLimit(
        limits.maxBytes,
        DEFAULT_EVENT_STORE_BYTES,
        "event_store_bytes"
      ),
      maxRecords: boundedLimit(
        limits.maxRecords,
        DEFAULT_EVENT_COUNT,
        "event_count"
      ),
    };
  }

  async open(): Promise<void> {
    await mkdir(dirname(this.storePath), { recursive: true });
    let text = "";
    try {
      const metadata = await stat(this.storePath);
      if (metadata.size > this.limits.maxBytes)
        throw new Error("relay_event_store_capacity_exceeded");
      text = await readFile(this.storePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    this.storedBytes = Buffer.byteLength(text, "utf8");
    for (const line of text.split("\n")) {
      if (!line) continue;
      this.storedRecords += 1;
      if (this.storedRecords > this.limits.maxRecords)
        throw new Error("relay_event_store_capacity_exceeded");
      try {
        const event: unknown = JSON.parse(line);
        if (
          isEventShape(event) &&
          verifyEvent(event) &&
          this.allowedPubkeys.has(event.pubkey)
        ) {
          this.index(event);
        }
      } catch {
        throw new Error("relay_store_corrupt");
      }
    }
  }

  count(): number {
    return this.events.size;
  }

  private index(event: NostrEvent): void {
    const key = replacementKey(event);
    if (key) {
      const current = this.replacements.get(key);
      if (current && !newerThan(event, current)) return;
      if (current) this.events.delete(current.id);
      this.replacements.set(key, event);
    }
    this.events.set(event.id, event);
  }

  async publish(value: unknown): Promise<PublishDecision> {
    if (
      !isEventShape(value) ||
      Buffer.byteLength(value.content, "utf8") > MAX_CONTENT_BYTES
    ) {
      return { ok: false, message: "invalid: event shape" };
    }
    if (!verifyEvent(value))
      return { ok: false, message: "invalid: signature" };
    if (!this.allowedPubkeys.has(value.pubkey))
      return { ok: false, message: "blocked: author not allowed" };
    if (this.events.has(value.id))
      return { ok: true, message: "duplicate: already stored" };

    const key = replacementKey(value);
    const current = key ? this.replacements.get(key) : undefined;
    if (current && !newerThan(value, current))
      return { ok: true, message: "duplicate: superseded" };

    const line = `${JSON.stringify(value)}\n`;
    const lineBytes = Buffer.byteLength(line, "utf8");
    if (
      this.storedRecords >= this.limits.maxRecords ||
      this.storedBytes + lineBytes > this.limits.maxBytes
    ) {
      return { ok: false, message: "blocked: store capacity" };
    }
    this.index(value);
    this.writeQueue = this.writeQueue.then(() =>
      appendFile(this.storePath, line, { encoding: "utf8", mode: 0o600 })
    );
    await this.writeQueue;
    this.storedBytes += lineBytes;
    this.storedRecords += 1;
    return { ok: true, message: "stored" };
  }

  query(filters: readonly Filter[]): NostrEvent[] {
    const collected = new Map<string, NostrEvent>();
    for (const filter of filters) {
      const matching = [...this.events.values()]
        .filter((event) => matchesFilter(event, filter))
        .sort((a, b) => b.created_at - a.created_at || b.id.localeCompare(a.id))
        .slice(
          0,
          Math.min(
            Math.max(filter.limit ?? MAX_QUERY_RESULTS, 0),
            MAX_QUERY_RESULTS
          )
        );
      for (const event of matching) collected.set(event.id, event);
    }
    return [...collected.values()]
      .sort((a, b) => a.created_at - b.created_at || a.id.localeCompare(b.id))
      .slice(0, MAX_QUERY_RESULTS);
  }
}

export interface RunningRelay {
  close(): Promise<void>;
  port: number;
  store: PersistentEventStore;
}

function send(socket: WebSocket, message: unknown[]): void {
  socket.send(JSON.stringify(message));
}

function frameText(raw: RawData): string | null {
  if (typeof raw === "string") return raw;
  if (Buffer.isBuffer(raw)) return raw.toString("utf8");
  if (Array.isArray(raw)) return Buffer.concat(raw).toString("utf8");
  return Buffer.from(raw).toString("utf8");
}

export async function startRelay(config: RelayConfig): Promise<RunningRelay> {
  if (!config.name || config.name.length > 80)
    throw new Error("relay_name_invalid");
  if (
    !Number.isSafeInteger(config.port) ||
    config.port < 0 ||
    config.port > 65_535
  )
    throw new Error("relay_port_invalid");
  const allowed = new Set(
    config.allowedPubkeys.map((value) => value.toLowerCase())
  );
  if (allowed.size === 0 || [...allowed].some((value) => !HEX_64.test(value)))
    throw new Error("relay_allowlist_invalid");
  const storePath = resolve(config.storePath);
  const eventLimits: StoreLimits = {
    maxBytes: boundedLimit(
      config.maxEventStoreBytes,
      DEFAULT_EVENT_STORE_BYTES,
      "event_store_bytes"
    ),
    maxRecords: boundedLimit(
      config.maxEventCount,
      DEFAULT_EVENT_COUNT,
      "event_count"
    ),
  };
  const admissionLimits: StoreLimits = {
    maxBytes: boundedLimit(
      config.maxAdmissionStoreBytes,
      DEFAULT_ADMISSION_STORE_BYTES,
      "admission_store_bytes"
    ),
    maxRecords: boundedLimit(
      config.maxAdmissionCount,
      DEFAULT_ADMISSION_COUNT,
      "admission_count"
    ),
  };
  const admissionConfigured =
    config.admissionStorePath !== undefined ||
    config.admissionToken !== undefined;
  if (
    admissionConfigured &&
    (config.admissionStorePath === undefined ||
      config.admissionToken === undefined)
  ) {
    throw new Error("relay_admission_config_incomplete");
  }
  if (
    config.admissionToken !== undefined &&
    (!/^[!-~]{32,256}$/.test(config.admissionToken) ||
      /\s/.test(config.admissionToken))
  ) {
    throw new Error("relay_admission_token_invalid");
  }
  const admissionStorePath =
    config.admissionStorePath === undefined
      ? undefined
      : resolve(config.admissionStorePath);
  if (admissionStorePath === storePath)
    throw new Error("relay_admission_store_conflict");
  const admissions =
    admissionStorePath === undefined
      ? undefined
      : new AdmissionStore(admissionStorePath, allowed, admissionLimits);
  await admissions?.open();
  const store = new PersistentEventStore(storePath, allowed, eventLimits);
  await store.open();
  const websocketPath = config.websocketPath ?? "/";
  if (!/^\/[a-z0-9-]*$/.test(websocketPath))
    throw new Error("relay_websocket_path_invalid");

  const server: Server = createServer((request, response) => {
    if (
      request.method === "POST" &&
      request.url === "/internal/admissions" &&
      admissions &&
      config.admissionToken
    ) {
      if (!authorized(request, config.admissionToken)) {
        json(response, 401, { ok: false, error: "unauthorized" });
        return;
      }
      if (
        !(request.headers["content-type"] ?? "")
          .toLowerCase()
          .startsWith("application/json")
      ) {
        json(response, 415, { ok: false, error: "content_type_invalid" });
        return;
      }
      void readJsonBody(request)
        .then(admissionRecord)
        .then(async (record) => {
          if (!record) {
            json(response, 400, { ok: false, error: "admission_invalid" });
            return;
          }
          await admissions.allow(record.pubkey);
          json(response, 200, {
            ok: true,
            status: "allowed",
            pubkey: record.pubkey,
          });
        })
        .catch((error: unknown) => {
          const capacityExceeded =
            error instanceof Error &&
            error.message === "relay_admission_store_capacity_exceeded";
          return json(response, capacityExceeded ? 503 : 400, {
            ok: false,
            error: capacityExceeded
              ? "admission_capacity_exceeded"
              : "admission_invalid",
          });
        });
      return;
    }
    if (request.method === "GET" && request.url === "/healthz") {
      response.writeHead(200, {
        "content-type": "application/json",
        "cache-control": "no-store",
      });
      response.end(
        JSON.stringify({ ok: true, name: config.name, events: store.count() })
      );
      return;
    }
    if (request.method === "GET" && request.url === websocketPath) {
      response.writeHead(200, {
        "content-type": "application/nostr+json",
        "cache-control": "no-store",
      });
      response.end(
        JSON.stringify({
          name: config.name,
          supported_nips: [1],
          software: "roebel-staging-relay",
        })
      );
      return;
    }
    response.writeHead(404, { "content-type": "text/plain" });
    response.end("not found");
  });
  const sockets = new Set<WebSocket>();
  const websocket = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_FRAME_BYTES,
  });
  server.on("upgrade", (request, socket, head) => {
    if (request.url !== websocketPath) {
      socket.destroy();
      return;
    }
    websocket.handleUpgrade(request, socket, head, (client) =>
      websocket.emit("connection", client, request)
    );
  });
  websocket.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("message", async (raw) => {
      const text = frameText(raw);
      if (text === null || Buffer.byteLength(text, "utf8") > MAX_FRAME_BYTES) {
        socket.close(1009, "frame too large");
        return;
      }
      let message: unknown;
      try {
        message = JSON.parse(text);
      } catch {
        send(socket, ["NOTICE", "invalid: JSON"]);
        return;
      }
      if (!Array.isArray(message) || typeof message[0] !== "string") {
        send(socket, ["NOTICE", "invalid: frame"]);
        return;
      }
      if (message[0] === "EVENT") {
        const event = message[1];
        const id =
          isPlainObject(event) && typeof event.id === "string" ? event.id : "";
        const decision = await store.publish(event);
        send(socket, ["OK", id, decision.ok, decision.message]);
        return;
      }
      if (message[0] === "REQ") {
        const subscriptionId = message[1];
        const rawFilters = message.slice(2);
        if (
          typeof subscriptionId !== "string" ||
          subscriptionId.length < 1 ||
          subscriptionId.length > 64 ||
          rawFilters.length < 1 ||
          rawFilters.length > MAX_FILTERS
        ) {
          send(socket, [
            "CLOSED",
            typeof subscriptionId === "string" ? subscriptionId : "",
            "invalid: subscription",
          ]);
          return;
        }
        const filters = rawFilters.map(normalizeFilter);
        if (filters.some((filter) => filter === null)) {
          send(socket, ["CLOSED", subscriptionId, "invalid: filter"]);
          return;
        }
        for (const event of store.query(filters as Filter[]))
          send(socket, ["EVENT", subscriptionId, event]);
        send(socket, ["EOSE", subscriptionId]);
        return;
      }
      if (message[0] !== "CLOSE")
        send(socket, ["NOTICE", "unsupported: frame"]);
    });
  });

  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(config.port, config.bindHost, () => {
      server.off("error", reject);
      resolveListen();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("relay_listener_invalid");

  return {
    port: address.port,
    store,
    close: async () => {
      for (const socket of sockets) socket.close(1001, "server shutdown");
      await new Promise<void>((resolveClose, reject) => {
        websocket.close(() =>
          server.close((error) => (error ? reject(error) : resolveClose()))
        );
      });
    },
  };
}
