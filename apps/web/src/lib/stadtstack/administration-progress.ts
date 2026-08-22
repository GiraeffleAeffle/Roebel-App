export const STADTSTACK_ADMINISTRATION_PROGRESS_SCHEMA_VERSION =
  "roebel_stadtstack_administration_progress_v1" as const;

export const STADTSTACK_REQUIRED_DEPARTMENTS = [
  { id: "planning", label: "Stadtplanung" },
  { id: "traffic", label: "Verkehr" },
  { id: "environment", label: "Umwelt" },
  { id: "finance", label: "Finanzen" },
  { id: "legal", label: "Recht" },
  { id: "public-order", label: "Ordnung" },
  { id: "social-affairs", label: "Soziales" },
  { id: "public-works", label: "Öffentliche Infrastruktur" },
] as const;

export type StadtstackDepartmentId =
  (typeof STADTSTACK_REQUIRED_DEPARTMENTS)[number]["id"];

export type StadtstackAdministrationProgressStatus =
  | "waiting_for_department_review"
  | "ready_for_case_steward"
  | "citizen_brief_current";

export type StadtstackAdministrationProgress = {
  schemaVersion: typeof STADTSTACK_ADMINISTRATION_PROGRESS_SCHEMA_VERSION;
  status: StadtstackAdministrationProgressStatus;
  caseBinding: {
    caseId: string;
    caseVersion: number;
    journalHeadChecksum: string;
    projectionChecksum: string;
    policyVersion: string;
  };
  acceptedCount: number;
  requiredCount: 8;
  departments: Array<{
    id: StadtstackDepartmentId;
    label: string;
    state: "reviewed" | "not_publicly_reviewed";
    reviewedAt: string | null;
    publicSummary: string | null;
    publicCitations: string[];
  }>;
  currentBrief: {
    id: string;
    title: string;
    summary: string;
    briefChecksum: string;
  } | null;
  authorityBinding: "none";
  effects: {
    civicCaseMutation: false;
    publication: false;
    formalSubmission: false;
    voting: false;
    treasuryEffect: false;
  };
};

const SHA256 = /^sha256:[0-9a-f]{64}$/;
const CONTROL = /[\u0000-\u001f\u007f]/u;
const PUBLIC_PROJECTION_KEYS = new Set([
  "schemaVersion",
  "caseId",
  "jurisdiction",
  "municipalityId",
  "sourceScope",
  "authorityBinding",
  "formalDecision",
  "discussion",
  "discussions",
  "suggestion",
  "suggestions",
  "provenance",
  "departmentPackage",
  "departmentPackages",
  "reviewedCitizenBrief",
  "participationResult",
  "reviewedOutcome",
  "councilDryRunBrief",
]);
const PUBLIC_PACKAGE_KEYS = [
  "schemaVersion",
  "id",
  "departmentId",
  "suggestionId",
  "request",
  "packageChecksum",
  "reviewState",
  "correctionState",
  "artifactChecksum",
  "reviewedAt",
  "policyVersion",
  "publicSummary",
  "publicCitations",
  "authorityBinding",
] as const;
const EFFECTS = Object.freeze({
  civicCaseMutation: false,
  publication: false,
  formalSubmission: false,
  voting: false,
  treasuryEffect: false,
} as const);

function fail(code: string): never {
  throw new Error(code);
}

function record(value: unknown, code: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(code);
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  code: string
): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (
    actual.length !== wanted.length ||
    actual.some((key, index) => key !== wanted[index])
  ) {
    fail(code);
  }
}

function allowedKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  code: string
): void {
  if (Object.keys(value).some((key) => !allowed.has(key))) fail(code);
}

function text(
  value: unknown,
  code: string,
  { allowEmpty = false, max = 4_000 } = {}
): string {
  if (
    typeof value !== "string" ||
    value !== value.trim() ||
    (!allowEmpty && value.length === 0) ||
    value.length > max ||
    CONTROL.test(value)
  ) {
    fail(code);
  }
  return value;
}

function digest(value: unknown, code: string): string {
  if (typeof value !== "string" || !SHA256.test(value)) fail(code);
  return value;
}

function timestamp(value: unknown, code: string): string {
  const result = text(value, code, { max: 64 });
  if (!result.includes("T") || Number.isNaN(Date.parse(result))) fail(code);
  return result;
}

