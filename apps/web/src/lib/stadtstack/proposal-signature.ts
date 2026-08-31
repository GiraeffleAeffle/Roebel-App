import {
  verifyEvent,
  type CitizenSignedTopicSuggestionV1,
  type ParticipantTopicSuggestionV1,
} from "@netizen-labs/nostr";
import type {
  VerifiedPublicAdoptedCaseBindingReceipt,
  VerifiedPublicCaseBindingReceipt,
} from "./public-case-binding-receipt-client";

export type PublicProposalSignature = Readonly<{
  kind: "participant_request" | "legacy_citizen_candidate";
  eventId: string;
  signerPubkey: string;
  title: string;
  summary: string;
  nextGate: "citizen_adoption" | "case_steward_review";
  civicEligibilityProven: false;
  civicCaseCreated: false;
  administrativeEndorsement: false;
  authorityBinding: "none";
}>;

export type PublicCitizenAdoptionEvidence = Readonly<{
  adoptionId: string;
  adoptionEventId: string;
  participantSuggestionEventId: string;
  adopterPubkey: string;
  eligibilityReceiptId: string;
  eligibilityReceiptChecksum: string;
  eligibilityPolicyVersion: string;
  eligibilityIssuer: string;
  adoptionAcceptanceReceiptChecksum: string;
  civicEligibilityProven: true;
  civicCaseCreated: true;
  administrativeEndorsement: false;
  bindingVote: false;
  councilDecision: false;
  openDeskWrite: false;
  treasuryEffect: false;
  paymentEffect: false;
  eligibilityAuthorityBinding: "civic_eligibility_only";
  authorityBinding: "none";
}>;

const HEX64 = /^[0-9a-f]{64}$/u;

function text(value: unknown, maxLength: number): value is string {
  return (
    typeof value === "string" &&
    value === value.trim() &&
    value.length > 0 &&
    value.length <= maxLength &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  );
}

/**
 * Derive display-only signature provenance from an already projected signed
 * suggestion. This projector never upgrades a staging participant signature
 * into civic eligibility or treats a signature as Case admission.
 */
export function projectPublicProposalSignature(
  suggestion:
    | CitizenSignedTopicSuggestionV1
    | ParticipantTopicSuggestionV1
    | null
): PublicProposalSignature | null {
  if (
    !suggestion ||
    suggestion.authorityBinding !== "none" ||
    suggestion.submittedToCivicWorkflow !== false ||
    suggestion.verification.kind !== "nostr_nip01" ||
    suggestion.verification.verified !== true ||
    !HEX64.test(suggestion.event.id) ||
    !HEX64.test(suggestion.event.pubkey) ||
    suggestion.signerPubkey !== suggestion.event.pubkey ||
    !verifyEvent(suggestion.event) ||
    !text(suggestion.draft.title, 240) ||
    !text(suggestion.draft.summary, 2_000)
  ) {
    return null;
  }

  if (
    suggestion.schemaVersion ===
    "staging_participant_signed_topic_suggestion_v1"
  ) {
    if (
      suggestion.entryState !== "citizen_adoption_required" ||
      suggestion.suggestionId !== suggestion.event.id ||
      suggestion.candidateId !==
        `urn:stadtstack:participant-topic-suggestion:${suggestion.event.id}` ||
      suggestion.draft.schemaVersion !==
        "public_participant_topic_suggestion_draft_v1" ||
      suggestion.draft.participantPubkey !== suggestion.event.pubkey ||
      suggestion.draft.entryState !== "citizen_adoption_required" ||
      suggestion.draft.authorityBinding !== "none" ||
      suggestion.draft.submittedToCivicWorkflow !== false
    ) {
      return null;
    }
    return Object.freeze({
      kind: "participant_request" as const,
      eventId: suggestion.event.id,
      signerPubkey: suggestion.signerPubkey,
      title: suggestion.draft.title,
      summary: suggestion.draft.summary,
      nextGate: "citizen_adoption" as const,
      civicEligibilityProven: false as const,
      civicCaseCreated: false as const,
      administrativeEndorsement: false as const,
      authorityBinding: "none" as const,
    });
  }

  if (
    suggestion.schemaVersion !== "citizen_signed_topic_suggestion_v1" ||
    suggestion.entryState !== "awaiting_human_case_admission" ||
    suggestion.candidateId !==
      `urn:stadtstack:signed-topic-suggestion:${suggestion.event.id}` ||
    suggestion.draft.schemaVersion !==
      "public_mecky_topic_suggestion_draft_v1" ||
    suggestion.draft.citizenPubkey !== suggestion.event.pubkey ||
    suggestion.draft.entryState !== "citizen_signature_required" ||
    suggestion.draft.authorityBinding !== "none" ||
    suggestion.draft.submittedToCivicWorkflow !== false
  ) {
    return null;
  }
  return Object.freeze({
    kind: "legacy_citizen_candidate" as const,
    eventId: suggestion.event.id,
    signerPubkey: suggestion.signerPubkey,
    title: suggestion.draft.title,
    summary: suggestion.draft.summary,
    nextGate: "case_steward_review" as const,
    // This direct legacy shape is retained only for the synthetic fixture. It
    // is not the ADR-0023 municipal-eligibility adoption proof.
    civicEligibilityProven: false as const,
    civicCaseCreated: false as const,
    administrativeEndorsement: false as const,
    authorityBinding: "none" as const,
  });
}

