import assert from "node:assert/strict";
import test from "node:test";

import {
  loadRoebelMarienfelderTopicContext,
  StadtstackFederationError,
} from "./index";

const BASE_URL = "https://stadtstack.example";

function context() {
  return {
    schemaVersion: "civic_topic_context_v1",
    topic: {
      topicId: "topic:roebel-mueritz:marienfelder-strasse",
      municipalityId: "roebel-mueritz",
      decisionCaseSlug: "marienfelder-strasse",
      title: "Marienfelder Straße",
      classification: "synthetic_demo_only",
      truthState: "demo",
      authority: "none",
    },
    externalProposalBinding: {
      system: "roebel_app_governance",
      status: "not_linked",
      proposalId: null,
      proposalNumber: null,
      reviewedBindingArtifactRef: null,
    },
    modules: {
      citizenVote: {
        status: "not_opened",
        method: null,
        result: null,
      },
      treasury: {
        status: "not_linked",
        currency: null,
        amount: null,
        snapshotAt: null,
      },
      councilRecord: {
        status: "source_records_unreviewed",
        formalDecisionEffect: false,
      },
      administration: {
        status: "synthetic_walkthrough_available",
        currentStateVerified: false,
      },
      activityJournal: {
        status: "reconstructed_synthetic_demo",
        historicalEvidence: true,
        currentStateVerified: false,
        backfilled: true,
        eventCount: 8,
        runtimeReceipt: {
          status: "historical_verified_private_runtime",
          checkpointObservedAt: "2026-07-24T08:27:35.000Z",
          eventCount: 2,
          backfilled: false,
          publicProjectionState: "candidate_not_publicly_routed",
        },
      },
    },
    effects: {
      citizenWrite: false,
      voteWrite: false,
      treasuryWrite: false,
      workspaceWrite: false,
      councilWrite: false,
      publication: false,
      civicCaseMutation: false,
      stageTransition: false,
      authorityConfirmation: false,
    },
  };
}

function response(value: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(value), {
    headers: {
      "content-type": "application/json",
      "x-stadtstack-truth-state": "demo",
      "x-stadtstack-authority": "none",
      "x-stadtstack-demo-scenario": "walkthrough",
      "x-stadtstack-visibility": "public_reviewed",
      "x-stadtstack-historical-evidence": "true",
      "x-stadtstack-current-state-verified": "false",
      "x-stadtstack-backfilled": "true",
      ...headers,
    },
  });
}

test("loads only the exact unbound Marienfelder Straße topic context", async () => {
  let requestedUrl = "";
  let init: RequestInit | undefined;
  const result = await loadRoebelMarienfelderTopicContext({
    baseUrl: BASE_URL,
    fetch: (async (input: RequestInfo | URL, requestInit?: RequestInit) => {
      requestedUrl = String(input);
      init = requestInit;
      return response(context());
    }) as typeof fetch,
  });

  assert.equal(
    requestedUrl,
    `${BASE_URL}/api/demo/roebel-marienfelder/topic-context`
  );
  assert.equal(init?.method, "GET");
  assert.equal(init?.credentials, "omit");
  assert.equal(init?.redirect, "error");
  assert.equal(result.externalProposalBinding.status, "not_linked");
  assert.equal(result.externalProposalBinding.proposalId, null);
});

test("rejects any attempted real proposal binding or effect", async () => {
  for (const changed of [
    {
      ...context(),
      externalProposalBinding: {
        ...context().externalProposalBinding,
        proposalId: "proposal-1",
      },
    },
    {
      ...context(),
      effects: { ...context().effects, voteWrite: true },
    },
  ]) {
    await assert.rejects(
      loadRoebelMarienfelderTopicContext({
        baseUrl: BASE_URL,
        fetch: (async () => response(changed)) as typeof fetch,
      }),
      (error: unknown) =>
        error instanceof StadtstackFederationError &&
        error.code === "invalid_schema"
    );
  }
});

test("rejects widened bodies and incomplete demo proof headers", async () => {
  await assert.rejects(
    loadRoebelMarienfelderTopicContext({
      baseUrl: BASE_URL,
      fetch: (async () =>
        response({ ...context(), proposalMatchHint: "title" })) as typeof fetch,
    }),
    (error: unknown) =>
      error instanceof StadtstackFederationError &&
      error.code === "invalid_schema"
  );

  await assert.rejects(
    loadRoebelMarienfelderTopicContext({
      baseUrl: BASE_URL,
      fetch: (async () =>
        response(context(), {
          "x-stadtstack-current-state-verified": "true",
        })) as typeof fetch,
    }),
    (error: unknown) =>
      error instanceof StadtstackFederationError &&
      error.code === "contract_mismatch"
  );
});

test("confines the provider to a safe origin", async () => {
  for (const unsafe of [
    "https://stadtstack.example/base",
    "https://user:secret@stadtstack.example",
    "http://stadtstack.example",
  ]) {
    await assert.rejects(
      loadRoebelMarienfelderTopicContext({ baseUrl: unsafe }),
      (error: unknown) =>
        error instanceof StadtstackFederationError &&
        error.code === "configuration"
    );
  }
});
