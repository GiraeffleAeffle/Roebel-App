import assert from "node:assert/strict";
import { test } from "node:test";
import {
  STADTSTACK_STAGING_REQUEST_TIMEOUT_MS,
  STADTSTACK_STAGING_UNAVAILABLE_MESSAGE,
  StagingUnavailableError,
  stagingGet,
  stagingPost,
} from "../src/lib/stadtstack/staging-api";

const originalFetch = globalThis.fetch;
const originalClearTimeout = globalThis.clearTimeout;

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.clearTimeout = originalClearTimeout;
});

test("staging GET converts a transport abort into a stable unavailable error", async () => {
  let requestSignal: AbortSignal | undefined;
  globalThis.fetch = (async (_input, init) => {
    requestSignal = init?.signal;
    throw new DOMException("The operation was aborted", "AbortError");
  }) as typeof fetch;

  await assert.rejects(stagingGet("/feed"), (error: unknown) => {
    assert.ok(error instanceof StagingUnavailableError);
    assert.equal(error.code, "STADTSTACK_STAGING_UNAVAILABLE");
    assert.equal(error.message, STADTSTACK_STAGING_UNAVAILABLE_MESSAGE);
    return true;
  });
  assert.ok(requestSignal instanceof AbortSignal);
});

test("staging GET converts malformed JSON into the same unavailable error", async () => {
  globalThis.fetch = (async () =>
    new Response("not-json", {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;

  await assert.rejects(stagingGet("/feed"), (error: unknown) => {
    assert.ok(error instanceof StagingUnavailableError);
    assert.equal(error.message, STADTSTACK_STAGING_UNAVAILABLE_MESSAGE);
    return true;
  });
});

test("staging HTTP errors and POST admission boundaries remain unchanged", async () => {
  globalThis.fetch = (async (_input, init) => {
    assert.equal(init?.method, "POST");
    assert.equal(
      init?.headers &&
        (init.headers as Record<string, string>)["content-type"],
      "application/json"
    );
    assert.equal(
      init?.headers &&
        (init.headers as Record<string, string>)["x-stadtstack-e2e"],
      "1"
    );
    assert.equal(init?.body, JSON.stringify({ profile: "public" }));
    assert.ok(init?.signal instanceof AbortSignal);
    return new Response(JSON.stringify({ error: "boundary rejected" }), {
      status: 403,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  await assert.rejects(stagingPost("/view", { profile: "public" }), {
    message: "boundary rejected",
  });
});

test("staging requests clear the deadline after a response", async () => {
  let clearCount = 0;
  globalThis.clearTimeout = ((handle) => {
    clearCount += 1;
    return originalClearTimeout(handle);
  }) as typeof clearTimeout;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ ok: true }), { status: 200 })) as typeof fetch;

  await stagingGet<{ ok: boolean }>("/health");
  assert.equal(clearCount, 1);
});

test("staging requests use an explicit bounded deadline", () => {
  assert.equal(Number.isInteger(STADTSTACK_STAGING_REQUEST_TIMEOUT_MS), true);
  assert.ok(STADTSTACK_STAGING_REQUEST_TIMEOUT_MS > 0);
  assert.ok(STADTSTACK_STAGING_REQUEST_TIMEOUT_MS <= 10_000);
});
