import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CivicProjectionNotFoundError,
  CivicProjectionUnavailableError,
  createCivicProjectionReader,
} from "../src/lib/server/civic-projection-reader.ts";

import { loadPublicCivicPostLink } from "../src/lib/stadtstack/civic-projection-client.ts";

const ROOT = "a".repeat(64);
const MECKY = "b".repeat(64);

function response(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("forces the public feed profile and rejects synthetic records", async () => {
  const requests: string[] = [];
  const reader = createCivicProjectionReader({
    upstreamUrl: "http://workbench.test/stadtstack-test/api",
    fetchImpl: async (input) => {
      requests.push(String(input));
      return response({
        schemaVersion: "roebel_staging_mixed_feed_v1",
        posts: [],
        authorityBinding: "none",
      });
    },
  });

  assert.deepEqual(await reader.readPublicFeed(), {
    schemaVersion: "roebel_staging_mixed_feed_v1",
    posts: [],
    authorityBinding: "none",
  });
  assert.deepEqual(requests, [
    "http://workbench.test/stadtstack-test/api/feed?profile=public",
  ]);

  const synthetic = createCivicProjectionReader({
    upstreamUrl: "http://workbench.test/stadtstack-test/api",
    fetchImpl: async () =>
      response({
        schemaVersion: "roebel_staging_mixed_feed_v1",
        posts: [{ synthetic: true }],
        authorityBinding: "none",
      }),
  });
  await assert.rejects(
    synthetic.readPublicFeed(),
    CivicProjectionUnavailableError
  );
});

test("returns only the public instance identity and strips test personas", async () => {
  const reader = createCivicProjectionReader({
    upstreamUrl: "http://workbench.test/stadtstack-test/api",
    fetchImpl: async () =>
      response({
        schemaVersion: "roebel_e2e_workbench_config_v1",
        personas: [{ id: "synthetic", name: "Synthetic", publicKey: "c".repeat(64) }],
        meckyPubkey: MECKY,
        authorityBinding: "none",
      }),
  });

  assert.deepEqual(await reader.readInstance(), {
    schemaVersion: "roebel_e2e_workbench_config_v1",
    personas: [],
    meckyPubkey: MECKY,
    authorityBinding: "none",
  });
});

test("binds a discussion response to the requested root", async () => {
  const reader = createCivicProjectionReader({
    upstreamUrl: "http://workbench.test/stadtstack-test/api",
    fetchImpl: async () =>
      response({
        schemaVersion: "roebel_staging_argument_thread_v1",
        arguments: [],
        events: {},
        rootEvent: { id: "c".repeat(64) },
        authorityBinding: "none",
      }),
  });

  await assert.rejects(reader.readDiscussion(ROOT), CivicProjectionNotFoundError);
});

test("maps upstream absence and malformed authority to closed errors", async () => {
  const missing = createCivicProjectionReader({
    upstreamUrl: "http://workbench.test/stadtstack-test/api",
    fetchImpl: async () => response({}, 404),
  });
  await assert.rejects(missing.readPublicFeed(), CivicProjectionNotFoundError);

  const authority = createCivicProjectionReader({
    upstreamUrl: "http://workbench.test/stadtstack-test/api",
    fetchImpl: async () =>
      response({
        schemaVersion: "roebel_staging_mixed_feed_v1",
        posts: [],
        authorityBinding: "municipal",
      }),
  });
  await assert.rejects(
    authority.readPublicFeed(),
    CivicProjectionUnavailableError
  );
});


test("a six-second feed survives the former deadline while a stalled upstream still fails closed", async (t) => {
  // Drive time at the fetch boundary without a real twelve-second wait.
  t.mock.timers.enable({ apis: ["setTimeout"] });
  t.mock.method(AbortSignal, "timeout", (milliseconds: number) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException("Timed out", "TimeoutError")), milliseconds);
    return controller.signal;
  });
  const feed = { schemaVersion: "roebel_staging_mixed_feed_v1", posts: [], authorityBinding: "none" };
  const reader = createCivicProjectionReader({
    upstreamUrl: "http://workbench.test/api",
    fetchImpl: async (_url, init) => new Promise<Response>((resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      setTimeout(() => resolve(response(feed)), 6_300);
    }),
  });
  const completed = reader.readPublicFeed();
  t.mock.timers.tick(6_300);
  assert.deepEqual(await completed, feed);

  const stalled = createCivicProjectionReader({
    upstreamUrl: "http://workbench.test/api",
    fetchImpl: async (_url, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    }),
  });
  const rejected = assert.rejects(stalled.readPublicFeed(), CivicProjectionUnavailableError);
  t.mock.timers.tick(12_000);
  await rejected;
});


test("the browser leaves time for a slow successful server projection", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const link = { discussionId: ROOT };
  t.mock.method(globalThis, "fetch", async (_url: unknown, init?: RequestInit) => new Promise<Response>((resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    setTimeout(() => resolve(response({
      schemaVersion: "roebel_public_civic_post_link_v1",
      link,
      authorityBinding: "none",
    })), 11_000);
  }));
  const read = loadPublicCivicPostLink("789e5049-fa5a-4881-ab63-2b4239f9c2b0");
  t.mock.timers.tick(11_000);
  assert.deepEqual(await read, link);
});
