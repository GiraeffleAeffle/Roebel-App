import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const feed = readFileSync(
  new URL("../src/components/app/StadtstackStagingFeed.tsx", import.meta.url),
  "utf8",
);
const discussion = readFileSync(
  new URL("../src/components/app/StadtstackDiscussion.tsx", import.meta.url),
  "utf8",
);
const appPage = readFileSync(new URL("../src/app/app/page.tsx", import.meta.url), "utf8");

test("keeps the staging workflow native to the Röbel feed and discussion routes", () => {
  assert.match(appPage, /StadtstackStagingFeed/);
  assert.doesNotMatch(appPage, /StadtstackStagingLabCard/);
  assert.match(feed, /\/app\/diskussion\//);
  assert.match(feed, /Synthetische Testprofile/);
  assert.doesNotMatch(feed, /href=\{.*stadtstack-test/);
  assert.match(discussion, /Argumentbaum/);
  assert.match(discussion, /Sunburst/);
  assert.match(discussion, /@Mecky/);
});

test("labels the civic handoff and keeps vote and treasury authority disabled", () => {
  assert.match(discussion, /Verbesserungsvorschlag/);
  assert.match(discussion, /Citizen Brief/);
  assert.match(discussion, /Beratendes Meinungsbild/);
  assert.match(discussion, /Keine echte Abstimmung/);
  assert.match(discussion, /keine Auszahlung/i);
});
