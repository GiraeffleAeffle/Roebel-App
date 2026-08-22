import {
  toStadtstackAdministrationProgress,
  type StadtstackAdministrationProgress,
} from "./administration-progress";

const SHA256 = /^sha256:[0-9a-f]{64}$/;
const NOSTR_EVENT_ID = /^[0-9a-f]{64}$/;
const CONTROL = /[\u0000-\u001f\u007f]/u;
const EFFECTS = Object.freeze({
  formalVote: false,
  governance: false,
  treasury: false,
} as const);

type StadtstackAdvisoryBase = {
  caseId: string;
  caseVersion: number;
  title: string;
  summary: string;
  sourceDiscussionId: string;
  reviewedDepartmentCount: number;
  briefChecksum: string;
  budgetContext: {
    departmentLabel: "Finanzen";
    publicSummary: string;
    publicCitations: string[];
    reviewedAt: string;
    packageBinding: {
      packageId: string;
      packageChecksum: string;
      artifactChecksum: string;
    };
  };
  authorityBinding: "none";
  effects: typeof EFFECTS;
};

export type StadtstackAdvisoryCase = StadtstackAdvisoryBase &
  (
    | {
        participationState: "brief_ready";
        participation: null;
      }
    | {
        participationState: "result_current";
        participation: {
          id: string;
          question: string;
          options: Array<{ id: string; label: string; count: number }>;
          totalAccepted: number;
          resultSummary: string;
          outcomeSummary: string;
          participationChecksum: string;
          outcomeChecksum: string;
          advisory: true;
        };
      }
  );

function fail(): never {
  throw new Error("stadtstack_advisory_projection_invalid");
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail();
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[]
): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (
    actual.length !== wanted.length ||
    actual.some((key, index) => key !== wanted[index])
  ) {
    fail();
  }
}

function text(value: unknown, max = 8_192): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > max ||
    value !== value.trim() ||
    CONTROL.test(value)
  ) {
    fail();
  }
  return value;
}

function checksum(value: unknown): string {
  const candidate = text(value, 71);
  if (!SHA256.test(candidate)) fail();
  return candidate;
}

function nonNegativeInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) fail();
  return value as number;
}

/**
 * Deep read-only seam between Stadtstack's public case projection and Röbel's
 * Mitmachen surface. A current Citizen Brief is visible before any round or
 * result exists. Result and reviewed outcome must later arrive as one exact,
 * checksum-bound pair; authority-bearing shapes are refused upstream.
 */
