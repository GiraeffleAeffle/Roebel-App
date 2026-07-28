/**
 * Org workspace SSO tiles. The org analog of `buildWorkspaceTiles`
 * (@/lib/dashboard/workspace-tiles): tiles link out to the org's SHARED
 * office apps, each authenticating the user via Röbel ID (OIDC). Files are
 * native now (mounted via `FileBrowser` with an org scope on the org
 * Arbeitsbereich page), so this only covers the surfaces that still link
 * out: chat, mail, wiki, video, project and the agent workspace. Scoping to
 * the org's own chat room is enforced downstream by the
 * `org:<accountId>:<role>` group claim in Matrix — not here — so v1
 * simply links to the configured base URL.
 *
 * Pure + React-free so it is unit-testable under node:test. The UI layer maps
 * the string `icon` key to a lucide component and reads the two base URLs from
 * `process.env.NEXT_PUBLIC_WORKSPACE_BASE_URL` /
 * `process.env.NEXT_PUBLIC_CHAT_BASE_URL`. Reuses the Slice-1 `WorkspaceTile`
 * shape + `filterAvailableTiles`.
 */

import type { WorkspaceTile } from "@/lib/dashboard/workspace-tiles";
import type { Account } from "@/types/account";

export interface OrgWorkspaceTileConfig {
  /** Base URL of the shared Nextcloud/Collabora workspace. Empty/undefined = not configured. */
  workspaceBaseUrl?: string | null;
  /** Base URL of the org Element/Matrix chat. Empty/undefined = not configured. */
  chatBaseUrl?: string | null;
  /** Open-Xchange mail/calendar/contacts (openDesk suite). */
  mailBaseUrl?: string | null;
  /** XWiki knowledge base (openDesk suite). */
  wikiBaseUrl?: string | null;
  /** Jitsi video meetings (openDesk suite). */
  videoBaseUrl?: string | null;
  /** OpenProject project management (openDesk suite). */
  projectBaseUrl?: string | null;
  /**
   * Agent workspace (Nostr/Buzz-style): the org's AI agents work here as members
   * alongside staff — same identity (agent smart account → derived npub), same
   * relay, budgets + kill-switch from the agent charter.
   * See docs/NOSTR_AGENT_ECOSYSTEM_PLAN.md.
   */
  agentsBaseUrl?: string | null;
  /** The active org whose shared space these tiles target. Null = no org context. */
  org: Pick<Account, "id" | "slug"> | null;
}

/** Build the org tile list (files + chat), resolving hrefs from the supplied config. */
export function buildOrgWorkspaceTiles(
  config: OrgWorkspaceTileConfig
): WorkspaceTile[] {
  // A shared org workspace only exists inside an org context; without one there
  // is nothing to link to (the group claim, not a URL path, does the scoping).
  if (!config.org) return [];

  const normalise = (url: string | null | undefined) =>
    (url ?? "").trim().replace(/\/+$/, "");

  const entries: Array<{ id: string; label: string; icon: string; url: string }> = [
    { id: "org-chat", label: "Team-Chat", icon: "messages", url: normalise(config.chatBaseUrl) },
    { id: "org-mail", label: "E-Mail & Kalender", icon: "mail", url: normalise(config.mailBaseUrl) },
    { id: "org-wiki", label: "Wissen & Wiki", icon: "wiki", url: normalise(config.wikiBaseUrl) },
    { id: "org-video", label: "Videokonferenz", icon: "video", url: normalise(config.videoBaseUrl) },
    { id: "org-project", label: "Projekte & Aufgaben", icon: "project", url: normalise(config.projectBaseUrl) },
    { id: "org-agents", label: "KI-Arbeitsbereich", icon: "agents", url: normalise(config.agentsBaseUrl) },
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
