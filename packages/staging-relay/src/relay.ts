import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createServer, type Server } from "node:http";
import { verifyEvent, type Filter, type NostrEvent } from "@netizen-labs/nostr";
import { WebSocketServer, type RawData, type WebSocket } from "ws";

const HEX_64 = /^[0-9a-f]{64}$/;
const MAX_FRAME_BYTES = 131_072;
const MAX_CONTENT_BYTES = 65_536;
const MAX_TAGS = 256;
const MAX_FILTERS = 8;
const MAX_QUERY_RESULTS = 500;

export interface RelayConfig {
  allowedPubkeys: readonly string[];
  bindHost: "127.0.0.1" | "0.0.0.0";
  name: string;
  port: number;
  storePath: string;
  websocketPath?: string;
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

function isEventShape(value: unknown): value is NostrEvent {
  if (!isPlainObject(value)) return false;
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
  ) return false;
  if (!HEX_64.test(value.id) || !HEX_64.test(value.pubkey) || !/^[0-9a-f]{128}$/.test(value.sig)) {
    return false;
  }
  if (value.tags.length > MAX_TAGS) return false;
  return value.tags.every(
    (tag) => Array.isArray(tag) && tag.length <= 32 && tag.every((part) => typeof part === "string"),
  );
}

function replacementKey(event: NostrEvent): string | null {
  if (event.kind === 0 || event.kind === 3 || (event.kind >= 10_000 && event.kind < 20_000)) {
    return `${event.pubkey}:${event.kind}:`;
  }
  if (event.kind >= 30_000 && event.kind < 40_000) {
    const d = event.tags.find((tag) => tag[0] === "d")?.[1] ?? "";
    return `${event.pubkey}:${event.kind}:${d}`;
  }
  return null;
}

function newerThan(left: NostrEvent, right: NostrEvent): boolean {
  return left.created_at > right.created_at ||
    (left.created_at === right.created_at && left.id.localeCompare(right.id) > 0);
}

function matchesTag(event: NostrEvent, key: string, expected: unknown): boolean {
  if (!key.startsWith("#") || key.length !== 2 || !Array.isArray(expected)) return false;
  const tagName = key.slice(1);
  const values = expected.filter((value): value is string => typeof value === "string");
  return values.length > 0 && event.tags.some((tag) => tag[0] === tagName && values.includes(tag[1] ?? ""));
}

function matchesFilter(event: NostrEvent, filter: Filter): boolean {
  if (filter.ids && !filter.ids.some((prefix) => event.id.startsWith(prefix))) return false;
  if (filter.authors && !filter.authors.some((prefix) => event.pubkey.startsWith(prefix))) return false;
  if (filter.kinds && !filter.kinds.includes(event.kind)) return false;
  if (filter.since !== undefined && event.created_at < filter.since) return false;
  if (filter.until !== undefined && event.created_at > filter.until) return false;
  for (const [key, value] of Object.entries(filter)) {
    if (key.startsWith("#") && !matchesTag(event, key, value)) return false;
  }
  return true;
}

function normalizeFilter(value: unknown): Filter | null {
  if (!isPlainObject(value)) return null;
  const allowed = new Set(["ids", "authors", "kinds", "since", "until", "limit"]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key) && !/^#[a-zA-Z]$/.test(key)) return null;
  }
  if (value.ids !== undefined && (!Array.isArray(value.ids) || !value.ids.every((v) => typeof v === "string"))) return null;
  if (value.authors !== undefined && (!Array.isArray(value.authors) || !value.authors.every((v) => typeof v === "string"))) return null;
  if (value.kinds !== undefined && (!Array.isArray(value.kinds) || !value.kinds.every(Number.isSafeInteger))) return null;
  for (const key of ["since", "until", "limit"] as const) {
    if (value[key] !== undefined && !Number.isSafeInteger(value[key])) return null;
  }
  return value as Filter;
}

