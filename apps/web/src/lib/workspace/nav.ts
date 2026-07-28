/**
 * The Arbeitsbereich's own navigation — the citizen equivalent of the org
 * sidebar. Only surfaces that are actually native appear here; everything still
 * served by a link-out tile stays on the Übersicht, so the nav never advertises
 * something that is not built.
 *
 * Pure and React-free so it is unit-testable; the UI maps `icon` to a lucide
 * component.
 */
export interface WorkspaceNavItem {
  id: string;
  label: string;
  href: string;
  /** True when the surface is rendered by us rather than linked out to. */
  native: boolean;
}

export function workspaceNav(): WorkspaceNavItem[] {
  return [
    { id: "uebersicht", label: "Übersicht", href: "/arbeitsbereich", native: true },
    {
      id: "dateien",
      label: "Dateien & Dokumente",
      href: "/arbeitsbereich/dateien",
      native: true,
    },
  ];
}
