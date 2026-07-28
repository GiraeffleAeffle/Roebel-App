import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildNoteEvent, deriveNostrSecretKey } from "@netizen-labs/nostr";
import { MAX_LIMIT, buildEventQuery, toRow } from "../src/query.js";
import { queryFromUrl } from "../src/api.js";

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
