import {
  verifyEvent,
  type CitizenSignedTopicSuggestionV1,
  type ParticipantTopicSuggestionV1,
} from "@netizen-labs/nostr";

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