export class PersistentEventStore {
  private readonly events = new Map<string, NostrEvent>();
  private readonly replacements = new Map<string, NostrEvent>();
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly storePath: string,
    private readonly allowedPubkeys: ReadonlySet<string>,
  ) {}

  async open(): Promise<void> {
    await mkdir(dirname(this.storePath), { recursive: true });
    let text = "";
    try {
      text = await readFile(this.storePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    for (const line of text.split("\n")) {
      if (!line) continue;
      try {
        const event: unknown = JSON.parse(line);
        if (isEventShape(event) && verifyEvent(event) && this.allowedPubkeys.has(event.pubkey)) {
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
    if (!isEventShape(value) || Buffer.byteLength(value.content, "utf8") > MAX_CONTENT_BYTES) {
      return { ok: false, message: "invalid: event shape" };
    }
    if (!verifyEvent(value)) return { ok: false, message: "invalid: signature" };
    if (!this.allowedPubkeys.has(value.pubkey)) return { ok: false, message: "blocked: author not allowed" };
    if (this.events.has(value.id)) return { ok: true, message: "duplicate: already stored" };

    const key = replacementKey(value);
    const current = key ? this.replacements.get(key) : undefined;
    if (current && !newerThan(value, current)) return { ok: true, message: "duplicate: superseded" };

    this.index(value);
    const line = `${JSON.stringify(value)}\n`;
    this.writeQueue = this.writeQueue.then(() => appendFile(this.storePath, line, { encoding: "utf8", mode: 0o600 }));
    await this.writeQueue;
    return { ok: true, message: "stored" };
  }

  query(filters: readonly Filter[]): NostrEvent[] {
    const collected = new Map<string, NostrEvent>();
    for (const filter of filters) {
      const matching = [...this.events.values()]
        .filter((event) => matchesFilter(event, filter))
        .sort((a, b) => b.created_at - a.created_at || b.id.localeCompare(a.id))
        .slice(0, Math.min(Math.max(filter.limit ?? MAX_QUERY_RESULTS, 0), MAX_QUERY_RESULTS));
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
  if (!config.name || config.name.length > 80) throw new Error("relay_name_invalid");
  if (!Number.isSafeInteger(config.port) || config.port < 0 || config.port > 65_535) throw new Error("relay_port_invalid");
  const allowed = new Set(config.allowedPubkeys.map((value) => value.toLowerCase()));
  if (allowed.size === 0 || [...allowed].some((value) => !HEX_64.test(value))) throw new Error("relay_allowlist_invalid");
  const store = new PersistentEventStore(resolve(config.storePath), allowed);
  await store.open();
  const websocketPath = config.websocketPath ?? "/";
  if (!/^\/[a-z0-9-]*$/.test(websocketPath)) throw new Error("relay_websocket_path_invalid");

  const server: Server = createServer((request, response) => {
    if (request.method === "GET" && request.url === "/healthz") {
      response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      response.end(JSON.stringify({ ok: true, name: config.name, events: store.count() }));
      return;
    }
    if (request.method === "GET" && request.url === websocketPath) {
      response.writeHead(200, { "content-type": "application/nostr+json", "cache-control": "no-store" });
      response.end(JSON.stringify({ name: config.name, supported_nips: [1], software: "roebel-staging-relay" }));
      return;
    }
    response.writeHead(404, { "content-type": "text/plain" });
    response.end("not found");
  });
  const sockets = new Set<WebSocket>();
  const websocket = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES });
  server.on("upgrade", (request, socket, head) => {
    if (request.url !== websocketPath) {
      socket.destroy();
      return;
    }
    websocket.handleUpgrade(request, socket, head, (client) => websocket.emit("connection", client, request));
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
        const id = isPlainObject(event) && typeof event.id === "string" ? event.id : "";
        const decision = await store.publish(event);
        send(socket, ["OK", id, decision.ok, decision.message]);
        return;
      }
      if (message[0] === "REQ") {
        const subscriptionId = message[1];
        const rawFilters = message.slice(2);
        if (typeof subscriptionId !== "string" || subscriptionId.length < 1 || subscriptionId.length > 64 || rawFilters.length < 1 || rawFilters.length > MAX_FILTERS) {
          send(socket, ["CLOSED", typeof subscriptionId === "string" ? subscriptionId : "", "invalid: subscription"]);
          return;
        }
        const filters = rawFilters.map(normalizeFilter);
        if (filters.some((filter) => filter === null)) {
          send(socket, ["CLOSED", subscriptionId, "invalid: filter"]);
          return;
        }
        for (const event of store.query(filters as Filter[])) send(socket, ["EVENT", subscriptionId, event]);
        send(socket, ["EOSE", subscriptionId]);
        return;
      }
      if (message[0] !== "CLOSE") send(socket, ["NOTICE", "unsupported: frame"]);
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
  if (!address || typeof address === "string") throw new Error("relay_listener_invalid");

  return {
    port: address.port,
    store,
    close: async () => {
      for (const socket of sockets) socket.close(1001, "server shutdown");
      await new Promise<void>((resolveClose, reject) => {
        websocket.close(() => server.close((error) => error ? reject(error) : resolveClose()));
      });
    },
  };
}