function citations(value: unknown, code: string): string[] {
  if (!Array.isArray(value) || value.length > 32) fail(code);
  return value.map((entry) => text(entry, code, { max: 2_048 }));
}

function sameStrings(
  left: readonly string[],
  right: readonly string[]
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

type ReviewedDepartment = {
  id: StadtstackDepartmentId;
  packageId: string;
  packageChecksum: string;
  artifactChecksum: string;
  reviewedAt: string;
  publicSummary: string;
  publicCitations: string[];
};

function reviewedDepartment(
  value: unknown,
  policyVersion: string
): ReviewedDepartment {
  const item = record(value, "stadtstack_public_department_invalid");
  exactKeys(
    item,
    PUBLIC_PACKAGE_KEYS,
    "stadtstack_public_department_private_shape"
  );
  const departmentId = text(
    item.departmentId,
    "stadtstack_public_department_invalid",
    { max: 64 }
  );
  if (
    !STADTSTACK_REQUIRED_DEPARTMENTS.some(({ id }) => id === departmentId) ||
    item.schemaVersion !== "department_package_projection_v1" ||
    item.reviewState !== "accepted" ||
    item.correctionState !== "current" ||
    item.authorityBinding !== "none" ||
    item.policyVersion !== policyVersion
  ) {
    fail("stadtstack_public_department_invalid");
  }
  return {
    id: departmentId as StadtstackDepartmentId,
    packageId: text(item.id, "stadtstack_public_department_invalid", {
      max: 512,
    }),
    packageChecksum: digest(
      item.packageChecksum,
      "stadtstack_public_department_invalid"
    ),
    artifactChecksum: digest(
      item.artifactChecksum,
      "stadtstack_public_department_invalid"
    ),
    reviewedAt: timestamp(
      item.reviewedAt,
      "stadtstack_public_department_invalid"
    ),
    publicSummary: text(
      item.publicSummary,
      "stadtstack_public_department_invalid"
    ),
    publicCitations: citations(
      item.publicCitations,
      "stadtstack_public_department_invalid"
    ),
  };
}

function validateSourceReference(value: unknown): void {
  const source = record(value, "stadtstack_public_brief_provenance_invalid");
  exactKeys(
    source,
    ["type", "id", "ref"],
    "stadtstack_public_brief_provenance_invalid"
  );
  if (source.type !== "nostr_event") {
    fail("stadtstack_public_brief_provenance_invalid");
  }
  text(source.id, "stadtstack_public_brief_provenance_invalid", { max: 512 });
  text(source.ref, "stadtstack_public_brief_provenance_invalid", {
    max: 2_048,
  });
}

function validateBriefProvenance(
  value: unknown,
  departments: ReadonlyMap<StadtstackDepartmentId, ReviewedDepartment>,
  requireCurrentMatch: boolean
): void {
  const provenance = record(
    value,
    "stadtstack_public_brief_provenance_invalid"
  );
  exactKeys(
    provenance,
    ["sourceDiscussionRef", "suggestionId", "packageBindings"],
    "stadtstack_public_brief_provenance_invalid"
  );
  validateSourceReference(provenance.sourceDiscussionRef);
  text(provenance.suggestionId, "stadtstack_public_brief_provenance_invalid", {
    max: 512,
  });
  if (!Array.isArray(provenance.packageBindings)) {
    fail("stadtstack_public_brief_provenance_invalid");
  }
  const seen = new Set<string>();
  for (const rawBinding of provenance.packageBindings) {
    const binding = record(
      rawBinding,
      "stadtstack_public_brief_provenance_invalid"
    );
    exactKeys(
      binding,
      [
        "packageId",
        "packageChecksum",
        "draftArtifactChecksum",
        "reviewAttestationChecksum",
        "departmentId",
        "reviewedAt",
      ],
      "stadtstack_public_brief_provenance_invalid"
    );
    const departmentId = text(
      binding.departmentId,
      "stadtstack_public_brief_provenance_invalid",
      { max: 64 }
    ) as StadtstackDepartmentId;
    const department = departments.get(departmentId);
    if (
      !STADTSTACK_REQUIRED_DEPARTMENTS.some(({ id }) => id === departmentId) ||
      seen.has(departmentId) ||
      (requireCurrentMatch &&
        (!department ||
          binding.packageId !== department.packageId ||
          binding.packageChecksum !== department.packageChecksum ||
          binding.draftArtifactChecksum !== department.artifactChecksum ||
          binding.reviewedAt !== department.reviewedAt))
    ) {
      fail("stadtstack_public_brief_provenance_invalid");
    }
    text(binding.packageId, "stadtstack_public_brief_provenance_invalid", {
      max: 512,
    });
    digest(
      binding.packageChecksum,
      "stadtstack_public_brief_provenance_invalid"
    );
    digest(
      binding.draftArtifactChecksum,
      "stadtstack_public_brief_provenance_invalid"
    );
    digest(
      binding.reviewAttestationChecksum,
      "stadtstack_public_brief_provenance_invalid"
    );
    timestamp(binding.reviewedAt, "stadtstack_public_brief_provenance_invalid");
    seen.add(departmentId);
  }
  if (seen.size !== STADTSTACK_REQUIRED_DEPARTMENTS.length) {
    fail("stadtstack_public_brief_provenance_invalid");
  }
}

function currentBrief(
  value: unknown,
  policyVersion: string,
  departments: ReadonlyMap<StadtstackDepartmentId, ReviewedDepartment>
): StadtstackAdministrationProgress["currentBrief"] {
  if (value === undefined) return null;
  const brief = record(value, "stadtstack_public_brief_invalid");
  exactKeys(
    brief,
    [
      "schemaVersion",
      "id",
      "title",
      "summary",
      "responses",
      "provenance",
      "briefChecksum",
      "policyVersion",
      "correctionState",
      "authorityBinding",
    ],
    "stadtstack_public_brief_private_shape"
  );
  if (
    brief.schemaVersion !== "citizen_brief_projection_v1" ||
    brief.authorityBinding !== "none" ||
    brief.policyVersion !== policyVersion ||
    (brief.correctionState !== "current" &&
      brief.correctionState !== "invalidated") ||
    !Array.isArray(brief.responses)
  ) {
    fail("stadtstack_public_brief_invalid");
  }
  validateBriefProvenance(
    brief.provenance,
    departments,
    brief.correctionState === "current"
  );
  const id = text(brief.id, "stadtstack_public_brief_invalid", { max: 512 });
  const title = text(brief.title, "stadtstack_public_brief_invalid");
  const summary = text(brief.summary, "stadtstack_public_brief_invalid", {
    allowEmpty: brief.correctionState === "invalidated",
    max: 8_000,
  });
  const briefChecksum = digest(
    brief.briefChecksum,
    "stadtstack_public_brief_invalid"
  );
  if (brief.correctionState === "invalidated") {
    if (brief.responses.length !== 0 || summary !== "") {
      fail("stadtstack_public_brief_invalidated_shape");
    }
    return null;
  }
  if (
    departments.size !== STADTSTACK_REQUIRED_DEPARTMENTS.length ||
    brief.responses.length !== STADTSTACK_REQUIRED_DEPARTMENTS.length
  ) {
    fail("stadtstack_public_brief_incomplete");
  }
  const responseIds = new Set<string>();
  for (const rawResponse of brief.responses) {
    const response = record(rawResponse, "stadtstack_public_brief_invalid");
    exactKeys(
      response,
      ["departmentId", "publicSummary", "publicCitations"],
      "stadtstack_public_brief_invalid"
    );
    const departmentId = text(
      response.departmentId,
      "stadtstack_public_brief_invalid",
      { max: 64 }
    ) as StadtstackDepartmentId;
    const department = departments.get(departmentId);
    const responseSummary = text(
      response.publicSummary,
      "stadtstack_public_brief_invalid"
    );
    const responseCitations = citations(
      response.publicCitations,
      "stadtstack_public_brief_invalid"
    );
    if (
      !department ||
      responseIds.has(departmentId) ||
      responseSummary !== department.publicSummary ||
      !sameStrings(responseCitations, department.publicCitations)
    ) {
      fail("stadtstack_public_brief_inconsistent");
    }
    responseIds.add(departmentId);
  }
  return { id, title, summary, briefChecksum };
}

/**
 * Derive a UI-only administration progress projection from Stadtstack's
 * already-redacted public case view. Missing public packages stay unknown;
 * this reader never infers private review state or prepares a command.
 */
export function toStadtstackAdministrationProgress(
  value: unknown
): StadtstackAdministrationProgress {
  const envelope = record(value, "stadtstack_public_projection_invalid");
  exactKeys(
    envelope,
    [
      "schemaVersion",
      "caseId",
      "caseVersion",
      "journalHeadChecksum",
      "projectionChecksum",
      "visibility",
      "policyVersion",
      "projection",
    ],
    "stadtstack_public_projection_invalid"
  );
  const projection = record(
    envelope.projection,
    "stadtstack_public_projection_invalid"
  );
  allowedKeys(
    projection,
    PUBLIC_PROJECTION_KEYS,
    "stadtstack_public_projection_private_shape"
  );
  const caseId = text(envelope.caseId, "stadtstack_public_projection_invalid", {
    max: 512,
  });
  const policyVersion = text(
    envelope.policyVersion,
    "stadtstack_public_projection_invalid",
    { max: 256 }
  );
  const suggestion = record(
    projection.suggestion,
    "stadtstack_public_projection_invalid"
  );
  if (
    envelope.schemaVersion !== "projection_envelope_v1" ||
    envelope.visibility !== "public" ||
    projection.schemaVersion !== "case_projection_v1" ||
    projection.caseId !== caseId ||
    projection.municipalityId !== "roebel-mueritz" ||
    projection.authorityBinding !== "none" ||
    projection.formalDecision !== null ||
    suggestion.status !== "admitted" ||
    !Number.isSafeInteger(envelope.caseVersion) ||
    Number(envelope.caseVersion) < 1
  ) {
    fail("stadtstack_public_projection_invalid");
  }
  digest(envelope.journalHeadChecksum, "stadtstack_public_projection_invalid");
  digest(envelope.projectionChecksum, "stadtstack_public_projection_invalid");

  const rawPackages = projection.departmentPackages ?? [];
  if (!Array.isArray(rawPackages)) fail("stadtstack_public_department_invalid");
  const reviewed = new Map<StadtstackDepartmentId, ReviewedDepartment>();
  const packageIds = new Set<string>();
  for (const rawPackage of rawPackages) {
    const department = reviewedDepartment(rawPackage, policyVersion);
    if (reviewed.has(department.id) || packageIds.has(department.packageId)) {
      fail("stadtstack_public_department_duplicate");
    }
    reviewed.set(department.id, department);
    packageIds.add(department.packageId);
  }
  if (projection.departmentPackage !== undefined) {
    const singular = reviewedDepartment(
      projection.departmentPackage,
      policyVersion
    );
    const canonical = reviewed.get(singular.id);
    if (!canonical || JSON.stringify(canonical) !== JSON.stringify(singular)) {
      fail("stadtstack_public_department_singular_mismatch");
    }
  }

  const brief = currentBrief(
    projection.reviewedCitizenBrief,
    policyVersion,
    reviewed
  );
  const status: StadtstackAdministrationProgressStatus = brief
    ? "citizen_brief_current"
    : reviewed.size === STADTSTACK_REQUIRED_DEPARTMENTS.length
      ? "ready_for_case_steward"
      : "waiting_for_department_review";

  return {
    schemaVersion: STADTSTACK_ADMINISTRATION_PROGRESS_SCHEMA_VERSION,
    status,
    caseBinding: {
      caseId,
      caseVersion: Number(envelope.caseVersion),
      journalHeadChecksum: envelope.journalHeadChecksum as string,
      projectionChecksum: envelope.projectionChecksum as string,
      policyVersion,
    },
    acceptedCount: reviewed.size,
    requiredCount: 8,
    departments: STADTSTACK_REQUIRED_DEPARTMENTS.map(({ id, label }) => {
      const department = reviewed.get(id);
      return department
        ? {
            id,
            label,
            state: "reviewed" as const,
            reviewedAt: department.reviewedAt,
            publicSummary: department.publicSummary,
            publicCitations: [...department.publicCitations],
          }
        : {
            id,
            label,
            state: "not_publicly_reviewed" as const,
            reviewedAt: null,
            publicSummary: null,
            publicCitations: [],
          };
    }),
    currentBrief: brief,
    authorityBinding: "none",
    effects: { ...EFFECTS },
  };
}
