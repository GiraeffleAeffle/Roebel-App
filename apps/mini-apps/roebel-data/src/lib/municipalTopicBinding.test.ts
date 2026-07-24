import assert from "node:assert/strict";
import test from "node:test";

import {
  activityJournalRuntimeReceiptMatchesTopic,
  civicTopicBindingForSelector,
  mayLoadSyntheticTopic,
  resolveGovernanceDeepLink,
  ROEBEL_MARIENFELDER_DEMO_TOPIC_BINDING,
  ROEBEL_MARIENFELDER_DEMO_TOPIC_SELECTOR,
  topicBindingMatchesCase,
  topicContextMatchesBinding,
} from "./municipalTopicBinding";

function topicContextWithRuntimeReceipt() {
  return {
    topic: {
      topicId: "topic:roebel-mueritz:marienfelder-strasse",
      municipalityId: "roebel-mueritz",
      decisionCaseSlug: "marienfelder-strasse",
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
      activityJournal: {
        runtimeReceipt: {
          status: "historical_verified_private_runtime",
          checkpointObservedAt: "2026-07-24T08:27:35.000Z",
          eventCount: 2,
          backfilled: false,
          publicProjectionState: "candidate_not_publicly_routed",
        },
      },
    },
  };
}

function runtimeReceipt() {
  return {
    schemaVersion: "roebel_activity_journal_runtime_projection_v1" as const,
    projectionId:
      "demo:roebel-mueritz:marienfelder-strasse:activity-journal-runtime:v1" as const,
    caseKey: {
      municipalityId: "roebel-mueritz" as const,
      decisionCaseSlug: "marienfelder-strasse" as const,
      topicRef: "topic:roebel-mueritz:marienfelder-strasse" as const,
      caseRef: "case:roebel-mueritz:marienfelder-strasse:v1" as const,
    },
    truthState: "demo" as const,
    authority: "none" as const,
    checkpointObservedAt: "2026-07-24T08:27:35.000Z" as const,
    checkpointFreshness: "historical_verified_receipt_not_live_health" as const,
    notice:
      "Ein privates, metadata-only Activity Journal wurde für den synthetischen Demo-Fall technisch nachgewiesen. Dieser Nachweis ist kein aktueller Status der Verwaltung und veröffentlicht weder interne Ereignisinhalte noch Arbeitsräume." as const,
    runtime: {
      state: "technically_verified_synthetic" as const,
      visibility: "administration_internal" as const,
      metadataOnly: true as const,
      forwardOnly: true as const,
      backfilled: false as const,
      eventCount: 2 as const,
      currentStateVerified: false as const,
      mcpReadOnlyToolCount: 4 as const,
      publicProjectionState: "candidate_not_publicly_routed" as const,
      publicEventCount: 0 as const,
    },
    durability: {
      backupCompleted: true as const,
      restorePerformed: false as const,
    },
    boundary: {
      internalEventContentPublic: false as const,
      internalMcpPublic: false as const,
      openProjectDataPublic: false as const,
      matrixDataPublic: false as const,
      civicEffect: false as const,
    },
  };
}

test("only the exact dedicated Stadtstack topic selector resolves", () => {
  assert.equal(
    civicTopicBindingForSelector(ROEBEL_MARIENFELDER_DEMO_TOPIC_SELECTOR),
    ROEBEL_MARIENFELDER_DEMO_TOPIC_BINDING
  );
  for (const unboundValue of [
    null,
    "",
    "marienfelder-strasse",
    "Marienfelder Straße",
    "1",
    "2",
    "0x1234567890abcdef",
    "roebel-marienfelder-strasse-demo ",
  ]) {
    assert.equal(civicTopicBindingForSelector(unboundValue), null);
  }
});

