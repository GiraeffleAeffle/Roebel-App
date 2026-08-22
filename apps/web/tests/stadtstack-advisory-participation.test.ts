import assert from "node:assert/strict";
import { test } from "node:test";

import { STADTSTACK_REQUIRED_DEPARTMENTS } from "../src/lib/stadtstack/administration-progress";
import { toStadtstackAdvisoryCase } from "../src/lib/stadtstack/advisory-participation";

const DISCUSSION_ID =
  "d1b4e9db3a9351a4338c89b3b966d28cd269c6d2305996c64287f033b8ee4328";
const POLICY_VERSION = "roebel-staging-lab-v1";

function sha(seed: number): string {
  return `sha256:${seed.toString(16).padStart(64, "0")}`;
}

function reviewedPackage(departmentId: string, index: number) {
  return {
    schemaVersion: "department_package_projection_v1",
    id: `package-${departmentId}`,
    departmentId,
    suggestionId: "urn:stadtstack:suggestion:fixture",
    request: `Review ${departmentId}.`,
    packageChecksum: sha(10 + index),
    reviewState: "accepted",
    correctionState: "current",
    artifactChecksum: sha(100 + index),
    reviewedAt: "2026-08-22T08:00:00.000Z",
    policyVersion: POLICY_VERSION,
    publicSummary: `Reviewed ${departmentId} response.`,
    publicCitations: [`https://stadt.example/review/${departmentId}`],
    authorityBinding: "none",
  };
}

function fixture({ completed = false } = {}): any {
  const departmentPackages = STADTSTACK_REQUIRED_DEPARTMENTS.map(
    ({ id }, index) => reviewedPackage(id, index)
  );
  const packageByDepartment = new Map(
    departmentPackages.map((item) => [item.departmentId, item])
  );
  const reviewedCitizenBrief = {
    schemaVersion: "citizen_brief_projection_v1",
    id: "urn:stadtstack:citizen-brief:1",
    title: "Sichere Querung an der Marienfelder Straße prüfen",
    summary:
      "Acht geprüfte Fachpakete wurden öffentlich verständlich zusammengeführt.",
    responses: STADTSTACK_REQUIRED_DEPARTMENTS.map(({ id }) => {
      const item = packageByDepartment.get(id)!;
      return {
        departmentId: id,
        publicSummary: item.publicSummary,
        publicCitations: item.publicCitations,
      };
    }),
    provenance: {
      sourceDiscussionRef: {
        type: "nostr_event",
        id: DISCUSSION_ID,
        ref: `nostr://event/${DISCUSSION_ID}`,
      },
      suggestionId: "urn:stadtstack:suggestion:fixture",
      packageBindings: STADTSTACK_REQUIRED_DEPARTMENTS.map(({ id }, index) => {
        const item = packageByDepartment.get(id)!;
        return {
          packageId: item.id,
          packageChecksum: item.packageChecksum,
          draftArtifactChecksum: item.artifactChecksum,
          reviewAttestationChecksum: sha(200 + index),
          departmentId: id,
          reviewedAt: item.reviewedAt,
        };
      }),
    },
    briefChecksum: sha(400),
    policyVersion: POLICY_VERSION,
    correctionState: "current",
    authorityBinding: "none",
  };
  const projection: Record<string, unknown> = {
    schemaVersion: "case_projection_v1",
    caseId:
      "urn:stadtstack:case:municipality:roebel-mueritz:018f0000-0000-7000-8000-000000000001",
    jurisdiction: { scheme: "municipality", value: "roebel-mueritz" },
    municipalityId: "roebel-mueritz",
    sourceScope: {
      municipalityId: "roebel-mueritz",
      caseId: "marienfelder-strasse",
    },
    authorityBinding: "none",
    formalDecision: null,
    discussion: {},
    discussions: [],
    suggestion: { status: "admitted" },
    suggestions: [],
    provenance: {},
    departmentPackages,
    reviewedCitizenBrief,
  };

  if (completed) {
    projection.participationResult = {
      schemaVersion: "participation_result_v1",
      id: "participation-1",
      question: "Welche Querungsvariante soll zuerst geprüft werden?",
      options: [
        { optionId: "lighting", label: "Beleuchtung", aggregateCount: 2 },
        {
          optionId: "marked-crossing",
          label: "Markierte Querung",
          aggregateCount: 6,
        },
      ],
      totalAccepted: 8,
      resultSummary:
        "Die markierte Querung erhielt das stärkste synthetische beratende Signal.",
      limitations: ["Advisory synthetic signal only."],
      checksum: sha(401),
      correctionState: "current",
      authorityBinding: "none",
      advisory: true,
    };
    projection.reviewedOutcome = {
      schemaVersion: "reviewed_outcome_projection_v1",
      id: "outcome-1",
      summary:
        "Die markierte Querung wird als stärkstes synthetisches Ergebnis weiter geprüft.",
      sourceBrief: {
        id: reviewedCitizenBrief.id,
        briefChecksum: reviewedCitizenBrief.briefChecksum,
      },
      sourceParticipation: {
        id: "participation-1",
        participationChecksum: sha(401),
      },
      authorityBinding: "none",
      correctionState: "current",
      advisory: true,
      formalDecision: null,
      externalPublication: false,
      outcomeChecksum: sha(402),
    };
  }

  return {
    schemaVersion: "projection_envelope_v1",
    caseId: projection.caseId,
    caseVersion: 30,
    journalHeadChecksum: sha(300),
    projectionChecksum: sha(301),
    visibility: "public",
    policyVersion: POLICY_VERSION,
    projection,
  };
}

