/** Display names only; role and authority checks continue to use department IDs. */
export const DEPARTMENT_LABELS: Readonly<Record<string, string>> = Object.freeze({
  planning: "Stadtplanung", traffic: "Verkehr", environment: "Umwelt", finance: "Finanzen",
  legal: "Recht", "public-order": "Öffentliche Ordnung", "social-affairs": "Soziales", "public-works": "Technische Dienste",
});
export function departmentLabel(id: string): string { return DEPARTMENT_LABELS[id] ?? id; }
