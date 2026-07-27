import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  loadRoebelSyntheticLifecycleReceipt,
  ROEBEL_SYNTHETIC_LIFECYCLE_STAGE_IDS,
  StadtstackFederationError,
} from "./index";

const BASE_URL = "https://stadtstack.example";
const R4_BODY = readFileSync(
  new URL("./syntheticLifecycleReceipt.fixture.json", import.meta.url),
  "utf8"
).trimEnd();

function response(
  body = R4_BODY,
  headers: Record<string, string> = {}
): Response {
  return new Response(body, {
    headers: {
      "content-type": "application/json",
      "x-stadtstack-truth-state": "demo",
      "x-stadtstack-authority": "none",
      "x-stadtstack-review-state": "synthetic_demo",
      ...headers,
    },
  });
}

test("loads only the exact sealed R4 synthetic lifecycle receipt", async () => {
  let requestedUrl = "";
  let init: RequestInit | undefined;
  const result = await loadRoebelSyntheticLifecycleReceipt({
    baseUrl: BASE_URL,
    fetch: (async (input: RequestInfo | URL, requestInit?: RequestInit) => {
      requestedUrl = String(input);
      init = requestInit;
      return response();
    }) as typeof fetch,
  });

  assert.equal(
    requestedUrl,
    `${BASE_URL}/api/demo/roebel-marienfelder/lifecycle-receipt`
  );
  assert.equal(init?.method, "GET");
  assert.equal(init?.credentials, "omit");
  assert.equal(init?.redirect, "error");
  assert.deepEqual(
    result.stages.map((stage) => stage.id),
    ROEBEL_SYNTHETIC_LIFECYCLE_STAGE_IDS
  );
  assert.equal(result.participation.totalAccepted, 0);
  assert.equal(result.publicProjection.recommendation, null);
  assert.ok(Object.values(result.effects).every((effect) => effect === false));
});

test("rejects any semantically valid-looking byte drift", async () => {
  const changed = JSON.parse(R4_BODY) as {
    stages: Array<{ owner: string }>;
  };
  changed.stages[0]!.owner = "Another synthetic owner";

  await assert.rejects(
    loadRoebelSyntheticLifecycleReceipt({
      baseUrl: BASE_URL,
      fetch: (async () => response(JSON.stringify(changed))) as typeof fetch,
    }),
    (error: unknown) =>
      error instanceof StadtstackFederationError &&
      error.code === "contract_mismatch"
  );
});

test("rejects widened authority or review headers", async () => {
  for (const headers of [
    { "x-stadtstack-authority": "confirmed" },
    { "x-stadtstack-review-state": "reviewed" },
    { "x-stadtstack-truth-state": "reviewed" },
  ]) {
    await assert.rejects(
      loadRoebelSyntheticLifecycleReceipt({
        baseUrl: BASE_URL,
        fetch: (async () => response(R4_BODY, headers)) as typeof fetch,
      }),
      (error: unknown) =>
        error instanceof StadtstackFederationError &&
        error.code === "contract_mismatch"
    );
  }
});

test("confines the lifecycle receipt to a safe provider origin", async () => {
  for (const unsafe of [
    "https://stadtstack.example/base",
    "https://user:secret@stadtstack.example",
    "http://stadtstack.example",
  ]) {
    await assert.rejects(
      loadRoebelSyntheticLifecycleReceipt({ baseUrl: unsafe }),
      (error: unknown) =>
        error instanceof StadtstackFederationError &&
        error.code === "configuration"
    );
  }
});
