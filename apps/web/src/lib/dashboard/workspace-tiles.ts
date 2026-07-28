/**
 * Workspace SSO tiles. Each tile links out to an office app that authenticates
 * the citizen via Röbel ID (OIDC against roebel-id.fly.dev) — the tile itself
 * only carries the link; SSO is handled by the target app. Add Buzz /
 * openDesk / Netizen tiles here later by extending `buildWorkspaceTiles`.
 *
 * The `nextcloud` files tile is CONDITIONAL, and its default is to be present.
 * Files became a native surface (/arbeitsbereich/dateien, mounted via
 * `FileBrowser`), and this builder briefly dropped the tile outright — which
 * removed the one working route to the citizen's documents at the same moment
 * the native surface shipped, in a deployment where the native surface's env
 * vars are not set yet. A link-out that duplicates a working native page is a
 * cosmetic wart; a link-out removed before its replacement works is an outage.
 * So: the tile disappears only once `nativeFilesEnabled` says the native
 * surface is really live.
 *
 * Pure + React-free on purpose so it is unit-testable under node:test. The UI
 * layer maps the string `icon` key to a lucide component and reads the base URL
 * from `process.env.NEXT_PUBLIC_WORKSPACE_BASE_URL`.
 */

export interface WorkspaceTileConfig {
  /** Base URL of the self-hosted workspace (Nextcloud/Collabora). Empty/undefined = not configured. */
  workspaceBaseUrl?: string | null;
  /**
   * Whether the NATIVE files surface is live in this deployment. Absent or
   * false keeps the `nextcloud` link-out tile, which is the fail-safe default:
   * a deployment that has not been told otherwise still offers the route that
   * has always worked. Set it only once the server-side workspace env vars
   * are in place — see `nativeFilesEnabled`.
   */
  nativeFilesEnabled?: boolean;
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
export function normalise(url: string | null | undefined): string {
  return (url ?? "").trim().replace(/\/+$/, "");
}

/**
 * Read the public "the native files surface is live" flag
 * (`NEXT_PUBLIC_WORKSPACE_NATIVE_FILES`).
 *
 * A separate, public flag rather than `isWorkspaceEnabled()` because these
 * tiles render in a client component: the nine vars that gate the native
 * surface are server-side secrets and are simply not present in the browser
 * bundle, so the browser cannot read the real answer. The flag is the
 * operator's declaration of it.
 *
 * Anything other than "1"/"true" — including unset, which is the state on
 * merge day — means NOT live, and therefore keeps the link-out tile. The
 * default has to fail in that direction: a stale flag that says "not live"
 * costs a duplicate tile, one that says "live" costs the citizen every route
 * to their files.
 */
export function nativeFilesEnabled(raw: string | null | undefined): boolean {
  const value = (raw ?? "").trim().toLowerCase();
  return value === "1" || value === "true";
}

/**
 * Build the citizen's workspace tiles — the openDesk-equivalent suite, each
 * entry lit only when its base URL is configured (so the dashboard ships before
 * the services exist). Every target authenticates via Röbel ID (OIDC), so this
 * is one identity across files, chat, mail, wiki, video, project and agents.
 */
export function buildWorkspaceTiles(config: WorkspaceTileConfig): WorkspaceTile[] {
  const entries: Array<{ id: string; label: string; icon: string; url: string }> = [
    ...(config.nativeFilesEnabled
      ? []
      : [
          {
            id: "nextcloud",
            label: "Dokumente & Dateien",
            icon: "cloud",
            url: normalise(config.workspaceBaseUrl),
          },
        ]),
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
