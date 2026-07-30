import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { verifyEvent, type NostrEvent } from "@netizen-labs/nostr";
import { publishOnce, type PublisherDeps } from "../src/sync.js";

const SECRET = "a-node-secret-with-plenty-of-entropy-0123456789";
const ORG_ID = "11111111-1111-1111-1111-111111111111";

const TABLES: Record<string, Record<string, unknown>[]> = {
  accounts: [
    {
      id: ORG_ID,
      account_type: "organisation",
      name: "Hafenverein",
      slug: "hafenverein",
      updated_at: "2026-07-28T12:00:00+00:00",
    },
  ],
  events: [
    {
      id: "ev-1",
      account_id: ORG_ID,
      title: "Seefest",
      date: "2026-08-14",
      time: "19:30:00",
      status: "approved",
      updated_at: "2026-07-30T10:00:00+00:00",
    },
  ],
  movies: [
    {
      id: "mv-1",
      title: "Das Boot",
      date: "2026-08-01",
      time: "20:00:00",
      status: "published",
      updated_at: "2026-07-29T08:00:00+00:00",
    },
  ],
};

function harness(result: { ok: boolean; message: string } = { ok: true, message: "" }) {
  const published: NostrEvent[] = [];
  const deps: PublisherDeps = {
    nodeSecret: SECRET,
    nodeId: "roebel",
    datasets: ["events", "cinema", "orgs"],
    fetchRows: async (table) => TABLES[table] ?? [],
    relayUrl: "ws://relay",
    makeClient: () => ({
      publish: async (event: NostrEvent) => {
        published.push(event);
        return result;
      },
      close: () => {},
    }),
  };
  return { deps, published };
}

describe("a publish pass", () => {
  it("publishes every dataset as verifiable signed events", async () => {
    const h = harness();
    const summary = await publishOnce(h.deps);

    assert.equal(summary.built, 3);
    assert.equal(summary.accepted, 3);
    for (const event of h.published) assert.equal(verifyEvent(event), true);
  });

  it("signs each scope with its own identity, and reports every key", async () => {
    const h = harness();
    const summary = await publishOnce(h.deps);

    const byKind = new Map(h.published.map((e) => [e.kind === 0 ? "org" : e.tags.find((t) => t[0] === "d")?.[1], e.pubkey]));
    // The org profile and the org's event share one identity; the cinema has its own.
    assert.equal(byKind.get("org"), byKind.get("event:ev-1"));
    assert.notEqual(byKind.get("movie:mv-1"), byKind.get("org"));
    assert.equal(summary.pubkeys.length, 2);
  });

  it("is idempotent: the same rows build the same event ids", async () => {
    const a = harness();
    const b = harness();
    await publishOnce(a.deps);
    await publishOnce(b.deps);
    assert.deepEqual(a.published.map((e) => e.id), b.published.map((e) => e.id));
  });

  it("an edited row replaces: same d, newer created_at, different id", async () => {
    const before = harness();
    await publishOnce(before.deps);

    const edited = { ...TABLES.events[0], title: "Seefest (verschoben)", updated_at: "2026-07-31T09:00:00+00:00" };
    const original = TABLES.events[0];
    TABLES.events[0] = edited;
    try {
      const after = harness();
      await publishOnce(after.deps);

      const oldEvent = before.published.find((e) => e.tags.some((t) => t[1] === "event:ev-1"))!;
      const newEvent = after.published.find((e) => e.tags.some((t) => t[1] === "event:ev-1"))!;
      assert.notEqual(oldEvent.id, newEvent.id);
      assert.ok(newEvent.created_at > oldEvent.created_at);
      assert.equal(oldEvent.pubkey, newEvent.pubkey);
    } finally {
      TABLES.events[0] = original;
    }
  });

  it("counts relay rejections instead of throwing", async () => {
    const h = harness({ ok: false, message: "blocked: not on allow-list" });
    const summary = await publishOnce(h.deps);
    assert.equal(summary.rejected, 3);
    assert.equal(summary.accepted, 0);
  });
});
