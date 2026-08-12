import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { buildNoteEvent, buildProfileEvent, deriveNostrSecretKey, RelayClient } from "@netizen-labs/nostr";
import WebSocket from "ws";
import { PersistentEventStore, startRelay, type RunningRelay } from "../src/relay";

const CITIZEN = deriveNostrSecretKey(`0x${"a1".repeat(65)}`);
const OUTSIDER = deriveNostrSecretKey(`0x${"b2".repeat(65)}`);
const PUBKEY = buildNoteEvent(CITIZEN, "key", { createdAt: 1 }).pubkey;
const OUTSIDER_PUBKEY = buildNoteEvent(OUTSIDER, "key", { createdAt: 1 }).pubkey;

describe("persistent staging relay", () => {
  it("stores only allow-listed, signature-valid events and reopens deterministically", async () => {
    const root = await mkdtemp(join(tmpdir(), "roebel-relay-"));
    const path = join(root, "events.ndjson");
    const store = new PersistentEventStore(path, new Set([PUBKEY]));
    await store.open();
    const event = buildNoteEvent(CITIZEN, "Diskussion", { createdAt: 10 });

    assert.deepEqual(await store.publish(event), { ok: true, message: "stored" });
    assert.equal((await store.publish(buildNoteEvent(OUTSIDER, "fremd", { createdAt: 11 }))).ok, false);
    assert.equal((await store.publish({ ...event, content: "manipuliert" })).ok, false);
    assert.equal(store.query([{ kinds: [1], authors: [PUBKEY] }])[0]?.id, event.id);

    const reopened = new PersistentEventStore(path, new Set([PUBKEY]));
    await reopened.open();
    assert.equal(reopened.query([{ "#p": ["nobody"] }]).length, 0);
    assert.equal(reopened.query([{ kinds: [1] }])[0]?.id, event.id);
    assert.equal((await readFile(path, "utf8")).trim().split("\n").length, 1);
  });

  it("keeps only the newest replaceable profile", async () => {
    const root = await mkdtemp(join(tmpdir(), "roebel-relay-"));
    const store = new PersistentEventStore(join(root, "events.ndjson"), new Set([PUBKEY]));
    await store.open();
    const oldProfile = buildProfileEvent(CITIZEN, { name: "Alt" }, { createdAt: 10 });
    const newProfile = buildProfileEvent(CITIZEN, { name: "Neu" }, { createdAt: 11 });
    assert.equal((await store.publish(oldProfile)).ok, true);
    assert.equal((await store.publish(newProfile)).ok, true);
    assert.deepEqual(store.query([{ kinds: [0] }]).map((event) => event.id), [newProfile.id]);
  });
});

describe("NIP-01 websocket boundary", () => {
  let running: RunningRelay | undefined;
  afterEach(async () => {
    await running?.close();
    running = undefined;
  });

  it("publishes, queries, rejects an outsider, and exposes health", async () => {
    const root = await mkdtemp(join(tmpdir(), "roebel-relay-"));
    running = await startRelay({
      allowedPubkeys: [PUBKEY],
      bindHost: "127.0.0.1",
      name: "citizen-test",
      port: 0,
      storePath: join(root, "events.ndjson"),
      websocketPath: "/citizen-relay",
    });
    const url = `ws://127.0.0.1:${running.port}/citizen-relay`;
    const client = new RelayClient(url, {
      webSocketFactory: (target) => new WebSocket(target) as never,
      timeoutMs: 2_000,
    });
    const event = buildNoteEvent(CITIZEN, "@mecky Bitte prüfen", {
      createdAt: 100,
      tags: [["p", OUTSIDER_PUBKEY]],
    });

    assert.deepEqual(await client.publish(event), { ok: true, message: "stored" });
    const result = await client.query([{ kinds: [1], "#p": [OUTSIDER_PUBKEY] }]);
    assert.deepEqual(result.map((entry) => entry.id), [event.id]);
    assert.equal((await client.publish(buildNoteEvent(OUTSIDER, "nicht erlaubt", { createdAt: 101 }))).ok, false);
    client.close();

    const health = await fetch(`http://127.0.0.1:${running.port}/healthz`).then((response) => response.json());
    assert.deepEqual(health, { ok: true, name: "citizen-test", events: 1 });
  });
});
