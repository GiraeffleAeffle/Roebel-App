/**
 * Workspace SSO tiles. Each tile links out to an office app that authenticates
 * the citizen via Röbel ID (OIDC against roebel-id.fly.dev) — the tile itself
 * only carries the link; SSO is handled by the target app. v1 ships one tile,
 * Nextcloud/Collabora, gated on a configured workspace base URL. Add Buzz /
 * openDesk / Netizen tiles here later by extending `buildWorkspaceTiles`.
 *
 * Pure + React-free on purpose so it is unit-testable under node:test. The UI
 * layer maps the string `icon` key to a lucide component and reads the base URL
 * from `process.env.NEXT_PUBLIC_WORKSPACE_BASE_URL`.
 */

export interface WorkspaceTileConfig {
  /** Base URL of the self-hosted workspace. Empty/undefined = not configured. */
  workspaceBaseUrl?: string | null;
}

export interface WorkspaceTile {
  id: string;
  label: string;
  /** Icon key, resolved to a lucide component in the UI layer. */
  icon: string;
  /** Fully-resolved link target. `""` when requiresConfig && !configured. */
  href: string;
  /** Whether this tile needs external config (a base URL) to work. */
  requiresConfig: boolean;
  /** Whether the required config is present. Always true for tiles that need none. */
  configured: boolean;
}

/** Build the v1 tile list, resolving hrefs from the supplied config. */
export function buildWorkspaceTiles(config: WorkspaceTileConfig): WorkspaceTile[] {
  const base = (config.workspaceBaseUrl ?? "").trim().replace(/\/+$/, "");
  const workspaceConfigured = base.length > 0;

  return [
    {
      id: "nextcloud",
      label: "Dokumente & Dateien",
      icon: "cloud",
      href: workspaceConfigured ? base : "",
      requiresConfig: true,
      configured: workspaceConfigured,
    },
  ];
}

/** Keep only tiles that are usable: no config needed, or config present. */
export function filterAvailableTiles(tiles: WorkspaceTile[]): WorkspaceTile[] {
  return tiles.filter((tile) => !tile.requiresConfig || tile.configured);
}
