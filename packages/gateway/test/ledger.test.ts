import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LEDGER_SCHEMA_SQL, countByAuthor, insertLedgerSql, insertServingSql, nonceSeenSql,
  STATS_TOTALS_SQL, STATS_ENDPOINTS_SQL, TOP_ACCRUALS_SQL,
} from "../src/ledger.js";

test("schema creates ledger, serving log, passes and the accrual view", () => {
  for (const object of ["access_ledger", "serving_log", "firehose_passes", "metering_accruals"]) {
    assert.ok(LEDGER_SCHEMA_SQL.includes(object), `schema must define ${object}`);
  }
});

test("schema indexes nostr_events.indexed_at for the firehose poll", () => {
  assert.ok(
    LEDGER_SCHEMA_SQL.includes("CREATE INDEX IF NOT EXISTS idx_nostr_events_indexed_at ON nostr_events (indexed_at);"),
  );
});

test("the accrual view excludes unsettled (reconcile) sales from author accrual", () => {
  assert.ok(
    LEDGER_SCHEMA_SQL.includes("WHERE NOT l.reconcile"),
    "an unsettled sale must not count as author-earned revenue",
  );
});

test("nonceSeenSql checks a nonce against the ledger for replay protection", () => {
  const built = nonceSeenSql("0xabc");
  assert.match(built.text, /SELECT 1 FROM access_ledger WHERE nonce = \$1/);
  assert.deepEqual(built.values, ["0xabc"]);
});

test("insertLedgerSql binds every column and returns the id", () => {
  const built = insertLedgerSql({
    endpoint: "/bulk/events", payer: "0xpayer", amount: "500000",
    asset: "0xasset", network: "eip155:100", splitAuthors: 50,
    tx: "0xtx", nonce: "0xnonce", reconcile: false,
  });
  assert.match(built.text, /RETURNING id/);
  assert.equal(built.values.length, 9);
  assert.equal(built.values[2], "500000");
});

test("countByAuthor aggregates served rows per pubkey", () => {
  const counts = countByAuthor([{ pubkey: "a" }, { pubkey: "b" }, { pubkey: "a" }]);
  assert.equal(counts.get("a"), 2);
  assert.equal(counts.get("b"), 1);
});

test("insertServingSql expands to one row per author, null on empty", () => {
  const built = insertServingSql(7, new Map([["a", 2], ["b", 1]]));
  assert.ok(built);
  assert.equal((built.text.match(/\(\$/g) ?? []).length, 2, "two value tuples");
  assert.deepEqual(built.values, [7, "a", 2, 7, "b", 1]);
  assert.equal(insertServingSql(7, new Map()), null);
});

test("STATS_TOTALS_SQL counts requests and sums revenue, excluding unsettled sales", () => {
  assert.ok(STATS_TOTALS_SQL.includes("COUNT(*)::int AS requests"));
  assert.ok(STATS_TOTALS_SQL.includes("COALESCE(SUM(amount),0)::text"));
  assert.ok(STATS_TOTALS_SQL.includes("WHERE NOT reconcile"));
});

test("STATS_ENDPOINTS_SQL groups by endpoint, excluding unsettled sales", () => {
  assert.ok(STATS_ENDPOINTS_SQL.includes("GROUP BY endpoint"));
  assert.ok(STATS_ENDPOINTS_SQL.includes("COUNT(*)::int AS requests"));
  assert.ok(STATS_ENDPOINTS_SQL.includes("WHERE NOT reconcile"));
});

test("TOP_ACCRUALS_SQL orders numerically in subquery, not by text alias", () => {
  assert.ok(TOP_ACCRUALS_SQL.match(/FROM \(SELECT author, accrued_atomic FROM metering_accruals ORDER BY accrued_atomic DESC LIMIT 100\)/),
    "ORDER BY must be inside subquery targeting numeric column before ROUND cast");
  assert.ok(TOP_ACCRUALS_SQL.includes("ROUND(accrued_atomic)::text AS accrued_atomic"),
    "outer SELECT must cast numeric to text");
});
