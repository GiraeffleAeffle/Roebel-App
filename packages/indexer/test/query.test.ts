import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildNoteEvent, deriveNostrSecretKey } from "@netizen-labs/nostr";
import { MAX_LIMIT, buildEventQuery, toRow } from "../src/query.js";
import { normaliseRow, queryFromUrl } from "../src/api.js";

const SECRET = deriveNostrSecretKey("0x" + "5c".repeat(65));

describe("query building", () => {
  it("binds every value instead of interpolating it", () => {
    // This endpoint is public by design, so a single interpolated value would be
    // an injection hole reachable by anyone.
    const built = buildEventQuery({
      q: "'; DROP TABLE nostr_events; --",
      authors: ["ABC"],
      kinds: [1],
      node: "roebel",
    });
    assert.ok(!built.text.includes("DROP TABLE"));
    assert.ok(built.values.includes("'; DROP TABLE nostr_events; --"));
    assert.ok(built.text.includes("$1"));
  });

  it("lowercases authors so a pubkey matches however it was typed", () => {
    const built = buildEventQuery({ authors: ["AbCdEf"] });
    assert.deepEqual(built.values[0], ["abcdef"]);
  });

  it("caps the limit — an unbounded public query is a denial of service", () => {
    const built = buildEventQuery({ limit: 100_000 });
    assert.ok(built.values.includes(MAX_LIMIT));
  });

  it("floors a nonsense limit rather than returning nothing", () => {
    assert.ok(buildEventQuery({ limit: -5 }).values.includes(1));
  });

  it("returns newest first — a feed question, not a scan", () => {
    assert.match(buildEventQuery({}).text, /ORDER BY created_at DESC/);
  });

  it("filters by node, which is what makes a cross-node answer attributable", () => {
    const built = buildEventQuery({ node: "testnode" });
    assert.match(built.text, /node_id = \$1/);
    assert.equal(built.values[0], "testnode");
  });

  it("an empty query is still valid SQL with no WHERE", () => {
    const built = buildEventQuery({});
    assert.ok(!built.text.includes("WHERE"));
  });

  it("ignores a whitespace-only search rather than matching nothing", () => {
    assert.ok(!buildEventQuery({ q: "   " }).text.includes("tsquery"));
  });
});

describe("proof lookup by id", () => {
  it("fetches exact events, bound not interpolated", () => {
    const built = buildEventQuery({ ids: ["AbC123"] });
    assert.match(built.text, /id = ANY\(\$1::text\[\]\)/);
    assert.deepEqual(built.values[0], ["abc123"]);
  });

  it("reads ids off the query string", () => {
    assert.deepEqual(queryFromUrl(new URL("http://x/events?ids=aa,bb")).ids, ["aa", "bb"]);
  });
});

describe("rows carry provenance", () => {
  it("stamps which node and which relay an event came from", () => {
    const event = buildNoteEvent(SECRET, "Straßenfest", { createdAt: 1_785_000_000 });
    const row = toRow(event, "testnode", "ws://peer:7777");
    assert.equal(row[0], event.id);
    assert.equal(row[7], "testnode");
    assert.equal(row[8], "ws://peer:7777");
  });

  it("normalises the author key and serialises tags as JSON", () => {
    const event = { ...buildNoteEvent(SECRET, "x"), pubkey: "AABB" } as never;
    const row = toRow(event, "roebel", "ws://strfry:7777");
    assert.equal(row[1], "aabb");
    assert.equal(typeof row[5], "string");
    assert.deepEqual(JSON.parse(row[5] as string), []);
  });
});

describe("tag filters", () => {
  it("e filter becomes JSONB containment over ['e', id] pairs", () => {
    const { text, values } = buildEventQuery({ eTags: ["a".repeat(64)] });
    assert.match(text, /tags @> ANY\(\$1::jsonb\[\]\)/);
    assert.deepEqual(values[0], [JSON.stringify(["e", "a".repeat(64)])].map((p) => `[${p}]`));
  });

  it("d filter uses the d_tag column, not JSONB", () => {
    const { text, values } = buildEventQuery({ dTags: ["event:123", "news:456"] });
    assert.match(text, /d_tag = ANY\(\$1::text\[\]\)/);
    assert.deepEqual(values[0], ["event:123", "news:456"]);
  });

  it("p filter matches ['p', pubkey] pairs and lowercases", () => {
    const { text, values } = buildEventQuery({ pTags: ["B".repeat(64)] });
    assert.match(text, /tags @> ANY\(\$1::jsonb\[\]\)/);
    assert.deepEqual(values[0], [`[${JSON.stringify(["p", "b".repeat(64)])}]`]);
  });
});

describe("url parsing", () => {
  it("reads a full cross-node query off the query string", () => {
    const q = queryFromUrl(
      new URL("http://x/events?q=fest&kinds=1,30023&authors=aa,bb&since=100&until=200&node=roebel&limit=10"),
    );
    assert.equal(q.q, "fest");
    assert.deepEqual(q.kinds, [1, 30023]);
    assert.deepEqual(q.authors, ["aa", "bb"]);
    assert.equal(q.since, 100);
    assert.equal(q.node, "roebel");
    assert.equal(q.limit, 10);
  });

  it("ignores unparseable values instead of failing the request", () => {
    // A public API that 400s on a stray character is one agents route around.
    const q = queryFromUrl(new URL("http://x/events?kinds=abc&since=xyz"));
    assert.equal(q.kinds, undefined);
    assert.equal(q.since, undefined);
  });
});

describe("response types are stable whatever served the row", () => {
  it("coerces Postgres BIGINT strings to numbers", () => {
    // pg returns BIGINT as a string because it can exceed Number.MAX_SAFE_INTEGER.
    // Unix seconds never will, so the same event must not have two shapes
    // depending on whether the index or the relay fallback answered.
    const fromIndex = normaliseRow({ created_at: "1785251242", kind: 1, content: "x" });
    assert.equal(fromIndex.created_at, 1785251242);
    assert.equal(typeof fromIndex.created_at, "number");
  });

  it("leaves an already-numeric row untouched", () => {
    const fromRelay = normaliseRow({ created_at: 1785251242, kind: 1 });
    assert.equal(fromRelay.created_at, 1785251242);
  });

  it("never mangles content that merely looks numeric", () => {
    assert.equal(normaliseRow({ content: "1234", id: "99" }).content, "1234");
  });

  it("normalises the stats fields too", () => {
    const s = normaliseRow({ node_id: "roebel", count: 3, newest: "1785243476" });
    assert.equal(s.newest, 1785243476);
    assert.equal(s.node_id, "roebel");
  });
});
