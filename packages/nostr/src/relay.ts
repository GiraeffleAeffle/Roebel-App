import { bytesToHex } from "@noble/hashes/utils";
import type { NostrEvent } from "./events";

/**
 * A deliberately small NIP-01 relay client.
 *
 * NIP-01 is JSON over a WebSocket, and both Node 22 and React Native ship a
 * global `WebSocket` — so this needs no dependency at all. Keeping it dependency-
 * free is what lets the same package run in the Expo app, in a Node service on
 * the sovereign node, and in tests.
 */

export interface Filter {
  ids?: string[];
  authors?: string[];
  kinds?: number[];
  since?: number;
  until?: number;
  limit?: number;
  [tagFilter: string]: unknown;
}

type WebSocketLike = {
  readyState: number;
  send(data: string): void;
  close(): void;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onclose: ((event: unknown) => void) | null;
};

export interface RelayOptions {
  /** Injectable for tests and for runtimes without a global WebSocket. */
  webSocketFactory?: (url: string) => WebSocketLike;
  /** Default per-operation timeout. */
  timeoutMs?: number;
}

export interface PublishResult {
  ok: boolean;
  /** The relay's reason when it rejects — e.g. the CitizenNFT write-policy message. */
  message: string;
}

const OPEN = 1;

function randomSubscriptionId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

export class RelayClient {
  private socket: WebSocketLike | null = null;
  private connecting: Promise<WebSocketLike> | null = null;
  private readonly timeoutMs: number;
  private readonly okHandlers = new Map<string, (result: PublishResult) => void>();
  private readonly subscriptions = new Map<
    string,
    { events: NostrEvent[]; done: (events: NostrEvent[]) => void }
  >();

  constructor(
    readonly url: string,
    private readonly options: RelayOptions = {},
  ) {
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  private createSocket(url: string): WebSocketLike {
    if (this.options.webSocketFactory) return this.options.webSocketFactory(url);
    if (typeof WebSocket === "undefined") {
      throw new Error("no global WebSocket — pass options.webSocketFactory");
    }
    return new WebSocket(url) as unknown as WebSocketLike;
  }

  private connect(): Promise<WebSocketLike> {
    if (this.socket && this.socket.readyState === OPEN) return Promise.resolve(this.socket);
    if (this.connecting) return this.connecting;

    this.connecting = new Promise<WebSocketLike>((resolve, reject) => {
      let socket: WebSocketLike;
      try {
        socket = this.createSocket(this.url);
      } catch (error) {
        this.connecting = null;
        reject(error);
        return;
      }

      const timer = setTimeout(() => {
        this.connecting = null;
        try {
          socket.close();
        } catch {
          /* already closing */
        }
        reject(new Error(`relay ${this.url} did not connect within ${this.timeoutMs}ms`));
      }, this.timeoutMs);

      socket.onopen = () => {
        clearTimeout(timer);
        this.socket = socket;
        resolve(socket);
      };
      socket.onerror = () => {
        clearTimeout(timer);
        this.connecting = null;
        reject(new Error(`relay ${this.url} connection failed`));
      };
      socket.onclose = () => {
        this.socket = null;
        this.connecting = null;
        // Resolve every in-flight subscription with what it has, so a dropped
        // connection surfaces as partial data rather than a hung promise.
        for (const [id, sub] of this.subscriptions) {
          this.subscriptions.delete(id);
          sub.done(sub.events);
        }
      };
      socket.onmessage = (event) => this.handleMessage(event.data);
    });

    return this.connecting;
  }

  private handleMessage(raw: unknown): void {
    let message: unknown;
    try {
      message = JSON.parse(typeof raw === "string" ? raw : String(raw));
    } catch {
      return;
    }
    if (!Array.isArray(message)) return;

    const [type, ...rest] = message as [string, ...unknown[]];

    if (type === "OK") {
      const [id, ok, note] = rest as [string, boolean, string?];
      this.okHandlers.get(id)?.({ ok, message: note ?? "" });
      this.okHandlers.delete(id);
      return;
    }

    if (type === "EVENT") {
      const [subId, event] = rest as [string, NostrEvent];
      this.subscriptions.get(subId)?.events.push(event);
      return;
    }

    if (type === "EOSE" || type === "CLOSED") {
      const [subId] = rest as [string];
      const sub = this.subscriptions.get(subId);
      if (!sub) return;
      this.subscriptions.delete(subId);
      sub.done(sub.events);
    }
  }

  private send(socket: WebSocketLike, message: unknown[]): void {
    socket.send(JSON.stringify(message));
  }

  /**
   * Publish an event. Resolves with the relay's OK frame — a rejection is a
   * normal outcome here, not an exception: an un-allow-listed Citizen gets
   * `{ ok: false, message: "blocked: only Roebel CitizenNFT holders…" }`.
   */
  async publish(event: NostrEvent, timeoutMs = this.timeoutMs): Promise<PublishResult> {
    const socket = await this.connect();
    return new Promise<PublishResult>((resolve) => {
      const timer = setTimeout(() => {
        this.okHandlers.delete(event.id);
        resolve({ ok: false, message: "timeout waiting for relay OK" });
      }, timeoutMs);

      this.okHandlers.set(event.id, (result) => {
        clearTimeout(timer);
        resolve(result);
      });

      this.send(socket, ["EVENT", event]);
    });
  }

  /**
   * Run a REQ and collect events until EOSE (or the timeout).
   *
   * This is the read path for slice 1 — a chronological feed by kind + author +
   * time is exactly what a relay filter does, so no indexer is needed until the
   * queries outgrow filters (search, threading, cross-node).
   */
  async query(filters: Filter[], timeoutMs = this.timeoutMs): Promise<NostrEvent[]> {
    const socket = await this.connect();
    const subId = randomSubscriptionId();

    return new Promise<NostrEvent[]>((resolve) => {
      const finish = (events: NostrEvent[]) => {
        clearTimeout(timer);
        try {
          if (socket.readyState === OPEN) this.send(socket, ["CLOSE", subId]);
        } catch {
          /* socket already gone */
        }
        resolve(events);
      };

      const timer = setTimeout(() => {
        const sub = this.subscriptions.get(subId);
        this.subscriptions.delete(subId);
        finish(sub?.events ?? []);
      }, timeoutMs);

      this.subscriptions.set(subId, { events: [], done: finish });
      this.send(socket, ["REQ", subId, ...filters]);
    });
  }

  close(): void {
    try {
      this.socket?.close();
    } catch {
      /* already closed */
    }
    this.socket = null;
    this.connecting = null;
  }
}
