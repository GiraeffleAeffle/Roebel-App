import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildEvent, buildNoteEvent, buildProfileEvent, deriveNostrSecretKey, type NostrEvent } from "@netizen-labs/nostr";
import { ingestAll, ingestSource, type IngestDeps, type Source } from "../src/ingest.js";
import { INSERT_IF_NEWEST_SQL, INSERT_SQL } from "../src/query.js";

const SECRET = deriveNostrSecretKey("0x" + "5c".repeat(65));
const OTHER = deriveNostrSecretKey("0x" + "7e".repeat(65));

const SOURCE: Source = { nodeId: "roebel", relay: "ws://strfry:7777", kinds: [0, 1] };

function deps(
  events: NostrEvent[],
  overrides: Partial<IngestDeps> = {},
): IngestDeps & { stored: unknown[][]; filters: Record<string, unknown>[] } {
  const stored: unknown[][] = [];
  const filters: Record<string, unknown>[] = [];
  return {
    stored,
    filters,
    insert: async (_sql: string, values: unknown[]) => {
      stored.push(values);
    },
    watermark: async () => null,
    makeClient: () => ({
      query: async (f: unknown[]) => {
        for (const filter of f) filters.push(filter as Record<string, unknown>);
        return events;
      },
      close: () => {},
    }),
    ...overrides,
  } as never;
}

describe("ingesting a relay", () => {
  it("stores signed events with their provenance", async () => {
    const d = deps([buildNoteEvent(SECRET, "eins"), buildNoteEvent(SECRET, "zwei")]);
    const result = await ingestSource(SOURCE, d);
    assert.equal(result.fetched, 2);
    assert.equal(result.stored, 2);
    assert.equal(d.stored[0][7], "roebel");
    assert.equal(d.stored[0][8], "ws://strfry:7777");
  });

  it("REJECTS an event whose signature does not verify", async () => {
    // The index is served publicly and cross-node. "This is genuinely signed by
    // that key" has to be something this node established, not inherited from a
    // peer's word.
    const good = buildNoteEvent(SECRET, "echt");
    const forged = { ...buildNoteEvent(OTHER, "gefälscht"), pubkey: good.pubkey };
    const d = deps([good, forged]);

    const result = await ingestSource(SOURCE, d);
    assert.equal(result.stored, 1);
    assert.equal(result.rejected, 1);
    assert.equal(d.stored.length, 1);
    assert.equal(d.stored[0][4], "echt");
  });

  it("resumes immutable kinds from the watermark, with an overlap so nothing falls in the gap", async () => {
    const d = deps([], { watermark: async () => 1_785_000_000 });
    await ingestSource(SOURCE, d);
    // SOURCE declares [0, 1]: one filter per kind.
    const noteFilter = d.filters.find((f) => (f.kinds as number[])[0] === 1)!;
    const since = noteFilter.since as number;
    assert.ok(since < 1_785_000_000, "must re-read a small overlap");
    assert.ok(since >= 1_785_000_000 - 600, "but not restart from the beginning");
  });

  it("replaceable kinds get NO watermark — their created_at is an edit time, not an arrival time", async () => {
    const d = deps([], { watermark: async () => 1_785_000_000 });
    await ingestSource(SOURCE, d);
    const profileFilter = d.filters.find((f) => (f.kinds as number[])[0] === 0)!;
    // An org profile new to the index can be "older" than one already seen; a
    // time window would starve it out forever. Bounded set, so full re-read.
    assert.equal(profileFilter.since, undefined);
  });

  it("reads everything on a first pass, when there is no watermark", async () => {
    const d = deps([]);
    await ingestSource(SOURCE, d);
    assert.equal(d.filters[0].since, undefined);
  });

  it("asks only for the kinds the source declares", async () => {
    const d = deps([]);
    await ingestSource({ ...SOURCE, kinds: [30023] }, d);
    assert.deepEqual(d.filters[0].kinds, [30023]);
  });
});

describe("a sweep over several sources", () => {
  it("keeps going when one relay is unreachable", async () => {
    // An unreachable peer is normal in a federation. Losing the whole sweep for
    // one of them would make the index quietly stale.
    const good = buildNoteEvent(SECRET, "from the reachable one");
    const d = deps([good], {
      makeClient: (url: string) => ({
        query: async () => {
          if (url.includes("down")) throw new Error("ECONNREFUSED");
          return [good];
        },
        close: () => {},
      }),
    } as never);

    const results = await ingestAll(
      [
        { nodeId: "peer", relay: "ws://down:7777", kinds: [1] },
        { nodeId: "roebel", relay: "ws://strfry:7777", kinds: [1] },
      ],
      d,
    );

    assert.equal(results.length, 2);
    assert.equal(results[0].stored, 0);
    assert.equal(results[1].stored, 1);
  });
});

