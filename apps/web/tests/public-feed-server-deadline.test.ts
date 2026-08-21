import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  PUBLIC_FEED_SERVER_DEADLINE_MS,
  withPublicFeedServerDeadline,
} from "../src/lib/server/public-feed-deadline";

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("returns the reader value when it finishes before the deadline", async () => {
  const result = await withPublicFeedServerDeadline(
    () => Promise.resolve({ success: true, data: ["post"] }),
    50
  );

  assert.deepEqual(result, {
    timedOut: false,
    value: { success: true, data: ["post"] },
  });
});

test("returns a timeout result instead of waiting for a stalled reader", async () => {
  const startedAt = Date.now();
  const result = await withPublicFeedServerDeadline(
    () => new Promise(() => undefined),
    5
  );

  assert.deepEqual(result, { timedOut: true });
  assert.ok(Date.now() - startedAt < 250);
});

test("returns an unavailable result when the reader rejects", async () => {
  const result = await withPublicFeedServerDeadline(
    () => Promise.reject(new Error("reader unavailable")),
    50
  );

  assert.deepEqual(result, { timedOut: true });
});

test("returns an unavailable result when the reader throws synchronously", async () => {
  const result = await withPublicFeedServerDeadline(() => {
    throw new Error("reader unavailable");
  }, 50);

  assert.deepEqual(result, { timedOut: true });
});

test("uses a bounded production default", () => {
  assert.equal(PUBLIC_FEED_SERVER_DEADLINE_MS, 7_000);
});

test("all public feed GET routes fail closed with a no-store 503 on timeout", () => {
  const routes = [
    source("../src/app/api/public-feed/posts/route.ts"),
    source("../src/app/api/public-feed/posts/[id]/route.ts"),
    source("../src/app/api/public-feed/posts/[id]/comments/route.ts"),
  ];

  for (const route of routes) {
    assert.match(route, /withPublicFeedServerDeadline/);
    assert.match(route, /if \(outcome\.timedOut\)/);
    assert.match(route, /status: 503/);
    assert.match(route, /["']cache-control["']\s*:\s*["']no-store["']/);
  }
});

test("the post route keeps invalid IDs on the existing 404 path", () => {
  const route = source("../src/app/api/public-feed/posts/[id]/route.ts");
  assert.match(route, /PUBLIC_POST_ID\.test\(id\)/);
  assert.match(route, /status: 404/);
  assert.match(route, /status: result\.success \? 200 : 404/);
});
