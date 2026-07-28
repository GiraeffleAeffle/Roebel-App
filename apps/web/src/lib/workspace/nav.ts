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

export interface WorkspaceNavOptions {
  /**
   * Whether the viewer is a verified citizen. The Dateien surface consumes the
   * citizen's own storage and is gated server-side on the `citizen` group
   * claim (see `resolveScope` in ../workspace/context.ts); advertising it to
   * someone who will be refused — including the person currently reading the
   * "Nur für verifizierte Bürger" card on the Übersicht — is a broken promise,
   * not a security hole.
   *
   * Required, not defaulted: a default would have to be `true` to be useful,
   * and a caller who forgets to pass it would then silently show the link to
   * everyone, which is the exact defect this parameter exists to fix.
   */
  isCitizen: boolean;
}

export function workspaceNav(options: WorkspaceNavOptions): WorkspaceNavItem[] {
  const items: WorkspaceNavItem[] = [
    { id: "uebersicht", label: "Übersicht", href: "/arbeitsbereich", native: true },
  ];
  if (options.isCitizen) {
    items.push({
      id: "dateien",
      label: "Dateien & Dokumente",
      href: "/arbeitsbereich/dateien",
      native: true,
    });
  }
  return items;
}
