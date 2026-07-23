import assert from "node:assert/strict";
import test from "node:test";

import {
  civicTopicBindingForSelector,
  mayLoadSyntheticTopic,
  resolveGovernanceDeepLink,
  ROEBEL_MARIENFELDER_DEMO_TOPIC_BINDING,
  ROEBEL_MARIENFELDER_DEMO_TOPIC_SELECTOR,
  topicBindingMatchesCase,
  topicContextMatchesBinding,
} from "./municipalTopicBinding";

test("only the exact dedicated Stadtstack topic selector resolves", () => {
  assert.equal(
    civicTopicBindingForSelector(ROEBEL_MARIENFELDER_DEMO_TOPIC_SELECTOR),
    ROEBEL_MARIENFELDER_DEMO_TOPIC_BINDING,
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
    },
  );
});

test("a proposal deep link suppresses a simultaneous synthetic topic selector", () => {
  assert.deepEqual(
    resolveGovernanceDeepLink({
      proposalId: "proposal-1",
      stadtstackTopic: ROEBEL_MARIENFELDER_DEMO_TOPIC_SELECTOR,
    }),
    { proposalId: "proposal-1", civicTopicBinding: null },
  );
});

test("synthetic reads require the selected exact topic, walkthrough flag and provider", () => {
  assert.equal(
    mayLoadSyntheticTopic({
      binding: ROEBEL_MARIENFELDER_DEMO_TOPIC_BINDING,
      demoScenario: "walkthrough",
      providerBaseUrl: "https://stadtstack.example",
    }),
    true,
  );
  assert.equal(
    mayLoadSyntheticTopic({
      binding: null,
      demoScenario: "walkthrough",
      providerBaseUrl: "https://stadtstack.example",
    }),
    false,
  );
  assert.equal(
    mayLoadSyntheticTopic({
      binding: ROEBEL_MARIENFELDER_DEMO_TOPIC_BINDING,
      demoScenario: "off",
      providerBaseUrl: "https://stadtstack.example",
    }),
    false,
  );
});

test("provider data must retain the exact municipality and decision-case scope", () => {
  assert.equal(
    topicBindingMatchesCase(ROEBEL_MARIENFELDER_DEMO_TOPIC_BINDING, {
      municipalityId: "roebel-mueritz",
      decisionCaseSlug: "marienfelder-strasse",
    }),
    true,
  );
  assert.equal(
    topicBindingMatchesCase(ROEBEL_MARIENFELDER_DEMO_TOPIC_BINDING, {
      municipalityId: "roebel-mueritz",
      decisionCaseSlug: "a-real-proposal",
    }),
    false,
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
    topicContextMatchesBinding(
      ROEBEL_MARIENFELDER_DEMO_TOPIC_BINDING,
      exact,
    ),
    true,
  );
  assert.equal(
    topicContextMatchesBinding(
      ROEBEL_MARIENFELDER_DEMO_TOPIC_BINDING,
      {
        ...exact,
        externalProposalBinding: {
          ...exact.externalProposalBinding,
          proposalId: "proposal-1",
        },
      },
    ),
    false,
  );
});
