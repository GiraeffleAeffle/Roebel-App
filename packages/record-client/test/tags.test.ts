import { test } from "node:test";
import assert from "node:assert/strict";
import { tagValue, tagValues, dTag, dSuffix } from "../src/index";
import type { RecordEvent } from "../src/index";

const ev = (tags: string[][], content = ""): RecordEvent => ({
  id: "id",
  pubkey: "pubkey",
  kind: 1,
  created_at: 0,
  content,
  tags,
  sig: "sig",
  node_id: "roebel",
  source: "index",
});

test("tagValue returns the first value of the first matching tag", () => {
  const e = ev([["t", "kino"], ["title", "Seefest"]]);
  assert.equal(tagValue(e, "title"), "Seefest");
});

test("tagValue returns null when the tag is absent", () => {
  const e = ev([["t", "kino"]]);
  assert.equal(tagValue(e, "title"), null);
});

test("tagValue returns null for a malformed tag with no value", () => {
  const e = ev([["d"]]);
  assert.equal(tagValue(e, "d"), null);
});

test("tagValues returns every value for a repeated tag, in order", () => {
  const e = ev([["t", "kino"], ["t", "familie"], ["title", "Seefest"]]);
  assert.deepEqual(tagValues(e, "t"), ["kino", "familie"]);
});

test("tagValues returns an empty array when the tag is absent", () => {
  const e = ev([["title", "Seefest"]]);
  assert.deepEqual(tagValues(e, "t"), []);
});

test("dTag returns the event's d tag value", () => {
  const e = ev([["d", "event:123"]]);
  assert.equal(dTag(e), "event:123");
});

test("dTag returns null when there is no d tag", () => {
  const e = ev([["title", "Seefest"]]);
  assert.equal(dTag(e), null);
});

test("dSuffix strips a matching prefix", () => {
  const e = ev([["d", "event:123"]]);
  assert.equal(dSuffix(e, "event"), "123");
});

test("dSuffix returns null when the prefix does not match", () => {
  const e = ev([["d", "movie:123"]]);
  assert.equal(dSuffix(e, "event"), null);
});

test("dSuffix returns null when there is no d tag at all", () => {
  const e = ev([["title", "Seefest"]]);
  assert.equal(dSuffix(e, "event"), null);
});

test("dSuffix returns null for a malformed d tag with no value", () => {
  const e = ev([["d"]]);
  assert.equal(dSuffix(e, "event"), null);
});