export function toStadtstackAdvisoryCase(
  value: unknown
): StadtstackAdvisoryCase {
  let administration: StadtstackAdministrationProgress;
  try {
    administration = toStadtstackAdministrationProgress(value);
  } catch {
    fail();
  }
  if (
    administration.status !== "citizen_brief_current" ||
    !administration.currentBrief ||
    administration.authorityBinding !== "none"
  ) {
    fail();
  }

  const envelope = record(value);
  const projection = record(envelope.projection);
  const brief = record(projection.reviewedCitizenBrief);
  const provenance = record(brief.provenance);
  const discussion = record(provenance.sourceDiscussionRef);
  const sourceDiscussionId = text(discussion.id, 64);
  if (
    discussion.type !== "nostr_event" ||
    !NOSTR_EVENT_ID.test(sourceDiscussionId) ||
    discussion.ref !== `nostr://event/${sourceDiscussionId}`
  ) {
    fail();
  }

  const finance = administration.departments.find(
    (department) => department.id === "finance"
  );
  if (
    !finance ||
    finance.state !== "reviewed" ||
    finance.label !== "Finanzen" ||
    !finance.publicSummary ||
    !finance.reviewedAt ||
    !finance.packageBinding
  ) {
    fail();
  }

  const base: StadtstackAdvisoryBase = {
    caseId: administration.caseBinding.caseId,
    caseVersion: administration.caseBinding.caseVersion,
    title: administration.currentBrief.title,
    summary: administration.currentBrief.summary,
    sourceDiscussionId,
    reviewedDepartmentCount: administration.acceptedCount,
    briefChecksum: administration.currentBrief.briefChecksum,
    budgetContext: {
      departmentLabel: "Finanzen",
      publicSummary: finance.publicSummary,
      publicCitations: [...finance.publicCitations],
      reviewedAt: finance.reviewedAt,
      packageBinding: { ...finance.packageBinding },
    },
    authorityBinding: "none",
    effects: { ...EFFECTS },
  };

  const participationValue = projection.participationResult;
  const outcomeValue = projection.reviewedOutcome;
  if (participationValue === undefined && outcomeValue === undefined) {
    return {
      ...base,
      participationState: "brief_ready",
      participation: null,
    };
  }
  if (participationValue === undefined || outcomeValue === undefined) fail();

  const participation = record(participationValue);
  const outcome = record(outcomeValue);
  exactKeys(participation, [
    "schemaVersion",
    "id",
    "question",
    "options",
    "totalAccepted",
    "resultSummary",
    "limitations",
    "checksum",
    "correctionState",
    "authorityBinding",
    "advisory",
  ]);
  exactKeys(outcome, [
    "schemaVersion",
    "id",
    "summary",
    "sourceBrief",
    "sourceParticipation",
    "authorityBinding",
    "correctionState",
    "advisory",
    "formalDecision",
    "externalPublication",
    "outcomeChecksum",
  ]);

  const sourceBrief = record(outcome.sourceBrief);
  const sourceParticipation = record(outcome.sourceParticipation);
  exactKeys(sourceBrief, ["id", "briefChecksum"]);
  exactKeys(sourceParticipation, ["id", "participationChecksum"]);

  const participationId = text(participation.id, 512);
  const participationChecksum = checksum(participation.checksum);
  const outcomeChecksum = checksum(outcome.outcomeChecksum);
  if (
    participation.schemaVersion !== "participation_result_v1" ||
    participation.correctionState !== "current" ||
    participation.authorityBinding !== "none" ||
    participation.advisory !== true ||
    outcome.schemaVersion !== "reviewed_outcome_projection_v1" ||
    outcome.correctionState !== "current" ||
    outcome.authorityBinding !== "none" ||
    outcome.advisory !== true ||
    outcome.formalDecision !== null ||
    outcome.externalPublication !== false ||
    sourceBrief.id !== administration.currentBrief.id ||
    sourceBrief.briefChecksum !== administration.currentBrief.briefChecksum ||
    sourceParticipation.id !== participationId ||
    sourceParticipation.participationChecksum !== participationChecksum
  ) {
    fail();
  }

  if (
    !Array.isArray(participation.limitations) ||
    participation.limitations.length === 0 ||
    participation.limitations.length > 32
  ) {
    fail();
  }
  for (const limitation of participation.limitations) text(limitation, 2_000);

  if (
    !Array.isArray(participation.options) ||
    participation.options.length < 2 ||
    participation.options.length > 20
  ) {
    fail();
  }
  const optionIds = new Set<string>();
  const options = participation.options.map((optionValue) => {
    const option = record(optionValue);
    exactKeys(option, ["optionId", "label", "aggregateCount"]);
    const id = text(option.optionId, 120);
    if (optionIds.has(id)) fail();
    optionIds.add(id);
    return {
      id,
      label: text(option.label, 240),
      count: nonNegativeInteger(option.aggregateCount),
    };
  });
  const totalAccepted = nonNegativeInteger(participation.totalAccepted);
  if (
    options.reduce((sum, option) => sum + option.count, 0) !== totalAccepted
  ) {
    fail();
  }

  return {
    ...base,
    participationState: "result_current",
    participation: {
      id: participationId,
      question: text(participation.question, 2_000),
      options,
      totalAccepted,
      resultSummary: text(participation.resultSummary, 4_000),
      outcomeSummary: text(outcome.summary, 4_000),
      participationChecksum,
      outcomeChecksum,
      advisory: true,
    },
  };
}
