import assert from "node:assert/strict";
import test from "node:test";

import {
  loadRoebelActivityJournalRuntimeProjection,
  StadtstackFederationError,
} from "./index";

const BASE_URL = "https://stadtstack.example";

function runtimeReceipt() {
  return {
    schemaVersion: "roebel_activity_journal_runtime_projection_v1",
    projectionId:
      "demo:roebel-mueritz:marienfelder-strasse:activity-journal-runtime:v1",
    caseKey: {
      municipalityId: "roebel-mueritz",
      decisionCaseSlug: "marienfelder-strasse",
      topicRef: "topic:roebel-mueritz:marienfelder-strasse",
      caseRef: "case:roebel-mueritz:marienfelder-strasse:v1",
    },
    truthState: "demo",
    authority: "none",
    checkpointObservedAt: "2026-07-24T08:27:35.000Z",
    checkpointFreshness: "historical_verified_receipt_not_live_health",
    notice:
      "Ein privates, metadata-only Activity Journal wurde für den synthetischen Demo-Fall technisch nachgewiesen. Dieser Nachweis ist kein aktueller Status der Verwaltung und veröffentlicht weder interne Ereignisinhalte noch Arbeitsräume.",
    runtime: {
      state: "technically_verified_synthetic",
      visibility: "administration_internal",
      metadataOnly: true,
      forwardOnly: true,
      backfilled: false,
      eventCount: 2,
      currentStateVerified: false,
      mcpReadOnlyToolCount: 4,
      publicProjectionState: "candidate_not_publicly_routed",
      publicEventCount: 0,
    },
    durability: {
      backupCompleted: true,
      restorePerformed: false,
    },
    boundary: {
      internalEventContentPublic: false,
      internalMcpPublic: false,
      openProjectDataPublic: false,
      matrixDataPublic: false,
      civicEffect: false,
    },
  };
}

function response(value: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(value), {
    headers: {
      "content-type": "application/json",
      "x-stadtstack-truth-state": "demo",
      "x-stadtstack-authority": "none",
      "x-stadtstack-projection-freshness":
        "historical-verified-receipt-not-live-health",
      "x-stadtstack-private-journal": "not-public",
      "x-stadtstack-public-projection": "candidate-not-publicly-routed",
      ...headers,
    },
  });
}

test("loads only the exact public-safe historical Activity Journal receipt", async () => {
  let requestedUrl = "";
  let init: RequestInit | undefined;
  const result = await loadRoebelActivityJournalRuntimeProjection({
    baseUrl: BASE_URL,
    fetch: (async (input: RequestInfo | URL, requestInit?: RequestInit) => {
      requestedUrl = String(input);
      init = requestInit;
      return response(runtimeReceipt());
    }) as typeof fetch,
  });

  assert.equal(
    requestedUrl,
    `${BASE_URL}/api/demo/roebel-marienfelder/activity-journal/runtime-projection`
  );
  assert.equal(init?.method, "GET");
  assert.equal(init?.credentials, "omit");
  assert.equal(init?.redirect, "error");
  assert.equal(result.runtime.eventCount, 2);
  assert.equal(result.runtime.publicEventCount, 0);
  assert.equal(result.boundary.internalEventContentPublic, false);
  assert.equal(result.boundary.internalMcpPublic, false);
});

test("rejects widened or private Journal-shaped response data", async () => {
  for (const changed of [
    { ...runtimeReceipt(), workspaceRoomId: "!private:matrix.example" },
    {
      ...runtimeReceipt(),
      boundary: {
        ...runtimeReceipt().boundary,
        internalMcpPublic: true,
      },
    },
    {
      ...runtimeReceipt(),
      runtime: {
        ...runtimeReceipt().runtime,
        eventCount: 3,
      },
    },
  ]) {
    await assert.rejects(
      loadRoebelActivityJournalRuntimeProjection({
        baseUrl: BASE_URL,
        fetch: (async () => response(changed)) as typeof fetch,
      }),
      (error: unknown) =>
        error instanceof StadtstackFederationError &&
        error.code === "invalid_schema"
    );
  }
});

test("rejects a response which does not prove its private historical boundary", async () => {
  await assert.rejects(
    loadRoebelActivityJournalRuntimeProjection({
      baseUrl: BASE_URL,
      fetch: (async () =>
        response(runtimeReceipt(), {
          "x-stadtstack-public-projection": "publicly-routed",
        })) as typeof fetch,
    }),
    (error: unknown) =>
      error instanceof StadtstackFederationError &&
      error.code === "contract_mismatch"
  );
});

test("confines the historical receipt to a safe provider origin", async () => {
  for (const unsafe of [
    "https://stadtstack.example/base",
    "https://user:secret@stadtstack.example",
    "http://stadtstack.example",
  ]) {
    await assert.rejects(
      loadRoebelActivityJournalRuntimeProjection({ baseUrl: unsafe }),
      (error: unknown) =>
        error instanceof StadtstackFederationError &&
        error.code === "configuration"
    );
  }
});
