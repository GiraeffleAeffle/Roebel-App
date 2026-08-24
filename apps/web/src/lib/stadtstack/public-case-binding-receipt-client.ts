export type VerifiedPublicCaseBindingReceipt = Readonly<{
  schemaVersion: "public_case_binding_receipt_v1";
  rootEventId: string;
  topicId: string;
  candidateId: string;
  candidateEventId: string;
  sourceAnswerEventId: string;
  caseId: string;
  caseVersion: 3;
  caseEventIds: readonly [string, string, string];
  journalHeadChecksum: string;
  admissionEventChecksum: string;
  receiptChecksum: string;
  authorityBinding: "none";
  openDeskWrite: false;
}>;

const ROOT_EVENT_ID = /^[0-9a-f]{64}$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const CASE_ID =
  /^urn:stadtstack:case:municipality:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?:[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function receipt(value: unknown, rootEventId: string): VerifiedPublicCaseBindingReceipt | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const parsed = value as Record<string, unknown>;
  const caseEventIds = parsed.caseEventIds;
  if (
    parsed.schemaVersion !== "public_case_binding_receipt_v1" ||
    parsed.rootEventId !== rootEventId ||
    typeof parsed.topicId !== "string" ||
    typeof parsed.candidateId !== "string" ||
    typeof parsed.candidateEventId !== "string" ||
    typeof parsed.sourceAnswerEventId !== "string" ||
    typeof parsed.caseId !== "string" ||
    !CASE_ID.test(parsed.caseId) ||
    parsed.caseVersion !== 3 ||
    !Array.isArray(caseEventIds) ||
    caseEventIds.length !== 3 ||
    !caseEventIds.every((entry) => typeof entry === "string") ||
    typeof parsed.journalHeadChecksum !== "string" ||
    !SHA256.test(parsed.journalHeadChecksum) ||
    parsed.admissionEventChecksum !== parsed.journalHeadChecksum ||
    typeof parsed.receiptChecksum !== "string" ||
    !SHA256.test(parsed.receiptChecksum) ||
    parsed.authorityBinding !== "none" ||
    parsed.openDeskWrite !== false
  ) {
    return null;
  }
  return parsed as unknown as VerifiedPublicCaseBindingReceipt;
}

/**
 * The browser gets only the BFF result. The BFF verifies the canonical
 * checksum before returning it; this second structural guard keeps malformed
 * route responses from becoming UI state.
 */
export async function loadVerifiedPublicCaseBindingReceipt(
  rootEventId: string,
  fetchImpl: typeof fetch = fetch
): Promise<VerifiedPublicCaseBindingReceipt | null> {
  if (!ROOT_EVENT_ID.test(rootEventId)) return null;
  const response = await fetchImpl(
    `/api/stadtstack/case-bindings/by-discussion/${rootEventId}`,
    { method: "GET", cache: "no-store", credentials: "same-origin" }
  );
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("public_case_binding_unavailable");
  const value: unknown = await response.json();
  const verified = receipt(value, rootEventId);
  if (
    !verified ||
    response.headers.get("x-stadtstack-receipt-sha256") !==
      verified.receiptChecksum
  ) {
    throw new Error("public_case_binding_unavailable");
  }
  return verified;
}
