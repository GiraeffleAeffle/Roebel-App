import assert from "node:assert/strict";
import { test } from "node:test";
import { toStadtstackAdvisoryCase } from "../src/lib/stadtstack/advisory-participation.ts";

const SHA_A = `sha256:${"a".repeat(64)}`;
const SHA_B = `sha256:${"b".repeat(64)}`;
const SHA_C = `sha256:${"c".repeat(64)}`;
const DISCUSSION_ID = "d1b4e9db3a9351a4338c89b3b966d28cd269c6d2305996c64287f033b8ee4328";

function fixture(): unknown {
  return {
    schemaVersion: "projection_envelope_v1",
    caseId: "urn:stadtstack:case:municipality:roebel-mueritz:018f0000-0000-7000-8000-000000000001",
    caseVersion: 30,
    journalHeadChecksum: SHA_A,
    projectionChecksum: SHA_B,
    visibility: "public",
    policyVersion: "roebel-staging-lab-v1",
    projection: {
      reviewedCitizenBrief: {
        schemaVersion: "citizen_brief_projection_v1",
        id: "urn:stadtstack:citizen-brief:1",
        title: "Sichere Querung an der Marienfelder Straße prüfen",
        summary: "Acht geprüfte Fachpakete wurden öffentlich verständlich zusammengeführt.",
        responses: [
          { departmentId: "planning", publicSummary: "Planung hat Varianten geprüft.", publicCitations: ["synthetic://planning/reviewed"] },
          { departmentId: "traffic", publicSummary: "Verkehr hat Sichtbeziehungen geprüft.", publicCitations: ["synthetic://traffic/reviewed"] },
        ],
        provenance: { sourceDiscussionRef: { type: "nostr_event", id: DISCUSSION_ID, ref: `nostr://event/${DISCUSSION_ID}` } },
        briefChecksum: SHA_C,
        policyVersion: "roebel-staging-lab-v1",
        correctionState: "current",
        authorityBinding: "none",
      },
      participationResult: {
        schemaVersion: "participation_result_v1",
        id: "participation-1",
        question: "Welche Querungsvariante soll zuerst geprüft werden?",
        options: [
          { optionId: "lighting", label: "Beleuchtung", aggregateCount: 2 },
          { optionId: "marked-crossing", label: "Markierte Querung", aggregateCount: 6 },
        ],
        totalAccepted: 8,
        resultSummary: "Die markierte Querung erhielt das stärkste synthetische beratende Signal.",
        limitations: ["Advisory synthetic signal only."],
        checksum: SHA_A,
        correctionState: "current",
        authorityBinding: "none",
        advisory: true,
      },
      reviewedOutcome: {
        schemaVersion: "reviewed_outcome_projection_v1",
        id: "outcome-1",
        summary: "Die markierte Querung wird als stärkstes synthetisches Ergebnis weiter geprüft.",
        sourceBrief: { id: "urn:stadtstack:citizen-brief:1", briefChecksum: SHA_C },
        sourceParticipation: { id: "participation-1", participationChecksum: SHA_A },
        authorityBinding: "none",
        correctionState: "current",
        advisory: true,
        formalDecision: null,
        externalPublication: false,
        outcomeChecksum: SHA_B,
      },
    },
  };
}

test("projects the reviewed Citizen Brief as a separate advisory Mitmachen case", () => {
  const result = toStadtstackAdvisoryCase(fixture());
  assert.deepEqual(result, {
    caseId: "urn:stadtstack:case:municipality:roebel-mueritz:018f0000-0000-7000-8000-000000000001",
    caseVersion: 30,
    title: "Sichere Querung an der Marienfelder Straße prüfen",
    summary: "Acht geprüfte Fachpakete wurden öffentlich verständlich zusammengeführt.",
    sourceDiscussionId: DISCUSSION_ID,
    reviewedDepartmentCount: 2,
    question: "Welche Querungsvariante soll zuerst geprüft werden?",
    options: [
      { id: "lighting", label: "Beleuchtung", count: 2 },
      { id: "marked-crossing", label: "Markierte Querung", count: 6 },
    ],
    totalAccepted: 8,
    resultSummary: "Die markierte Querung erhielt das stärkste synthetische beratende Signal.",
    outcomeSummary: "Die markierte Querung wird als stärkstes synthetisches Ergebnis weiter geprüft.",
    briefChecksum: SHA_C,
    participationChecksum: SHA_A,
    outcomeChecksum: SHA_B,
    advisory: true,
    formalDecision: null,
    externalPublication: false,
  });
});

test("fails closed when authority, review state, or checksum bindings drift", () => {
  for (const mutate of [
    (value: any) => { value.projection.reviewedCitizenBrief.correctionState = "invalidated"; },
    (value: any) => { value.projection.participationResult.advisory = false; },
    (value: any) => { value.projection.reviewedOutcome.formalDecision = { id: "forbidden" }; },
    (value: any) => { value.projection.reviewedOutcome.externalPublication = true; },
    (value: any) => { value.projection.reviewedOutcome.sourceBrief.briefChecksum = SHA_A; },
    (value: any) => { value.projection.reviewedOutcome.sourceParticipation.participationChecksum = SHA_B; },
  ]) {
    const value = structuredClone(fixture());
    mutate(value);
    assert.throws(() => toStadtstackAdvisoryCase(value), /stadtstack_advisory_projection_invalid/);
  }
});

test("rejects malformed vote totals and non-Nostr discussion provenance", () => {
  const wrongTotal = structuredClone(fixture()) as any;
  wrongTotal.projection.participationResult.totalAccepted = 9;
  assert.throws(() => toStadtstackAdvisoryCase(wrongTotal), /stadtstack_advisory_projection_invalid/);

  const wrongSource = structuredClone(fixture()) as any;
  wrongSource.projection.reviewedCitizenBrief.provenance.sourceDiscussionRef.type = "url";
  assert.throws(() => toStadtstackAdvisoryCase(wrongSource), /stadtstack_advisory_projection_invalid/);
});
