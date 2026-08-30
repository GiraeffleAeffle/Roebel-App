import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildNoteEvent,
  type ParticipantTopicSuggestionV1,
} from "@netizen-labs/nostr";

import { projectPublicProposalSignature } from "../src/lib/stadtstack/proposal-signature";

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
