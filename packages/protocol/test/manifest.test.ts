import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseManifest, safeParseManifest } from "../src/manifest.js";

const roebel = JSON.parse(
  readFileSync(fileURLToPath(new URL("../examples/roebel.netizen.json", import.meta.url)), "utf8"),
);

test("the Röbel dogfood manifest validates against the schema", () => {
  const m = parseManifest(roebel);
  assert.equal(m.id, "roebel");
  assert.equal(m.chain.chainId, 100);
  assert.equal(m.identity.relyingParties.length, 4);
  assert.equal(m.identity.federation.trustedIssuers.length, 0);
});

test("rejects an inline secret where a reference is required", () => {
  const bad = { ...roebel, chain: { ...roebel.chain, rpc: "not-a-url-and-not-a-ref" } };
  assert.equal(safeParseManifest(bad).success, false);
});

test("rejects a missing required section", () => {
  const bad = { ...roebel };
  delete (bad as Record<string, unknown>).identity;
  assert.equal(safeParseManifest(bad).success, false);
});

test("rejects an unknown nsp version", () => {
  const bad = { ...roebel, nsp: "99" };
  assert.equal(safeParseManifest(bad).success, false);
});

test("rejects treasury splits that do not sum to 100", () => {
  const bad = { ...roebel, treasury: { ...roebel.treasury, splits: { reserve: 50, ops: 30, dividend: 10 } } };
  assert.equal(safeParseManifest(bad).success, false);
});