/**
 * Correlate a trusted public Case receipt with the proposal evidence currently
 * projected in this discussion. A participant event can advance only through
 * the ADR-0023 receipt; the legacy direct-candidate receipt cannot silently
 * relabel it as citizen-adopted.
 *
 * A receipt remains independently useful if the proposal projection is
 * temporarily absent: the trusted Case projection has already verified the
 * full admission bundle. Whenever local evidence is present, every available
 * root, topic, answer, suggestion and candidate binding must match.
 */
export function bindPublicCaseReceiptToProposal(
  input: Readonly<{
    suggestion:
      | CitizenSignedTopicSuggestionV1
      | ParticipantTopicSuggestionV1
      | null;
    receipt: VerifiedPublicCaseBindingReceipt | null;
    rootEventId: string;
    topicId: string;
  }>
): VerifiedPublicCaseBindingReceipt | null {
  const { receipt, suggestion, rootEventId, topicId } = input;
  if (
    !receipt ||
    receipt.rootEventId !== rootEventId ||
    receipt.topicId !== topicId
  ) {
    return null;
  }
  if (!suggestion) return receipt;
  const signature = projectPublicProposalSignature(suggestion);
  if (
    !signature ||
    suggestion.draft.sourceDiscussionId !== rootEventId ||
    suggestion.draft.topicId !== topicId
  ) {
    return null;
  }
  if (
    suggestion.schemaVersion ===
    "staging_participant_signed_topic_suggestion_v1"
  ) {
    return receipt.schemaVersion === "public_case_binding_receipt_v2" &&
      receipt.participantSuggestionEventId === suggestion.event.id &&
      receipt.sourceAnswerEventId === suggestion.draft.sourceAnswerId &&
      receipt.sourceAnswerReceiptId === suggestion.draft.sourceAnswerReceiptId
      ? receipt
      : null;
  }
  return receipt.schemaVersion === "public_case_binding_receipt_v1" &&
    receipt.candidateEventId === signature.eventId &&
    receipt.candidateId === suggestion.candidateId
    ? receipt
    : null;
}

/**
 * Derive display-only adoption provenance from the checksum-verified v2 Case
 * receipt. The evidence proves eligibility for this exact adoption and human
 * Case admission only; all authority-bearing effects remain explicitly false.
 */
export function projectPublicCitizenAdoptionEvidence(
  receipt: VerifiedPublicCaseBindingReceipt | null
): PublicCitizenAdoptionEvidence | null {
  if (receipt?.schemaVersion !== "public_case_binding_receipt_v2") return null;
  const adoptedReceipt: VerifiedPublicAdoptedCaseBindingReceipt = receipt;
  return Object.freeze({
    adoptionId: adoptedReceipt.candidateId,
    adoptionEventId: adoptedReceipt.candidateEventId,
    participantSuggestionEventId: adoptedReceipt.participantSuggestionEventId,
    adopterPubkey: adoptedReceipt.adopterPubkey,
    eligibilityReceiptId: adoptedReceipt.eligibilityReceiptId,
    eligibilityReceiptChecksum: adoptedReceipt.eligibilityReceiptChecksum,
    eligibilityPolicyVersion: adoptedReceipt.eligibilityPolicyVersion,
    eligibilityIssuer: adoptedReceipt.eligibilityIssuer,
    adoptionAcceptanceReceiptChecksum:
      adoptedReceipt.adoptionAcceptanceReceiptChecksum,
    civicEligibilityProven: true as const,
    civicCaseCreated: true as const,
    administrativeEndorsement: false as const,
    bindingVote: false as const,
    councilDecision: false as const,
    openDeskWrite: false as const,
    treasuryEffect: false as const,
    paymentEffect: false as const,
    eligibilityAuthorityBinding: "civic_eligibility_only" as const,
    authorityBinding: "none" as const,
  });
}
