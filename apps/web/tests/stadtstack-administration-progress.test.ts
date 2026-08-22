import assert from "node:assert/strict";
import test from "node:test";

import {
  STADTSTACK_REQUIRED_DEPARTMENTS,
  toStadtstackAdministrationProgress,
} from "../src/lib/stadtstack/administration-progress";

const departments = STADTSTACK_REQUIRED_DEPARTMENTS.map(({ id }) => id);

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
    policyVersion: "case-intake-v1",
    publicSummary: `Reviewed ${departmentId} response.`,
    publicCitations: [`https://stadt.example/review/${departmentId}`],
    authorityBinding: "none",
  };
}

function publicProjection(count = departments.length) {
  const packages = departments
    .slice(0, count)
    .map((departmentId, index) => reviewedPackage(departmentId, index));
  return {
    schemaVersion: "projection_envelope_v1",
    caseId: "urn:stadtstack:case:roebel:fixture",
    caseVersion: 26,
    journalHeadChecksum: sha(300),
    projectionChecksum: sha(301),
    visibility: "public",
    policyVersion: "case-intake-v1",
    projection: {
      schemaVersion: "case_projection_v1",
      caseId: "urn:stadtstack:case:roebel:fixture",
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
      suggestion: {
        status: "admitted",
      },
      suggestions: [],
      provenance: {},
      departmentPackages: packages,
    },
  };
}

function addCurrentBrief(value: ReturnType<typeof publicProjection>) {
  const packageByDepartment = new Map(
    value.projection.departmentPackages.map((item) => [item.departmentId, item])
  );
  return {
    ...value,
    projection: {
      ...value.projection,
      reviewedCitizenBrief: {
        schemaVersion: "citizen_brief_projection_v1",
        id: "urn:stadtstack:citizen-brief:fixture:1",
        title: "Sichere Querung prüfen",
        summary: "Acht geprüfte Fachantworten sind öffentlich zusammengeführt.",
        responses: departments.map((departmentId) => {
          const item = packageByDepartment.get(departmentId)!;
          return {
            departmentId,
            publicSummary: item.publicSummary,
            publicCitations: item.publicCitations,
          };
        }),
        provenance: {
          sourceDiscussionRef: {
            type: "nostr_event",
            id: "discussion-fixture",
            ref: "nostr://event/discussion-fixture",
          },
          suggestionId: "urn:stadtstack:suggestion:fixture",
          packageBindings: departments.map((departmentId, index) => {
            const item = packageByDepartment.get(departmentId)!;
            return {
              packageId: item.id,
              packageChecksum: item.packageChecksum,
              draftArtifactChecksum: item.artifactChecksum,
              reviewAttestationChecksum: sha(200 + index),
              departmentId,
              reviewedAt: item.reviewedAt,
            };
          }),
        },
        briefChecksum: sha(400),
        policyVersion: "case-intake-v1",
        correctionState: "current",
        authorityBinding: "none",
      },
    },
  };
}

test("shows only publicly reviewed departments and never guesses private state", () => {
  const progress = toStadtstackAdministrationProgress(publicProjection(3));

  assert.equal(progress.status, "waiting_for_department_review");
  assert.equal(progress.acceptedCount, 3);
  assert.equal(progress.requiredCount, 8);
  assert.deepEqual(
    progress.departments.map(({ id }) => id),
    departments
  );
  assert.equal(progress.departments[0]?.state, "reviewed");
  assert.deepEqual(progress.departments[0]?.packageBinding, {
    packageId: "package-planning",
    packageChecksum: sha(10),
    artifactChecksum: sha(100),
  });
  assert.equal(progress.departments[3]?.state, "not_publicly_reviewed");
  assert.equal(progress.departments[3]?.packageBinding, null);
  assert.equal(progress.departments[3]?.publicSummary, null);
  assert.deepEqual(progress.effects, {
    civicCaseMutation: false,
    publication: false,
    formalSubmission: false,
    voting: false,
    treasuryEffect: false,
  });
  assert.doesNotMatch(
    JSON.stringify(progress),
    /pending|rejected|reviewer|agent/
  );
});

test("marks eight reviewed packages ready without deriving the brief", () => {
  const progress = toStadtstackAdministrationProgress(publicProjection());

  assert.equal(progress.status, "ready_for_case_steward");
  assert.equal(progress.acceptedCount, 8);
  assert.equal(progress.currentBrief, null);
  assert.equal(progress.authorityBinding, "none");
});

test("accepts a checksum-bound current Citizen Brief covering the exact set", () => {
  const progress = toStadtstackAdministrationProgress(
    addCurrentBrief(publicProjection())
  );

  assert.equal(progress.status, "citizen_brief_current");
  assert.equal(progress.currentBrief?.title, "Sichere Querung prüfen");
  assert.equal(progress.currentBrief?.briefChecksum, sha(400));
});

test("does not let an invalidated old brief hide current public review progress", () => {
  const value = addCurrentBrief(publicProjection());
  value.projection.departmentPackages =
    value.projection.departmentPackages.slice(1);
  value.projection.reviewedCitizenBrief.correctionState = "invalidated";
  value.projection.reviewedCitizenBrief.summary = "";
  value.projection.reviewedCitizenBrief.responses = [];

  const progress = toStadtstackAdministrationProgress(value);

  assert.equal(progress.status, "waiting_for_department_review");
  assert.equal(progress.acceptedCount, 7);
  assert.equal(progress.currentBrief, null);
  assert.equal(progress.departments[0]?.state, "not_publicly_reviewed");
});

test("fails closed on private department fields and inconsistent briefs", () => {
  const privateLeak = publicProjection(1);
  Object.assign(privateLeak.projection.departmentPackages[0]!, {
    assignedReviewerActorId: "private:reviewer",
  });
  assert.throws(
    () => toStadtstackAdministrationProgress(privateLeak),
    /stadtstack_public_department_private_shape/
  );

  const inconsistent = addCurrentBrief(publicProjection());
  inconsistent.projection.reviewedCitizenBrief.responses[0]!.publicSummary =
    "Changed after review.";
  assert.throws(
    () => toStadtstackAdministrationProgress(inconsistent),
    /stadtstack_public_brief_inconsistent/
  );
});

test("rejects administration views, wrong municipalities, and automatic cases", () => {
  const administration = publicProjection();
  administration.visibility = "administration";
  assert.throws(
    () => toStadtstackAdministrationProgress(administration),
    /stadtstack_public_projection_invalid/
  );

  const wrongTown = publicProjection();
  wrongTown.projection.municipalityId = "another-town";
  assert.throws(
    () => toStadtstackAdministrationProgress(wrongTown),
    /stadtstack_public_projection_invalid/
  );

  const draft = publicProjection();
  draft.projection.suggestion.status = "draft";
  assert.throws(
    () => toStadtstackAdministrationProgress(draft),
    /stadtstack_public_projection_invalid/
  );
});
