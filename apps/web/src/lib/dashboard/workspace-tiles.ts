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
  /** Base URL of the self-hosted workspace (Nextcloud/Collabora). Empty/undefined = not configured. */
  workspaceBaseUrl?: string | null;
  /** Element/Matrix chat. Humans talk here (openDesk-native). */
  chatBaseUrl?: string | null;
  /** Open-Xchange mail/calendar/contacts. */
  mailBaseUrl?: string | null;
  /** XWiki knowledge base. */
  wikiBaseUrl?: string | null;
  /** Jitsi video meetings. */
  videoBaseUrl?: string | null;
  /** OpenProject project management. */
  projectBaseUrl?: string | null;
  /**
   * Agent workspace (Nostr/Buzz-style): the space where the citizen's AI agents
   * are members alongside humans. Same identity (smart account → derived npub),
   * same relay. See docs/NOSTR_AGENT_ECOSYSTEM_PLAN.md.
   */
  agentsBaseUrl?: string | null;
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

/** Normalise a configured base URL (trim + strip trailing slashes). */
function normalise(url: string | null | undefined): string {
  return (url ?? "").trim().replace(/\/+$/, "");
}

/**
 * Build the citizen's workspace tiles — the openDesk-equivalent suite, each
 * entry lit only when its base URL is configured (so the dashboard ships before
 * the services exist). Every target authenticates via Röbel ID (OIDC), so this
 * is one identity across files, chat, mail, wiki, video, project and agents.
 */
export function buildWorkspaceTiles(config: WorkspaceTileConfig): WorkspaceTile[] {
  const entries: Array<{ id: string; label: string; icon: string; url: string }> = [
    { id: "nextcloud", label: "Dokumente & Dateien", icon: "cloud", url: normalise(config.workspaceBaseUrl) },
    { id: "chat", label: "Chat", icon: "messages", url: normalise(config.chatBaseUrl) },
    { id: "mail", label: "E-Mail & Kalender", icon: "mail", url: normalise(config.mailBaseUrl) },
    { id: "wiki", label: "Wissen & Wiki", icon: "wiki", url: normalise(config.wikiBaseUrl) },
    { id: "video", label: "Videokonferenz", icon: "video", url: normalise(config.videoBaseUrl) },
    { id: "project", label: "Projekte & Aufgaben", icon: "project", url: normalise(config.projectBaseUrl) },
    { id: "agents", label: "KI-Arbeitsbereich", icon: "agents", url: normalise(config.agentsBaseUrl) },
  ];

  return entries.map(({ id, label, icon, url }) => ({
    id,
    label,
    icon,
    href: url.length > 0 ? url : "",
    requiresConfig: true,
    configured: url.length > 0,
  }));
}

/** Keep only tiles that are usable: no config needed, or config present. */
export function filterAvailableTiles(tiles: WorkspaceTile[]): WorkspaceTile[] {
  return tiles.filter((tile) => !tile.requiresConfig || tile.configured);
}
