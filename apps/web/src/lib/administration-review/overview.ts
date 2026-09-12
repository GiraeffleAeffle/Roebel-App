export type DepartmentWork = {
  id: string; departmentId: string; request: string; reviewState: string;
  draft?: { publicSummary: string; publicCitations: string[] };
};
export type OverviewCase = {
  caseId: string; caseVersion: number;
  departmentPackages: DepartmentWork[];
  briefReadiness: { status: string; requiredDepartmentIds: string[]; acceptedDepartmentIds: string[];
    blockers?: { departmentId: string; reason: string }[] } | null;
};
export type TopicOrigin = {
  rootId: string; caseId: string; topicId: string; title: string; content: string;
  createdAt: string; admissionVersion: number; receiptChecksum: string; testOnly: boolean;
  sources: { id: string; content: string; createdAt: string }[];
};

/** A public receipt joins only its exact Case. An inaccessible department is
 * unknown, not unassigned, and another Case's progress can never fill the gap. */
export function matchingCase<T extends OverviewCase>(origin: TopicOrigin | null, view: T | null): T | null {
  return view && (!origin || (origin.caseId === view.caseId && view.caseVersion >= origin.admissionVersion)) ? view : null;
}
export function departmentOverview(ids: readonly string[], view: OverviewCase | null) {
  return ids.map(id => {
    if (!view) return { id, state: "unknown", next: "Verwaltungsstand noch nicht verbunden", packages: [] as DepartmentWork[] };
    const packages = view.departmentPackages.filter(pkg => pkg.departmentId === id);
    const blocked = view.briefReadiness?.blockers?.some(item => item.departmentId === id);
    if (!packages.length) return { id, state: "unassigned", next: "Fallkoordination: Prüfauftrag zuweisen", packages };
    if (packages.some(pkg => pkg.reviewState === "rejected")) return { id, state: "rejected", next: "Fachbereich: Antwort überarbeiten; Korrekturzugang fehlt noch", packages };
    if (packages.some(pkg => !pkg.draft)) return { id, state: "assigned", next: "Fachbereich: Antwort mit Quellen erstellen", packages };
    if (packages.some(pkg => pkg.reviewState !== "accepted")) return { id, state: "pending", next: "Prüfrolle: Antwort und Quellen prüfen", packages };
    if (blocked || (view.briefReadiness && !view.briefReadiness.acceptedDepartmentIds.includes(id))) return { id, state: "blocked", next: "Fallkoordination: Gültigkeit der Prüfung klären", packages };
    return { id, state: "accepted", next: "Geprüfte Antwort liegt vor", packages };
  });
}
