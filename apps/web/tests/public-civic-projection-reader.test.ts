import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CivicProjectionNotFoundError,
  CivicProjectionUnavailableError,
  createCivicProjectionReader,
} from "../src/lib/server/civic-projection-reader.ts";

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