test("the synthetic topic is explicitly not linked to an external proposal", () => {
  assert.deepEqual(
    ROEBEL_MARIENFELDER_DEMO_TOPIC_BINDING.externalProposalBinding,
    {
      system: "roebel_app_governance",
      status: "not_linked",
      proposalId: null,
      proposalNumber: null,
      reviewedBindingArtifactRef: null,
    }
  );
});

test("a proposal deep link suppresses a simultaneous synthetic topic selector", () => {
  assert.deepEqual(
    resolveGovernanceDeepLink({
      proposalId: "proposal-1",
      stadtstackTopic: ROEBEL_MARIENFELDER_DEMO_TOPIC_SELECTOR,
    }),
    { proposalId: "proposal-1", civicTopicBinding: null }
  );
});

test("synthetic reads require the selected exact topic, walkthrough flag and provider", () => {
  assert.equal(
    mayLoadSyntheticTopic({
      binding: ROEBEL_MARIENFELDER_DEMO_TOPIC_BINDING,
      demoScenario: "walkthrough",
      providerBaseUrl: "https://stadtstack.example",
    }),
    true
  );
  assert.equal(
    mayLoadSyntheticTopic({
      binding: null,
      demoScenario: "walkthrough",
      providerBaseUrl: "https://stadtstack.example",
    }),
    false
  );
  assert.equal(
    mayLoadSyntheticTopic({
      binding: ROEBEL_MARIENFELDER_DEMO_TOPIC_BINDING,
      demoScenario: "off",
      providerBaseUrl: "https://stadtstack.example",
    }),
    false
  );
});

test("provider data must retain the exact municipality and decision-case scope", () => {
  assert.equal(
    topicBindingMatchesCase(ROEBEL_MARIENFELDER_DEMO_TOPIC_BINDING, {
      municipalityId: "roebel-mueritz",
      decisionCaseSlug: "marienfelder-strasse",
    }),
    true
  );
  assert.equal(
    topicBindingMatchesCase(ROEBEL_MARIENFELDER_DEMO_TOPIC_BINDING, {
      municipalityId: "roebel-mueritz",
      decisionCaseSlug: "a-real-proposal",
    }),
    false
  );
});

test("the provider context must repeat the exact unbound synthetic identity", () => {
  const exact = {
    topic: {
      topicId: "topic:roebel-mueritz:marienfelder-strasse",
      municipalityId: "roebel-mueritz",
      decisionCaseSlug: "marienfelder-strasse",
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
  };
  assert.equal(
    topicContextMatchesBinding(ROEBEL_MARIENFELDER_DEMO_TOPIC_BINDING, exact),
    true
  );
  assert.equal(
    topicContextMatchesBinding(ROEBEL_MARIENFELDER_DEMO_TOPIC_BINDING, {
      ...exact,
      externalProposalBinding: {
        ...exact.externalProposalBinding,
        proposalId: "proposal-1",
      },
    }),
    false
  );
});

test("a historical runtime receipt stays scoped to the separate synthetic topic", () => {
  const context = topicContextWithRuntimeReceipt();
  assert.equal(
    activityJournalRuntimeReceiptMatchesTopic(
      ROEBEL_MARIENFELDER_DEMO_TOPIC_BINDING,
      context,
      runtimeReceipt()
    ),
    true
  );
  assert.equal(
    activityJournalRuntimeReceiptMatchesTopic(
      ROEBEL_MARIENFELDER_DEMO_TOPIC_BINDING,
      {
        ...context,
        externalProposalBinding: {
          ...context.externalProposalBinding,
          proposalId: "proposal-1",
        },
      },
      runtimeReceipt()
    ),
    false
  );
  assert.equal(
    activityJournalRuntimeReceiptMatchesTopic(
      ROEBEL_MARIENFELDER_DEMO_TOPIC_BINDING,
      context,
      {
        ...runtimeReceipt(),
        caseKey: {
          ...runtimeReceipt().caseKey,
          decisionCaseSlug: "another-case" as "marienfelder-strasse",
        },
      }
    ),
    false
  );
});
