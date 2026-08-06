import { test } from "node:test";
import assert from "node:assert/strict";
import { buildExportBatchQuery, streamExport } from "../src/exportStream.js";
import { firehoseBatchQuery, mintPassSql, passLookupSql } from "../src/firehose.js";

test("export batches use keyset pagination and honour exclusions", () => {
  const built = buildExportBatchQuery([1], { until: 10, afterId: "aa" }, new Set(["ff".repeat(32)]));
  assert.match(built.text, /kind = ANY/);
  assert.match(built.text, /pubkey != ALL/);
  assert.match(built.text, /created_at < \$/);
});

test("streamExport walks every batch, writes NDJSON, returns author counts", async () => {
  const pages: Record<string, unknown>[][] = [
    [
      { id: "a1", pubkey: "p1", kind: 1, created_at: 9, content: "x", tags: [], sig: "s", node_id: "n", source: "r" },
      { id: "a2", pubkey: "p2", kind: 1, created_at: 8, content: "y", tags: [], sig: "s", node_id: "n", source: "r" },
    ],
    [],
  ];
  // The fake returns a FULL batch only if the page has batchSize rows — emulate
  // by passing batchSize implicitly: page 1 shorter than 5000 ends the loop.
  const lines: string[] = [];
  const counts = await streamExport({
    query: async () => pages.shift() ?? [],
    write: (line) => lines.push(line),
    excluded: new Set(),
  });
  assert.equal(lines.length, 2);
  assert.equal(JSON.parse(lines[0]).id, "a1");
  assert.deepEqual([counts.get("p1"), counts.get("p2")], [1, 1]);
});

test("pass SQL: mint inserts token with expiry, lookup selects it", () => {
  const mint = mintPassSql("tok", 3, 24);
  assert.match(mint.text, /INSERT INTO firehose_passes/);
  assert.deepEqual(mint.values, ["tok", 3, 24]);
  const lookup = passLookupSql("tok");
  assert.match(lookup.text, /expires_at > now\(\)/);
});

test("firehose batch filters on indexed_at watermark and exclusions", () => {
  const built = firehoseBatchQuery("2026-08-05T00:00:00Z", new Set(["aa".repeat(32)]));
  assert.match(built.text, /indexed_at > \$/);
  assert.match(built.text, /pubkey != ALL/);
  assert.match(built.text, /ORDER BY indexed_at ASC/);
});
