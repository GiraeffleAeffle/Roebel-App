import type { RoebelActivityJournalRuntimeProjectionV1 } from "@roebel/stadtstack-federation-client";

export const ROEBEL_MARIENFELDER_DEMO_TOPIC_SELECTOR =
  "roebel-marienfelder-strasse-demo" as const;

export interface CivicTopicBindingV1 {
  schemaVersion: "civic_topic_binding_v1";
  selector: typeof ROEBEL_MARIENFELDER_DEMO_TOPIC_SELECTOR;
  topicId: "topic:roebel-mueritz:marienfelder-strasse";
  municipalityId: "roebel-mueritz";
  decisionCaseSlug: "marienfelder-strasse";
  classification: "synthetic_demo_only";
  truthState: "demo";
  authorityBinding: "none";
  externalProposalBinding: {
    system: "roebel_app_governance";
    status: "not_linked";
    proposalId: null;
    proposalNumber: null;
    reviewedBindingArtifactRef: null;
  };
}

export const ROEBEL_MARIENFELDER_DEMO_TOPIC_BINDING = {
  schemaVersion: "civic_topic_binding_v1",
  selector: ROEBEL_MARIENFELDER_DEMO_TOPIC_SELECTOR,
  topicId: "topic:roebel-mueritz:marienfelder-strasse",
  municipalityId: "roebel-mueritz",
  decisionCaseSlug: "marienfelder-strasse",
  classification: "synthetic_demo_only",
  truthState: "demo",
  authorityBinding: "none",
  externalProposalBinding: {
    system: "roebel_app_governance",
    status: "not_linked",
    proposalId: null,
    proposalNumber: null,
    reviewedBindingArtifactRef: null,
  },
} as const satisfies CivicTopicBindingV1;

export function civicTopicBindingForSelector(
  selector: string | null | undefined
): CivicTopicBindingV1 | null {
  return selector === ROEBEL_MARIENFELDER_DEMO_TOPIC_SELECTOR
    ? ROEBEL_MARIENFELDER_DEMO_TOPIC_BINDING
    : null;
}

export function resolveGovernanceDeepLink(input: {
  proposalId: string | null | undefined;
  stadtstackTopic: string | null | undefined;
}): {
  proposalId: string | null;
  civicTopicBinding: CivicTopicBindingV1 | null;
} {
  const proposalId = input.proposalId?.trim() || null;
  if (proposalId) {
    return { proposalId, civicTopicBinding: null };
  }
  return {
    proposalId: null,
    civicTopicBinding: civicTopicBindingForSelector(input.stadtstackTopic),
  };
}

export function topicBindingMatchesCase(
  binding: CivicTopicBindingV1,
  caseKey: {
    municipalityId: string;
    decisionCaseSlug: string;
  }
): boolean {
  return (
    binding.municipalityId === caseKey.municipalityId &&
    binding.decisionCaseSlug === caseKey.decisionCaseSlug
  );
}

export function topicContextMatchesBinding(
  binding: CivicTopicBindingV1,
  context: {
    topic: {
      topicId: string;
      municipalityId: string;
      decisionCaseSlug: string;
      classification: string;
      truthState: string;
      authority: string;
    };
    externalProposalBinding: {
      system: string;
      status: string;
      proposalId: string | null;
      proposalNumber: number | null;
      reviewedBindingArtifactRef: string | null;
    };
  }
): boolean {
  return (
    binding.topicId === context.topic.topicId &&
    binding.municipalityId === context.topic.municipalityId &&
    binding.decisionCaseSlug === context.topic.decisionCaseSlug &&
    binding.classification === context.topic.classification &&
    binding.truthState === context.topic.truthState &&
    binding.authorityBinding === context.topic.authority &&
    binding.externalProposalBinding.system ===
      context.externalProposalBinding.system &&
    binding.externalProposalBinding.status ===
      context.externalProposalBinding.status &&
    context.externalProposalBinding.proposalId === null &&
    context.externalProposalBinding.proposalNumber === null &&
    context.externalProposalBinding.reviewedBindingArtifactRef === null
  );
}

/**
 * The historical runtime receipt is deliberately a separate read from the
 * reconstructed eight-event timeline. It can be displayed only when both
 * public endpoints repeat the exact, unbound synthetic topic identity.
 */
export function activityJournalRuntimeReceiptMatchesTopic(
  binding: CivicTopicBindingV1,
  context: {
    topic: {
      topicId: string;
      municipalityId: string;
      decisionCaseSlug: string;
      classification: string;
      truthState: string;
      authority: string;
    };
    externalProposalBinding: {
      system: string;
      status: string;
      proposalId: string | null;
      proposalNumber: number | null;
      reviewedBindingArtifactRef: string | null;
    };
    modules: {
      activityJournal: {
        runtimeReceipt: {
          status: string;
          checkpointObservedAt: string;
          eventCount: number;
          backfilled: boolean;
          publicProjectionState: string;
        };
      };
    };
  },
  receipt: RoebelActivityJournalRuntimeProjectionV1
): boolean {
  const expected = context.modules.activityJournal.runtimeReceipt;
  return (
    topicContextMatchesBinding(binding, context) &&
    receipt.caseKey.municipalityId === binding.municipalityId &&
    receipt.caseKey.decisionCaseSlug === binding.decisionCaseSlug &&
    receipt.caseKey.topicRef === binding.topicId &&
    receipt.truthState === binding.truthState &&
    receipt.authority === binding.authorityBinding &&
    expected.status === "historical_verified_private_runtime" &&
    receipt.checkpointObservedAt === expected.checkpointObservedAt &&
    receipt.runtime.eventCount === expected.eventCount &&
    receipt.runtime.backfilled === expected.backfilled &&
    receipt.runtime.publicProjectionState === expected.publicProjectionState
  );
}

export function mayLoadSyntheticTopic(input: {
  binding: CivicTopicBindingV1 | null;
  demoScenario: string | null | undefined;
  providerBaseUrl: string | null | undefined;
}): boolean {
  return (
    input.binding?.classification === "synthetic_demo_only" &&
    input.binding.externalProposalBinding.status === "not_linked" &&
    input.demoScenario?.trim() === "walkthrough" &&
    Boolean(input.providerBaseUrl?.trim())
  );
}
