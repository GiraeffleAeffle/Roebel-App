import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildNoteEvent } from "../src/events";
import { deriveNostrSecretKey } from "../src/keys";
import { RelayClient } from "../src/relay";

const SECRET_KEY = deriveNostrSecretKey(
  "0x" +
    "9c1f2b3a4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f8" +
    "1b2c3d4e5f60718293a4b5c6d7e8f9001a2b3c4d5e6f708192a3b4c5d6e7f809" +
    "1b",
);

/** A scripted stand-in for a relay: records what the client sends, replays frames back. */
class FakeSocket {
  readyState = 1;
  sent: unknown[][] = [];
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onclose: ((event: unknown) => void) | null = null;

  constructor(private readonly respond: (frame: unknown[], socket: FakeSocket) => void) {
    setTimeout(() => this.onopen?.({}), 0);
  }

  send(data: string): void {
    const frame = JSON.parse(data) as unknown[];
    this.sent.push(frame);
    this.respond(frame, this);
  }

  receive(frame: unknown[]): void {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }

  close(): void {
    this.readyState = 3;
    this.onclose?.({});
  }
}

function clientWith(respond: (frame: unknown[], socket: FakeSocket) => void) {
  let socket!: FakeSocket;
  const client = new RelayClient("wss://relay.test", {
    webSocketFactory: () => {
      socket = new FakeSocket(respond);
      return socket;
    },
    timeoutMs: 200,
  });
  return { client, socket: () => socket };
}

describe("publish", () => {
  it("sends an EVENT frame and resolves on OK", async () => {
    const { client, socket } = clientWith((frame, s) => {
      if (frame[0] === "EVENT") {
        const event = frame[1] as { id: string };
        setTimeout(() => s.receive(["OK", event.id, true, ""]), 0);
      }
    });
    const event = buildNoteEvent(SECRET_KEY, "Moin");
    const result = await client.publish(event);
    assert.deepEqual(result, { ok: true, message: "" });
    assert.equal(socket().sent[0][0], "EVENT");
  });

  it("surfaces a policy rejection as a result, not an exception", async () => {
    // This is the exact frame the live CitizenNFT write policy returns.
    const blocked = "blocked: only Roebel CitizenNFT holders may publish to this relay";
    const { client } = clientWith((frame, s) => {
      if (frame[0] === "EVENT") {
        const event = frame[1] as { id: string };
        setTimeout(() => s.receive(["OK", event.id, false, blocked]), 0);
      }
    });
    const result = await client.publish(buildNoteEvent(SECRET_KEY, "Moin"));
    assert.equal(result.ok, false);
    assert.equal(result.message, blocked);
  });

  it("resolves with a timeout result when the relay never answers", async () => {
    const { client } = clientWith(() => {});
    const result = await client.publish(buildNoteEvent(SECRET_KEY, "Moin"), 50);
    assert.equal(result.ok, false);
    assert.match(result.message, /timeout/);
  });
});

describe("query", () => {
  it("collects events until EOSE and closes the subscription", async () => {
    const first = buildNoteEvent(SECRET_KEY, "eins");
    const second = buildNoteEvent(SECRET_KEY, "zwei");
    const { client, socket } = clientWith((frame, s) => {
      if (frame[0] === "REQ") {
        const subId = frame[1] as string;
        setTimeout(() => {
          s.receive(["EVENT", subId, first]);
          s.receive(["EVENT", subId, second]);
          s.receive(["EOSE", subId]);
        }, 0);
      }
    });

    const events = await client.query([{ kinds: [1], limit: 10 }]);
    assert.deepEqual(
      events.map((e) => e.content),
      ["eins", "zwei"],
    );
    const frames = socket().sent.map((f) => f[0]);
    assert.ok(frames.includes("REQ"));
    assert.ok(frames.includes("CLOSE"), "must not leak the subscription");
  });

  it("returns what it has when the relay goes quiet", async () => {
    const only = buildNoteEvent(SECRET_KEY, "teilweise");
    const { client } = clientWith((frame, s) => {
      if (frame[0] === "REQ") {
        const subId = frame[1] as string;
        setTimeout(() => s.receive(["EVENT", subId, only]), 0);
      }
    });
    const events = await client.query([{ kinds: [1] }], 60);
    assert.equal(events.length, 1);
  });

  it("ignores frames for unknown subscriptions and malformed JSON", async () => {
    const { client } = clientWith((frame, s) => {
      if (frame[0] === "REQ") {
        const subId = frame[1] as string;
        setTimeout(() => {
          s.onmessage?.({ data: "not json" });
          s.receive(["EVENT", "some-other-sub", buildNoteEvent(SECRET_KEY, "fremd")]);
          s.receive(["NOTICE", "hello"]);
          s.receive(["EOSE", subId]);
        }, 0);
      }
    });
    assert.deepEqual(await client.query([{ kinds: [1] }]), []);
  });

  it("resolves pending queries when the connection drops", async () => {
    const { client } = clientWith((frame, s) => {
      if (frame[0] === "REQ") setTimeout(() => s.close(), 0);
    });
    assert.deepEqual(await client.query([{ kinds: [1] }]), []);
  });
});
