import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LEDGER_SCHEMA_SQL, countByAuthor, insertLedgerSql, insertServingSql,
} from "../src/ledger.js";

test("schema creates ledger, serving log, passes and the accrual view", () => {
  for (const object of ["access_ledger", "serving_log", "firehose_passes", "metering_accruals"]) {
    assert.ok(LEDGER_SCHEMA_SQL.includes(object), `schema must define ${object}`);
  }
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