test("projects a current Citizen Brief before participation has opened", () => {
  const result = toStadtstackAdvisoryCase(fixture());

  assert.equal(result.participationState, "brief_ready");
  assert.equal(result.participation, null);
  assert.equal(
    result.title,
    "Sichere Querung an der Marienfelder Straße prüfen"
  );
  assert.equal(result.sourceDiscussionId, DISCUSSION_ID);
  assert.equal(result.reviewedDepartmentCount, 8);
  assert.equal(result.briefChecksum, sha(400));
  assert.deepEqual(result.budgetContext, {
    departmentLabel: "Finanzen",
    publicSummary: "Reviewed finance response.",
    publicCitations: ["https://stadt.example/review/finance"],
    reviewedAt: "2026-08-22T08:00:00.000Z",
    packageBinding: {
      packageId: "package-finance",
      packageChecksum: sha(13),
      artifactChecksum: sha(103),
    },
  });
  assert.equal(result.authorityBinding, "none");
  assert.deepEqual(result.effects, {
    formalVote: false,
    governance: false,
    treasury: false,
  });
});

test("projects a checksum-bound advisory result as a later state", () => {
  const result = toStadtstackAdvisoryCase(fixture({ completed: true }));

  assert.equal(result.participationState, "result_current");
  assert.deepEqual(result.participation, {
    id: "participation-1",
    question: "Welche Querungsvariante soll zuerst geprüft werden?",
    options: [
      { id: "lighting", label: "Beleuchtung", count: 2 },
      { id: "marked-crossing", label: "Markierte Querung", count: 6 },
    ],
    totalAccepted: 8,
    resultSummary:
      "Die markierte Querung erhielt das stärkste synthetische beratende Signal.",
    outcomeSummary:
      "Die markierte Querung wird als stärkstes synthetisches Ergebnis weiter geprüft.",
    participationChecksum: sha(401),
    outcomeChecksum: sha(402),
    advisory: true,
  });
});

test("fails closed for corrected, invalidated, or retracted briefs", () => {
  for (const correctionState of ["corrected", "invalidated", "retracted"]) {
    const value = fixture();
    value.projection.reviewedCitizenBrief.correctionState = correctionState;
    if (correctionState === "invalidated") {
      value.projection.reviewedCitizenBrief.summary = "";
      value.projection.reviewedCitizenBrief.responses = [];
    }
    assert.throws(
      () => toStadtstackAdvisoryCase(value),
      /stadtstack_advisory_projection_invalid/
    );
  }
});

test("requires the participation result and reviewed outcome as one bound pair", () => {
  const withoutOutcome = fixture({ completed: true });
  delete withoutOutcome.projection.reviewedOutcome;
  assert.throws(
    () => toStadtstackAdvisoryCase(withoutOutcome),
    /stadtstack_advisory_projection_invalid/
  );

  const withoutResult = fixture({ completed: true });
  delete withoutResult.projection.participationResult;
  assert.throws(
    () => toStadtstackAdvisoryCase(withoutResult),
    /stadtstack_advisory_projection_invalid/
  );
});

test("rejects formal authority, treasury data, and malformed advisory results", () => {
  for (const mutate of [
    (value: any) => {
      value.projection.formalDecision = { id: "forbidden" };
    },
    (value: any) => {
      value.projection.treasuryExecution = { transaction: "forbidden" };
    },
    (value: any) => {
      value.projection.reviewedOutcome.formalDecision = { id: "forbidden" };
    },
    (value: any) => {
      value.projection.reviewedOutcome.externalPublication = true;
    },
    (value: any) => {
      value.projection.participationResult.totalAccepted = 9;
    },
    (value: any) => {
      value.projection.reviewedOutcome.sourceBrief.briefChecksum = sha(999);
    },
  ]) {
    const value = fixture({ completed: true });
    mutate(value);
    assert.throws(
      () => toStadtstackAdvisoryCase(value),
      /stadtstack_advisory_projection_invalid/
    );
  }
});

test("rejects non-Nostr or mismatched source-discussion provenance", () => {
  for (const mutate of [
    (value: any) => {
      value.projection.reviewedCitizenBrief.provenance.sourceDiscussionRef.type =
        "url";
    },
    (value: any) => {
      value.projection.reviewedCitizenBrief.provenance.sourceDiscussionRef.ref =
        "nostr://event/another-event";
    },
  ]) {
    const value = fixture();
    mutate(value);
    assert.throws(
      () => toStadtstackAdvisoryCase(value),
      /stadtstack_advisory_projection_invalid/
    );
  }
});
