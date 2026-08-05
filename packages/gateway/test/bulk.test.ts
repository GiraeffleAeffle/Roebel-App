import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BULK_MAX_LIMIT, buildBulkQuery, decodeCursor, encodeCursor, nextCursor,
} from "../src/bulk.js";
import { loadExclusions } from "../src/exclusions.js";

test("cursor round-trips and rejects garbage", () => {
  const cursor = { until: 1_754_000_000, afterId: "ab".repeat(32) };
  assert.deepEqual(decodeCursor(encodeCursor(cursor)), cursor);
  assert.equal(decodeCursor("!!!"), null);
  assert.equal(decodeCursor(null), null);
});

test("bulk query clamps the limit to BULK_MAX_LIMIT", () => {
  const built = buildBulkQuery({ limit: 999_999 }, null, new Set());
  assert.equal(built.values.at(-1), BULK_MAX_LIMIT);
});

test("a cursor becomes a keyset clause, not OFFSET", () => {
  const built = buildBulkQuery({}, { until: 100, afterId: "aa" }, new Set());
  assert.match(built.text, /created_at < \$/);
  assert.match(built.text, /id > \$/);
  assert.ok(!/OFFSET/i.test(built.text));
});

test("excluded authors are filtered out of the SQL", () => {
  const built = buildBulkQuery({}, null, new Set(["deadbeef"]));
  assert.match(built.text, /pubkey != ALL/);
  assert.ok(built.values.some((v) => Array.isArray(v) && v.includes("deadbeef")));
});

test("filters from EventQuery still apply (kinds + since)", () => {
  const built = buildBulkQuery({ kinds: [1, 30023], since: 5 }, null, new Set());
  assert.match(built.text, /kind = ANY/);
  assert.match(built.text, /created_at >= \$/);
});

test("nextCursor points past the last row, and ends cleanly", () => {
  const rows = [{ created_at: 9, id: "aa" }, { created_at: 8, id: "bb" }];
  const encoded = nextCursor(rows, 2);
  assert.deepEqual(decodeCursor(encoded), { until: 8, afterId: "bb" });
  assert.equal(nextCursor(rows, 3), null, "a short page means no more rows");
});

test("loadExclusions reads pubkeys, skips comments, tolerates a missing file", () => {
  const dir = mkdtempSync(join(tmpdir(), "gw-"));
  const file = join(dir, "metering-excluded.txt");
  writeFileSync(file, "# opted out\n" + "ab".repeat(32) + "\n\n# comment\n" + "CD".repeat(32) + "\n");
  const set = loadExclusions(file);
  assert.equal(set.size, 2);
  assert.ok(set.has("ab".repeat(32)));
  assert.ok(set.has("cd".repeat(32)), "pubkeys are lowercased");
  assert.equal(loadExclusions(join(dir, "missing.txt")).size, 0);
});
