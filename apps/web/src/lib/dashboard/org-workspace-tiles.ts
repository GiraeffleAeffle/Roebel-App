/**
 * Org workspace SSO tiles. The org analog of `buildWorkspaceTiles`
 * (@/lib/dashboard/workspace-tiles): tiles link out to the org's SHARED
 * office apps, each authenticating the user via Röbel ID (OIDC). Scoping to
 * the org's own group folder / chat room is enforced downstream by the
 * `org:<accountId>:<role>` group claim in Nextcloud/Matrix — not here — so v1
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

  const filesBase = (config.workspaceBaseUrl ?? "").trim().replace(/\/+$/, "");
  const chatBase = (config.chatBaseUrl ?? "").trim().replace(/\/+$/, "");
  const filesConfigured = filesBase.length > 0;
  const chatConfigured = chatBase.length > 0;

  return [
    {
      id: "org-nextcloud",
      label: "Dateien & Dokumente",
      icon: "cloud",
      href: filesConfigured ? filesBase : "",
      requiresConfig: true,
      configured: filesConfigured,
    },
    {
      id: "org-chat",
      label: "Team-Chat",
      icon: "messages",
      href: chatConfigured ? chatBase : "",
      requiresConfig: true,
      configured: chatConfigured,
    },
  ];
}
