import assert from "node:assert/strict";
import { test } from "node:test";
import { deriveTitle } from "../src/lib/mecky/derive-title";

test("trims and collapses whitespace", () => {
  assert.equal(deriveTitle("   Hallo   Mecky  "), "Hallo Mecky");
});
test("truncates long input at a word boundary with an ellipsis", () => {
  const t = deriveTitle("Ich moechte die Geschichte unseres neuen Cafés am Hafen erzaehlen bitte");
  assert.ok(t.length <= 49);
  assert.ok(t.endsWith("…"));
});
test("falls back to Neuer Chat on empty input", () => {
  assert.equal(deriveTitle("   "), "Neuer Chat");
});
