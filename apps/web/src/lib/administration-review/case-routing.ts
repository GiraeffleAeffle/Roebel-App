/** Deployment-owned Case selection, shared by the staff and public readers. */
export type ReviewCaseScope = { caseId: string; additionalCaseIds?: readonly string[] };
const CASE = /^urn:stadtstack:synthetic-case:municipality:([a-z0-9-]+):[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function reviewCaseIds(scope: ReviewCaseScope): readonly string[] {
  const municipality = CASE.exec(scope.caseId)?.[1], extra = scope.additionalCaseIds === undefined ? [] : scope.additionalCaseIds;
  if (!municipality || !Array.isArray(extra) || extra.length > 7 ||
    extra.some(id => typeof id !== "string" || CASE.exec(id)?.[1] !== municipality) ||
    new Set([scope.caseId, ...extra]).size !== extra.length + 1) throw Error("review_case_configuration_invalid");
  return [scope.caseId, ...extra];
}

export function reviewUpstreamPath(defaultCaseId: string, caseId: string, operation: "review" | "citizen-brief"): string {
  return caseId === defaultCaseId ? `/v1/staging/administration/${operation}`
    : `/v1/staging/administration/cases/${encodeURIComponent(caseId)}/${operation}`;
}

/** null selects the configured default; callers must wait while the topic is unresolved. */
export function workspaceReviewPath(caseId: string | null, role?: string): string {
  const params = new URLSearchParams();
  if (caseId !== null) params.set("caseId", caseId);
  if (role !== undefined) params.set("role", role);
  return "/api/workspace/case-review" + (params.size ? `?${params}` : "");
}
