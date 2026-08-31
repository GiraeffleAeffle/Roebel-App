import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildNoteEvent,
  type ParticipantTopicSuggestionV1,
} from "@netizen-labs/nostr";

import {
  bindPublicCaseReceiptToProposal,
  projectPublicCitizenAdoptionEvidence,
  projectPublicProposalSignature,
} from "../src/lib/stadtstack/proposal-signature";
import type {
  VerifiedPublicAdoptedCaseBindingReceipt,
  VerifiedPublicLegacyCaseBindingReceipt,
} from "../src/lib/stadtstack/public-case-binding-receipt-client";

function participantSuggestion(): ParticipantTopicSuggestionV1 {
  const secret = new Uint8Array(32).fill(41);
  const event = buildNoteEvent(secret, "Signierte Staging-Anfrage", {
    createdAt: 1_800_000_000,
  });
  return {
    schemaVersion: "staging_participant_signed_topic_suggestion_v1",
    suggestionId: event.id,
    candidateId: `urn:stadtstack:participant-topic-suggestion:${event.id}`,
    signerPubkey: event.pubkey,
    draft: {
      schemaVersion: "public_participant_topic_suggestion_draft_v1",
      draftId: `urn:stadtstack:participant-topic-suggestion-draft:${"a".repeat(64)}`,
      sourceAnswerId: "b".repeat(64),
      sourceAnswerRef: `nostr://event/${"b".repeat(64)}`,
      sourceAnswerReceiptId: `urn:stadtstack:mecky-answer:${"c".repeat(64)}`,
      sourceDiscussionId: "d".repeat(64),
      sourceDiscussionRef: `nostr://event/${"d".repeat(64)}`,
      municipalityId: "roebel-mueritz",
      topicId:
        "urn:stadtstack:topic:municipality:roebel-mueritz:sichere-querung",
      participantPubkey: event.pubkey,
      title: "Sichere Querung prüfen",
      summary: "Die öffentlich diskutierten Optionen sollen geprüft werden.",
      entryState: "citizen_adoption_required",
      authorityBinding: "none",
      submittedToCivicWorkflow: false,
    },
    event,
    verification: { kind: "nostr_nip01", verified: true },
    entryState: "citizen_adoption_required",
    authorityBinding: "none",
    submittedToCivicWorkflow: false,
  };
}

const CASE_ID =
  "urn:stadtstack:case:municipality:roebel-mueritz:018f0000-0000-7000-8000-000000000001";

function adoptedBindingReceipt(
  suggestion: ParticipantTopicSuggestionV1,
  overrides: Partial<VerifiedPublicAdoptedCaseBindingReceipt> = {}
): VerifiedPublicAdoptedCaseBindingReceipt {
  const eligibilityChecksum = "1".repeat(64);
  return {
    schemaVersion: "public_case_binding_receipt_v2",
    rootEventId: suggestion.draft.sourceDiscussionId,
    topicId: suggestion.draft.topicId,
    candidateKind: "eligible_citizen_adopted_topic_suggestion_v1",
    candidateId: `urn:stadtstack:citizen-topic-suggestion-adoption:${"e".repeat(64)}`,
    candidateEventId: "f".repeat(64),
    participantSuggestionEventId: suggestion.event.id,
    adopterPubkey: "9".repeat(64),
    eligibilityReceiptId: `urn:stadtstack:municipal-civic-eligibility-receipt:${eligibilityChecksum}`,
    eligibilityReceiptChecksum: eligibilityChecksum,
    eligibilityPolicyVersion: "roebel-civic-eligibility-2026-08",
    eligibilityIssuer: "roebel-citizen-verifier",
    adoptionAcceptanceReceiptChecksum: "2".repeat(64),
    sourceAnswerEventId: suggestion.draft.sourceAnswerId,
    sourceAnswerReceiptId: suggestion.draft.sourceAnswerReceiptId,
    caseId: CASE_ID,
    caseVersion: 3,
    caseEventIds: [
      `urn:stadtstack:case-event:${CASE_ID}:1`,
      `urn:stadtstack:case-event:${CASE_ID}:2`,
      `urn:stadtstack:case-event:${CASE_ID}:3`,
    ],
    journalHeadChecksum: `sha256:${"3".repeat(64)}`,
    admissionEventChecksum: `sha256:${"3".repeat(64)}`,
    receiptChecksum: `sha256:${"4".repeat(64)}`,
    authorityBinding: "none",
    administrativeEndorsement: false,
    bindingVote: false,
    councilDecision: false,
    openDeskWrite: false,
    treasuryEffect: false,
    paymentEffect: false,
    ...overrides,
  };
}

