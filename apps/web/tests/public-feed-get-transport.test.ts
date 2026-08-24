import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

const appPage = source("../src/app/app/page.tsx");
const appFeed = source("../src/components/app/AppFeed.tsx");
const stadtFeed = source("../src/components/app/StadtFeed.tsx");
const detailPage = source("../src/app/app/posts/[id]/page.tsx");
const comments = source("../src/components/app/CommentSection.tsx");
const client = source("../src/lib/public-feed-client.ts");
const postRoute = source("../src/app/api/public-feed/posts/[id]/route.ts");
const feedRoute = source("../src/app/api/public-feed/posts/route.ts");
const stagingApi = source("../src/lib/stadtstack/staging-api.ts");

test("uses GET-only public feed transport instead of Next Server Actions", () => {
  for (const reader of [appPage, appFeed, stadtFeed]) {
    assert.match(reader, /getPublicFeedPosts/);
    assert.doesNotMatch(reader, /getPostsForFeed/);
  }
  assert.match(detailPage, /getPublicFeedPost/);
  assert.doesNotMatch(detailPage, /getPostById/);
  assert.match(comments, /getPublicFeedComments/);
  assert.doesNotMatch(comments, /getComments/);
  assert.match(client, /fetch\(`\/api\/public-feed/);
  assert.match(client, /cache: "no-store"/);
  assert.match(feedRoute, /export async function GET/);
  assert.match(postRoute, /export async function GET/);
});

test("resolves a legacy staging source ID and always clears the detail skeleton", () => {
  assert.match(stagingApi, /findStagingPostMirror/);
  assert.match(stagingApi, /post\.sourceAppPostId === sourceAppPostId/);
  assert.match(detailPage, /findStagingPostMirror\(feed\.posts, id\)/);
  assert.match(detailPage, /StadtstackStagingPostDetail/);
  assert.match(detailPage, /finally \{\s*setIsLoading\(false\)/s);
  assert.match(detailPage, /Erneut laden/);
});

test("keeps staging reader dependencies stable across state updates", () => {
  const stableFlag =
    /const stagingEnabled = Boolean\(\s*resolveStadtstackStagingLab\(/s;
  const unstableObject =
    /const stagingEnabled = resolveStadtstackStagingLab\(/;

  assert.match(detailPage, stableFlag);
  assert.match(comments, stableFlag);
  assert.doesNotMatch(detailPage, unstableObject);
  assert.doesNotMatch(comments, unstableObject);
  assert.match(detailPage, /\[id, retry, stagingEnabled\]/);
  assert.match(comments, /\[postId, stagingEnabled\]/);
});

test("bounds a failed public-feed read and still attempts the labelled staging mirror", () => {
  assert.match(client, /export const PUBLIC_FEED_REQUEST_TIMEOUT_MS = \d+_\d+;/);
  assert.match(client, /new AbortController\(\)/);
  assert.match(client, /signal: controller\.signal/);
  assert.match(
    client,
    /setTimeout\(\s*\(\) => controller\.abort\(\),\s*PUBLIC_FEED_REQUEST_TIMEOUT_MS\s*\)/s
  );
  assert.match(client, /catch \{\s*return \{\s*success: false,/s);
  assert.match(detailPage, /async function loadStagingMirror\(\)/);
  assert.match(detailPage, /const stagingMirror = await loadStagingMirror\(\);/);
  assert.match(detailPage, /if \(stagingMirror\) \{\s*setStagingMirror\(stagingMirror\);\s*return;/s);
});

test("keeps the Talos server reader on the namespace-local public gateway", () => {
  const serverClient = source("../src/lib/supabase/server.ts");
  assert.match(serverClient, /ROEBEL_PUBLIC_SUPABASE_URL/);
  assert.match(serverClient, /ROEBEL_PUBLIC_SUPABASE_ANON_KEY/);
  assert.doesNotMatch(serverClient, /SERVICE_ROLE/);
});
