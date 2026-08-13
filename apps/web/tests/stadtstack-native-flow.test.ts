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
  assert.match(feed, /signiertes Nostr · Testprofile/);
  assert.doesNotMatch(feed, /href=\{.*stadtstack-test/);
  assert.match(discussion, /Argumentbaum/);
  assert.match(discussion, /Sunburst/);
  assert.match(discussion, /@Mecky/);
});

test("renders discussions inside the normal feed controls and distinguishes mentions from answers", () => {
  assert.ok(appPage.indexOf("<FeedFilters") < appPage.indexOf("<StadtstackStagingFeed"));
  assert.match(appPage, /stadtstackStagingLab && \(activeFilter === "all" \|\| activeFilter === "latest" \|\| activeFilter === "posts"\)/);
  assert.doesNotMatch(feed, /Diskussion → Mecky → Verbesserungsvorschlag/);
  assert.match(feed, /Öffentliche Diskussionen/);
  assert.match(feed, /Mecky hat signiert geantwortet/);
  assert.match(feed, /Antwort ausstehend/);
});

test("labels the civic handoff and keeps vote and treasury authority disabled", () => {
  assert.match(discussion, /Verbesserungsvorschlag/);
  assert.match(discussion, /Citizen Brief/);
  assert.match(discussion, /Beratendes Meinungsbild/);
  assert.match(discussion, /Keine echte Abstimmung/);
  assert.match(discussion, /keine Auszahlung/i);
});

test("promotes the displayed signed discussion without publishing or polling a duplicate", () => {
  assert.match(discussion, /discussion: thread\.rootEvent/);
  assert.match(discussion, /answer: thread\.mecky\.event/);
  assert.match(discussion, /proposalPersona\.id/);
  assert.doesNotMatch(discussion, /stagingPost<[^>]+>\("\/discussion"/);
  assert.doesNotMatch(discussion, /\/reply\?parent=/);
});
