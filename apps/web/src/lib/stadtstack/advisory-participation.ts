const SHA256 = /^sha256:[0-9a-f]{64}$/;
const NOSTR_EVENT_ID = /^[0-9a-f]{64}$/;

export type StadtstackAdvisoryCase = {
  caseId: string;
  caseVersion: number;
  title: string;
  summary: string;
  sourceDiscussionId: string;
  reviewedDepartmentCount: number;
  question: string;
  options: Array<{ id: string; label: string; count: number }>;
  totalAccepted: number;
  resultSummary: string;
  outcomeSummary: string;
  briefChecksum: string;
  participationChecksum: string;
  outcomeChecksum: string;
  advisory: true;
  formalDecision: null;
  externalPublication: false;
};

function fail(): never {
  throw new Error("stadtstack_advisory_projection_invalid");
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail();
  return value as Record<string, unknown>;
}

function text(value: unknown, max = 8_192): string {
  if (typeof value !== "string" || value.length === 0 || value.length > max || value !== value.trim()) fail();
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
 * Narrow public adapter between the Stadtstack projection and Röbel's
 * Mitmachen surface. It deliberately refuses formal decisions, publication,
 * stale briefs and broken checksum links instead of treating them as votes.
 */
export function toStadtstackAdvisoryCase(value: unknown): StadtstackAdvisoryCase {
  const envelope = record(value);
  const projection = record(envelope.projection);
  const brief = record(projection.reviewedCitizenBrief);
  const participation = record(projection.participationResult);
  const outcome = record(projection.reviewedOutcome);
  const provenance = record(brief.provenance);
  const discussion = record(provenance.sourceDiscussionRef);
  const sourceBrief = record(outcome.sourceBrief);
  const sourceParticipation = record(outcome.sourceParticipation);

  const caseId = text(envelope.caseId, 240);
  const caseVersion = nonNegativeInteger(envelope.caseVersion);
  const briefChecksum = checksum(brief.briefChecksum);
  const participationChecksum = checksum(participation.checksum);
  const outcomeChecksum = checksum(outcome.outcomeChecksum);
  const sourceDiscussionId = text(discussion.id, 64);
  if (!NOSTR_EVENT_ID.test(sourceDiscussionId)) fail();

  if (
    envelope.schemaVersion !== "projection_envelope_v1" ||
    envelope.visibility !== "public" ||
    !SHA256.test(text(envelope.journalHeadChecksum, 71)) ||
    !SHA256.test(text(envelope.projectionChecksum, 71)) ||
    brief.schemaVersion !== "citizen_brief_projection_v1" ||
    brief.correctionState !== "current" ||
    brief.authorityBinding !== "none" ||
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
    discussion.type !== "nostr_event" ||
    discussion.ref !== `nostr://event/${sourceDiscussionId}` ||
    sourceBrief.id !== brief.id ||
    sourceBrief.briefChecksum !== briefChecksum ||
    sourceParticipation.id !== participation.id ||
    sourceParticipation.participationChecksum !== participationChecksum
  ) fail();

  if (!Array.isArray(brief.responses) || brief.responses.length === 0 || brief.responses.length > 32) fail();
  const departmentIds = new Set<string>();
  for (const responseValue of brief.responses) {
    const response = record(responseValue);
    const departmentId = text(response.departmentId, 120);
    if (departmentIds.has(departmentId)) fail();
    departmentIds.add(departmentId);
    text(response.publicSummary, 2_000);
    if (!Array.isArray(response.publicCitations) || response.publicCitations.length === 0) fail();
    for (const citation of response.publicCitations) text(citation, 2_000);
  }

  if (!Array.isArray(participation.options) || participation.options.length < 2 || participation.options.length > 20) fail();
  const optionIds = new Set<string>();
  const options = participation.options.map((optionValue) => {
    const option = record(optionValue);
    const id = text(option.optionId, 120);
    if (optionIds.has(id)) fail();
    optionIds.add(id);
    return { id, label: text(option.label, 240), count: nonNegativeInteger(option.aggregateCount) };
  });
  const totalAccepted = nonNegativeInteger(participation.totalAccepted);
  if (options.reduce((sum, option) => sum + option.count, 0) !== totalAccepted) fail();

  return {
    caseId,
    caseVersion,
    title: text(brief.title, 240),
    summary: text(brief.summary, 16_000),
    sourceDiscussionId,
    reviewedDepartmentCount: departmentIds.size,
    question: text(participation.question, 2_000),
    options,
    totalAccepted,
    resultSummary: text(participation.resultSummary, 4_000),
    outcomeSummary: text(outcome.summary, 4_000),
    briefChecksum,
    participationChecksum,
    outcomeChecksum,
    advisory: true,
    formalDecision: null,
    externalPublication: false,
  };
}