function legacyBindingReceipt(
  suggestion: ParticipantTopicSuggestionV1
): VerifiedPublicLegacyCaseBindingReceipt {
  return {
    schemaVersion: "public_case_binding_receipt_v1",
    rootEventId: suggestion.draft.sourceDiscussionId,
    topicId: suggestion.draft.topicId,
    candidateId: `urn:stadtstack:signed-topic-suggestion:${suggestion.event.id}`,
    candidateEventId: suggestion.event.id,
    sourceAnswerEventId: suggestion.draft.sourceAnswerId,
    caseId: CASE_ID,
    caseVersion: 3,
    caseEventIds: [
      `urn:stadtstack:case-event:${CASE_ID}:1`,
      `urn:stadtstack:case-event:${CASE_ID}:2`,
      `urn:stadtstack:case-event:${CASE_ID}:3`,
    ],
    journalHeadChecksum: `sha256:${"3".repeat(64)}`,
    admissionEventChecksum: `sha256:${"3".repeat(64)}`,
    receiptChecksum: `sha256:${"4".repeat(64)}`,
    authorityBinding: "none",
    openDeskWrite: false,
  };
}

test("projects a connected-account signature without upgrading it to civic authority", () => {
  const suggestion = participantSuggestion();
  assert.deepEqual(projectPublicProposalSignature(suggestion), {
    kind: "participant_request",
    eventId: suggestion.event.id,
    signerPubkey: suggestion.event.pubkey,
    title: "Sichere Querung prüfen",
    summary: "Die öffentlich diskutierten Optionen sollen geprüft werden.",
    nextGate: "citizen_adoption",
    civicEligibilityProven: false,
    civicCaseCreated: false,
    administrativeEndorsement: false,
    authorityBinding: "none",
  });
});

test("fails closed for forged or relabelled participant signature projections", () => {
  const suggestion = participantSuggestion();
  assert.equal(
    projectPublicProposalSignature({
      ...suggestion,
      signerPubkey: "e".repeat(64),
    }),
    null
  );
  assert.equal(
    projectPublicProposalSignature({
      ...suggestion,
      entryState: "case_steward_review_required",
    } as unknown as ParticipantTopicSuggestionV1),
    null
  );
  assert.equal(
    projectPublicProposalSignature({
      ...suggestion,
      event: { ...suggestion.event, sig: "0".repeat(128) },
    }),
    null
  );
});

test("binds an adopted Case receipt to the exact participant and eligibility evidence", () => {
  const suggestion = participantSuggestion();
  const receipt = adoptedBindingReceipt(suggestion);
  const bound = bindPublicCaseReceiptToProposal({
    suggestion,
    receipt,
    rootEventId: suggestion.draft.sourceDiscussionId,
    topicId: suggestion.draft.topicId,
  });
  assert.equal(bound, receipt);
  assert.deepEqual(projectPublicCitizenAdoptionEvidence(bound), {
    adoptionId: receipt.candidateId,
    adoptionEventId: receipt.candidateEventId,
    participantSuggestionEventId: suggestion.event.id,
    adopterPubkey: receipt.adopterPubkey,
    eligibilityReceiptId: receipt.eligibilityReceiptId,
    eligibilityReceiptChecksum: receipt.eligibilityReceiptChecksum,
    eligibilityPolicyVersion: receipt.eligibilityPolicyVersion,
    eligibilityIssuer: receipt.eligibilityIssuer,
    adoptionAcceptanceReceiptChecksum:
      receipt.adoptionAcceptanceReceiptChecksum,
    civicEligibilityProven: true,
    civicCaseCreated: true,
    administrativeEndorsement: false,
    bindingVote: false,
    councilDecision: false,
    openDeskWrite: false,
    treasuryEffect: false,
    paymentEffect: false,
    eligibilityAuthorityBinding: "civic_eligibility_only",
    authorityBinding: "none",
  });
});

test("refuses legacy relabelling or any mismatched adoption handoff", () => {
  const suggestion = participantSuggestion();
  const input = {
    suggestion,
    rootEventId: suggestion.draft.sourceDiscussionId,
    topicId: suggestion.draft.topicId,
  } as const;
  assert.equal(
    bindPublicCaseReceiptToProposal({
      ...input,
      receipt: legacyBindingReceipt(suggestion),
    }),
    null
  );
  assert.equal(
    bindPublicCaseReceiptToProposal({
      ...input,
      receipt: adoptedBindingReceipt(suggestion, {
        participantSuggestionEventId: "8".repeat(64),
      }),
    }),
    null
  );
  assert.equal(
    bindPublicCaseReceiptToProposal({
      ...input,
      receipt: adoptedBindingReceipt(suggestion, {
        sourceAnswerReceiptId: `urn:stadtstack:mecky-answer:${"7".repeat(64)}`,
      }),
    }),
    null
  );
});