describe("replaceable-event semantics (NIP-01)", () => {
  function sqlDeps(events: NostrEvent[]) {
    const calls: { sql: string; values: unknown[] }[] = [];
    const d = deps(events, {
      insert: async (sql: string, values: unknown[]) => {
        calls.push({ sql, values });
      },
    } as never);
    return { d, calls };
  }

  it("a kind 0 profile supersedes: delete-older then insert-if-newest", async () => {
    const profile = buildProfileEvent(SECRET, { name: "Mecky" });
    const { d, calls } = sqlDeps([profile]);
    await ingestSource(SOURCE, d);

    assert.equal(calls.length, 2);
    assert.match(calls[0].sql, /DELETE FROM nostr_events/);
    // Supersede key: (pubkey, kind, ""), NIP-01 order params (created_at, id).
    assert.deepEqual(calls[0].values, [profile.pubkey, 0, "", profile.created_at, profile.id]);
    assert.match(calls[1].sql, /NOT EXISTS/);
    // d_tag rides as the 10th column: "" for plain replaceable.
    assert.equal(calls[1].values[9], "");
  });

  it("a parameterised event is scoped by its d tag", async () => {
    const cal = buildEvent(SECRET, 31923, JSON.stringify({ title: "Kino" }), {
      tags: [["d", "screening-42"]],
    });
    const { d, calls } = sqlDeps([cal]);
    await ingestSource(SOURCE, d);

    assert.deepEqual(calls[0].values, [cal.pubkey, 31923, "screening-42", cal.created_at, cal.id]);
    assert.equal(calls[1].values[9], "screening-42");
  });

  it("a regular note stays immutable: single plain insert, NULL scope", async () => {
    const note = buildNoteEvent(SECRET, "immutable");
    const { d, calls } = sqlDeps([note]);
    await ingestSource(SOURCE, d);

    assert.equal(calls.length, 1);
    assert.doesNotMatch(calls[0].sql, /DELETE/);
    assert.equal(calls[0].values[9], null);
  });
});

describe("NIP-09 deletion requests", () => {
  function sqlDeps(events: NostrEvent[]) {
    const calls: { sql: string; values: unknown[] }[] = [];
    const d = deps(events, {
      insert: async (sql: string, values: unknown[]) => {
        calls.push({ sql, values });
      },
    } as never);
    return { d, calls };
  }

  it("records the hide state BEFORE dropping rows, then stores the request itself", async () => {
    const target = buildNoteEvent(SECRET, "wegdamit");
    const del = buildEvent(SECRET, 5, "", { tags: [["e", target.id]] });
    const { d, calls } = sqlDeps([del]);
    await ingestSource(SOURCE, d);

    assert.equal(calls.length, 3);
    assert.match(calls[0].sql, /INSERT INTO nostr_deletions/);
    assert.deepEqual(calls[0].values, [del.pubkey, target.id, del.created_at]);
    assert.match(calls[1].sql, /DELETE FROM nostr_events WHERE id = \$1 AND pubkey = \$2/);
    assert.deepEqual(calls[1].values, [target.id, del.pubkey]);
    // The request is part of the record.
    assert.match(calls[2].sql, /INSERT INTO nostr_events/);
  });

  it("address-form deletion covers versions up to the request, author-only", async () => {
    const del = buildEvent(SECRET, 5, "", {
      tags: [["a", `30018:${buildNoteEvent(SECRET, "x").pubkey}:listing:l-1`]],
    });
    const { d, calls } = sqlDeps([del]);
    await ingestSource(SOURCE, d);

    assert.match(calls[0].sql, /INSERT INTO nostr_deletions/);
    assert.deepEqual(calls[0].values, [del.pubkey, 30018, "listing:l-1", del.created_at]);
    assert.match(calls[1].sql, /created_at <= \$4/);
  });

  it("IGNORES an address deletion naming someone else's pubkey", async () => {
    const del = buildEvent(SECRET, 5, "", { tags: [["a", `30018:${"f".repeat(64)}:listing:l-1`]] });
    const { d, calls } = sqlDeps([del]);
    await ingestSource(SOURCE, d);
    // Only the kind 5 itself is stored; no deletion rows, no drops.
    assert.equal(calls.length, 1);
    assert.match(calls[0].sql, /INSERT INTO nostr_events/);
  });

  it("insert SQL guards against resurrection from a mirror", () => {
    assert.match(INSERT_SQL, /nostr_deletions/);
    assert.match(INSERT_IF_NEWEST_SQL, /nostr_deletions/);
  });
});
