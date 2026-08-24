import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import {
  buildNoteEvent,
  buildProfileEvent,
  deriveNostrSecretKey,
  RelayClient,
} from "@netizen-labs/nostr";
import WebSocket from "ws";
import {
  PersistentEventStore,
  startRelay,
  type RunningRelay,
} from "../src/relay";

const CITIZEN = deriveNostrSecretKey(`0x${"a1".repeat(65)}`);
const OUTSIDER = deriveNostrSecretKey(`0x${"b2".repeat(65)}`);
const PUBKEY = buildNoteEvent(CITIZEN, "key", { createdAt: 1 }).pubkey;
const OUTSIDER_PUBKEY = buildNoteEvent(OUTSIDER, "key", {
  createdAt: 1,
}).pubkey;

describe("persistent staging relay", () => {
  it("refuses deterministic event-store overflow and rejects an over-limit durable store on restart", async () => {
    const root = await mkdtemp(join(tmpdir(), "roebel-relay-capacity-"));
    const path = join(root, "events.ndjson");
    const first = buildNoteEvent(CITIZEN, "erste Nachricht", {
      createdAt: 10,
    });
    const second = buildNoteEvent(CITIZEN, "zweite Nachricht", {
      createdAt: 11,
    });
    const limits = {
      maxBytes: 128 * 1024 * 1024,
      maxRecords: 1,
    };
    const store = new PersistentEventStore(path, new Set([PUBKEY]), limits);
    await store.open();
    assert.deepEqual(await store.publish(first), { ok: true, message: "stored" });
    assert.deepEqual(await store.publish(second), {
      ok: false,
      message: "blocked: store capacity",
    });

    const reopened = new PersistentEventStore(path, new Set([PUBKEY]), limits);
    await reopened.open();
    assert.deepEqual(reopened.query([{ kinds: [1] }]).map((event) => event.id), [
      first.id,
    ]);

    await writeFile(path, `${JSON.stringify(first)}\n${JSON.stringify(second)}\n`);
    await assert.rejects(
      new PersistentEventStore(path, new Set([PUBKEY]), limits).open(),
      /relay_event_store_capacity_exceeded/
    );
  });

  it("serializes concurrent capacity checks and keeps an append failure invisible", async () => {
    const root = await mkdtemp(join(tmpdir(), "roebel-relay-serialized-"));
    const capacityPath = join(root, "capacity.ndjson");
    const limits = {
      maxBytes: 128 * 1024 * 1024,
      maxRecords: 1,
    };
    const capacityStore = new PersistentEventStore(
      capacityPath,
      new Set([PUBKEY]),
      limits
    );
    await capacityStore.open();
    const [first, second] = await Promise.all([
      capacityStore.publish(buildNoteEvent(CITIZEN, "first", { createdAt: 10 })),
      capacityStore.publish(buildNoteEvent(CITIZEN, "second", { createdAt: 11 })),
    ]);
    assert.deepEqual([first, second], [
      { ok: true, message: "stored" },
      { ok: false, message: "blocked: store capacity" },
    ]);
    assert.equal(capacityStore.count(), 1);
    assert.equal((await readFile(capacityPath, "utf8")).trim().split("\n").length, 1);

    const failingPath = join(root, "append-fails.ndjson");
    const failingStore = new PersistentEventStore(
      failingPath,
      new Set([PUBKEY]),
      limits
    );
    await failingStore.open();
    await mkdir(failingPath);
    await assert.rejects(
      failingStore.publish(buildNoteEvent(CITIZEN, "not visible", { createdAt: 12 }))
    );
    assert.equal(failingStore.count(), 0);
    assert.deepEqual(failingStore.query([{ kinds: [1] }]), []);
  });

  it("stores only allow-listed, signature-valid events and reopens deterministically", async () => {
    const root = await mkdtemp(join(tmpdir(), "roebel-relay-"));
    const path = join(root, "events.ndjson");
    const store = new PersistentEventStore(path, new Set([PUBKEY]));
    await store.open();
    const event = buildNoteEvent(CITIZEN, "Diskussion", { createdAt: 10 });

    assert.deepEqual(await store.publish(event), {
      ok: true,
      message: "stored",
    });
    assert.equal(
      (
        await store.publish(
          buildNoteEvent(OUTSIDER, "fremd", { createdAt: 11 })
        )
      ).ok,
      false
    );
    assert.equal(
      (await store.publish({ ...event, content: "manipuliert" })).ok,
      false
    );
    assert.equal(
      (await store.publish({ ...event, untrusted: "unsigned" })).ok,
      false
    );
    assert.equal(
      store.query([{ kinds: [1], authors: [PUBKEY] }])[0]?.id,
      event.id
    );

    const reopened = new PersistentEventStore(path, new Set([PUBKEY]));
    await reopened.open();
    assert.equal(reopened.query([{ "#p": ["nobody"] }]).length, 0);
    assert.equal(reopened.query([{ kinds: [1] }])[0]?.id, event.id);
    assert.equal((await readFile(path, "utf8")).trim().split("\n").length, 1);
  });

  it("keeps only the newest replaceable profile", async () => {
    const root = await mkdtemp(join(tmpdir(), "roebel-relay-"));
    const store = new PersistentEventStore(
      join(root, "events.ndjson"),
      new Set([PUBKEY])
    );
    await store.open();
    const oldProfile = buildProfileEvent(
      CITIZEN,
      { name: "Alt" },
      { createdAt: 10 }
    );
    const newProfile = buildProfileEvent(
      CITIZEN,
      { name: "Neu" },
      { createdAt: 11 }
    );
    assert.equal((await store.publish(oldProfile)).ok, true);
    assert.equal((await store.publish(newProfile)).ok, true);
    assert.deepEqual(
      store.query([{ kinds: [0] }]).map((event) => event.id),
      [newProfile.id]
    );
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

    assert.deepEqual(await client.publish(event), {
      ok: true,
      message: "stored",
    });
    const result = await client.query([
      { kinds: [1], "#p": [OUTSIDER_PUBKEY] },
    ]);
    assert.deepEqual(
      result.map((entry) => entry.id),
      [event.id]
    );
    assert.equal(
      (
        await client.publish(
          buildNoteEvent(OUTSIDER, "nicht erlaubt", { createdAt: 101 })
        )
      ).ok,
      false
    );
    client.close();

    const health = await fetch(`http://127.0.0.1:${running.port}/healthz`).then(
      (response) => response.json()
    );
    assert.deepEqual(health, { ok: true, name: "citizen-test", events: 1 });
  });

  it("admits a verified staging pubkey only through the protected internal interface and persists it", async () => {
    const root = await mkdtemp(join(tmpdir(), "roebel-relay-admission-"));
    const storePath = join(root, "events.ndjson");
    const admissionStorePath = join(root, "admissions.ndjson");
    const admissionToken = "a".repeat(48);
    running = await startRelay({
      allowedPubkeys: [PUBKEY],
      admissionStorePath,
      admissionToken,
      bindHost: "127.0.0.1",
      name: "citizen-test",
      port: 0,
      storePath,
      websocketPath: "/citizen-relay",
    });
    let url = `ws://127.0.0.1:${running.port}/citizen-relay`;
    let client = new RelayClient(url, {
      webSocketFactory: (target) => new WebSocket(target) as never,
      timeoutMs: 2_000,
    });
    const outsiderEvent = buildNoteEvent(OUTSIDER, "real staging citizen", {
      createdAt: 200,
    });
    assert.equal((await client.publish(outsiderEvent)).ok, false);

    const unauthorized = await fetch(
      `http://127.0.0.1:${running.port}/internal/admissions`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          schemaVersion: "roebel_staging_relay_admission_v1",
          pubkey: OUTSIDER_PUBKEY,
        }),
      }
    );
    assert.equal(unauthorized.status, 401);

    const admitted = await fetch(
      `http://127.0.0.1:${running.port}/internal/admissions`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${admissionToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          schemaVersion: "roebel_staging_relay_admission_v1",
          pubkey: OUTSIDER_PUBKEY,
        }),
      }
    );
    assert.equal(admitted.status, 200);
    assert.deepEqual(await admitted.json(), {
      ok: true,
      status: "allowed",
      pubkey: OUTSIDER_PUBKEY,
    });
    assert.equal((await client.publish(outsiderEvent)).ok, true);
    client.close();
    await running.close();
    running = undefined;

    running = await startRelay({
      allowedPubkeys: [PUBKEY],
      admissionStorePath,
      admissionToken,
      bindHost: "127.0.0.1",
      name: "citizen-test",
      port: 0,
      storePath,
      websocketPath: "/citizen-relay",
    });
    url = `ws://127.0.0.1:${running.port}/citizen-relay`;
    client = new RelayClient(url, {
      webSocketFactory: (target) => new WebSocket(target) as never,
      timeoutMs: 2_000,
    });
    assert.deepEqual(
      (await client.query([{ ids: [outsiderEvent.id] }])).map(
        (event) => event.id
      ),
      [outsiderEvent.id]
    );
    client.close();
  });

  it("refuses admission-store overflow and refuses an over-limit admission file on restart", async () => {
    const root = await mkdtemp(join(tmpdir(), "roebel-relay-admission-capacity-"));
    const storePath = join(root, "events.ndjson");
    const admissionStorePath = join(root, "admissions.ndjson");
    const admissionToken = "a".repeat(48);
    running = await startRelay({
      allowedPubkeys: [PUBKEY],
      admissionStorePath,
      admissionToken,
      bindHost: "127.0.0.1",
      maxAdmissionCount: 1,
      maxEventCount: 1,
      name: "citizen-test",
      port: 0,
      storePath,
      websocketPath: "/citizen-relay",
    });
    const first = await fetch(
      `http://127.0.0.1:${running.port}/internal/admissions`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${admissionToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          schemaVersion: "roebel_staging_relay_admission_v1",
          pubkey: OUTSIDER_PUBKEY,
        }),
      }
    );
    assert.equal(first.status, 200);
    const anotherPubkey = buildNoteEvent(
      deriveNostrSecretKey(`0x${"c3".repeat(65)}`),
      "other",
      { createdAt: 1 }
    ).pubkey;
    const second = await fetch(
      `http://127.0.0.1:${running.port}/internal/admissions`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${admissionToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          schemaVersion: "roebel_staging_relay_admission_v1",
          pubkey: anotherPubkey,
        }),
      }
    );
    assert.equal(second.status, 503);
    await running.close();
    running = undefined;

    await writeFile(
      admissionStorePath,
      `${JSON.stringify({ schemaVersion: "roebel_staging_relay_admission_v1", pubkey: OUTSIDER_PUBKEY })}\n${JSON.stringify({ schemaVersion: "roebel_staging_relay_admission_v1", pubkey: anotherPubkey })}\n`
    );
    await assert.rejects(
      startRelay({
        allowedPubkeys: [PUBKEY],
        admissionStorePath,
        admissionToken,
        bindHost: "127.0.0.1",
        maxAdmissionCount: 1,
        name: "citizen-test",
        port: 0,
        storePath,
      }),
      /relay_admission_store_capacity_exceeded/
    );
  });

  it("reserves emptyDir headroom by rejecting relay-file budgets above 112 MiB", async () => {
    const root = await mkdtemp(join(tmpdir(), "roebel-relay-budget-"));
    await assert.rejects(
      startRelay({
        allowedPubkeys: [PUBKEY],
        admissionStorePath: join(root, "admissions.ndjson"),
        admissionToken: "a".repeat(48),
        bindHost: "127.0.0.1",
        maxAdmissionStoreBytes: 16 * 1024 * 1024,
        maxEventStoreBytes: 97 * 1024 * 1024,
        name: "citizen-test",
        port: 0,
        storePath: join(root, "events.ndjson"),
      }),
      /relay_persisted_budget_exceeded/
    );
  });
});
