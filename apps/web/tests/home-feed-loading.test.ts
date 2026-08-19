import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

import { settleHomeFeedAncillary } from "../src/lib/home-feed-loading";

const appPage = readFileSync(
  new URL("../src/app/app/page.tsx", import.meta.url),
  "utf8"
);

test("ordinary public posts are started before ancillary home-feed reads", () => {
  const postsStart = appPage.indexOf("getPublicFeedPosts({");
  const firstAncillaryRead = appPage.indexOf('.from("service_alerts")');

  assert.notEqual(postsStart, -1);
  assert.notEqual(firstAncillaryRead, -1);
  assert.ok(
    postsStart < firstAncillaryRead,
    "the ordinary feed must not wait for service alerts before requesting posts"
  );
  assert.match(appPage, /settleHomeFeedAncillary/);
});

test("an ancillary failure does not erase posts that already loaded", () => {
  assert.doesNotMatch(
    appPage,
    /app_feed_load_failed[\s\S]*setFeedItems\(\[\]\);[\s\S]*setPosts\(\[\]\)/
  );
});

test("a stalled ancillary read settles without holding the home feed", async () => {
  const started = Date.now();
  const value = await settleHomeFeedAncillary(
    new Promise<never>(() => undefined),
    [],
    20
  );

  assert.deepEqual(value, []);
  assert.ok(
    Date.now() - started < 250,
    "the ancillary deadline must be bounded"
  );
});

test("a failed ancillary read returns its safe fallback", async () => {
  const value = await settleHomeFeedAncillary(
    Promise.reject(new Error("gateway unavailable")),
    { items: [] },
    20
  );

  assert.deepEqual(value, { items: [] });
});
