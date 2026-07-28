/**
 * Browser-side helpers for the Dateien surface. Pure so they are unit-tested
 * without React; the components below only compose them.
 */

export interface FileScopeParams {
  scope: "personal" | "org";
  accountId?: string;
}

// No `orgName` field, and none sent on the wire: the server derives an org's
// folder identity from `accountId` alone (see the incident writeup on
// `resolveScope` in lib/workspace/context.ts) — a client-supplied name never
// had any authority, and not sending it at all is the surest way to stop it
// being re-trusted by some future call site.
export function buildFilesQuery(
  params: FileScopeParams & { path: string },
): string {
  const q = new URLSearchParams();
  if (params.scope === "org") {
    q.set("scope", "org");
    if (params.accountId) q.set("accountId", params.accountId);
  }
  q.set("path", params.path);
  return q.toString();
}

export function breadcrumbs(path: string): Array<{ label: string; path: string }> {
  const crumbs = [{ label: "Arbeitsbereich", path: "" }];
  let accumulated = "";
  for (const segment of path.split("/").filter(Boolean)) {
    accumulated = accumulated ? `${accumulated}/${segment}` : segment;
    crumbs.push({ label: segment, path: accumulated });
  }
  return crumbs;
}

export function parentPath(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? "" : path.slice(0, index);
}

const UNITS = ["B", "KB", "MB", "GB", "TB"];

/** German formatting: comma decimals, em dash for a directory. */
export function formatSize(bytes: number): string {
  if (bytes <= 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1).replace(".", ",")} ${UNITS[unit]}`;
}

/**
 * Where the OIDC hop returns to. Shared by every place `FileBrowser` starts
 * it (the initial load, and re-opening a document after the session expired
 * mid-browse) so the two call sites cannot drift on the query param name.
 */
export function loginRedirect(pathname: string): string {
  return `/api/workspace/auth/login?returnTo=${encodeURIComponent(pathname)}`;
}

/**
 * German, citizen-facing text for a write or open that failed after the 401
 * (start-the-OIDC-hop) and 415 (fall back to download) cases have already
 * been handled by the caller. Kept here rather than inline in the component
 * so the status-to-copy mapping is unit-tested, and so it stays in lockstep
 * with the statuses `errorResponse` in lib/workspace/request.ts actually
 * produces: 403 (org ACL denial — reported, never decided, here), 423
 * (WebDAV lock), 507 (quota), and everything else folded into one generic
 * retry message rather than leaking a raw status or server string.
 */
export function describeWorkspaceError(status: number): string {
  switch (status) {
    case 401:
      return "Deine Sitzung ist abgelaufen. Bitte lade die Seite neu und melde dich erneut an.";
    case 403:
      return "Du hast keinen Zugriff auf diesen Bereich.";
    case 423:
      return "Die Datei ist gerade gesperrt. Versuche es in Kürze erneut.";
    case 507:
      return "Kein Speicherplatz mehr verfügbar.";
    default:
      return "Das hat leider nicht geklappt. Bitte versuche es erneut.";
  }
}

/**
 * What `FileBrowser` does with a response from /api/workspace/files.
 *
 * Extracted from the component so the branch table is unit-tested — the two
 * branches that matter most cannot be exercised through the component at all
 * under `tsx --test`, and both are ones the branch got wrong:
 *
 *   "unconfigured" (503): the deployment has no workspace env vars. Render the
 *   old link-out card. Emphatically NOT a hop: /api/workspace/auth/login is
 *   equally unconfigured, so hopping is a guaranteed dead end.
 *
 *   "auth-error": a 401 that has already been answered with one hop. A
 *   misconfigured bearer chain (user_oidc rejecting the token, rather than a
 *   stale session) produces a 401 that re-authenticating cannot fix, so the
 *   naive "any 401 means hop" rule loops forever — and every lap INSERTs
 *   another `workspace_sessions` row holding a live refresh token.
 */
export type FilesResponseAction =
  | "ok"
  | "unconfigured"
  | "hop"
  | "auth-error"
  | "error";

export function classifyFilesResponse(
  status: number,
  hopAlreadyTried: boolean,
): FilesResponseAction {
  if (status === 503) return "unconfigured";
  if (status === 401) return hopAlreadyTried ? "auth-error" : "hop";
  if (status >= 200 && status < 300) return "ok";
  return "error";
}

/** The marker that makes the OIDC hop one-shot. Survives the redirect round trip. */
export const WORKSPACE_HOP_KEY = "roebel_ws_hop_attempted";

/** The slice of the Storage interface the hop guard uses. */
export interface HopMarkerStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * Whether a hop has already been started since the last successful load. This
 * is what `classifyFilesResponse`'s `hopAlreadyTried` argument is fed.
 *
 * `sessionStorage` rather than a URL marker so the answer survives the hop
 * itself (the browser leaves for the keystone and comes back) without leaving
 * a `?ws_retry=1` on a URL the citizen might bookmark or share.
 */
export function hasTriedLoginHop(store: HopMarkerStore): boolean {
  return store.getItem(WORKSPACE_HOP_KEY) !== null;
}

/** Record that a hop is being started, so the next 401 is not answered with another. */
export function markLoginHop(store: HopMarkerStore): void {
  store.setItem(WORKSPACE_HOP_KEY, "1");
}

/**
 * Release the marker. Called after a listing actually succeeds: that proves
 * the whole chain works, so a later 401 is a genuinely expired session and
 * deserves its own hop rather than inheriting a stale refusal.
 */
export function releaseLoginHop(store: HopMarkerStore): void {
  store.removeItem(WORKSPACE_HOP_KEY);
}

/**
 * `sessionStorage`, or an in-memory stand-in. Safari in private mode (and any
 * browser with storage blocked) throws on access rather than returning null,
 * and a file browser must not fail to render over a storage-permission
 * question. The fallback is per-tab-lifetime rather than per-page, so it stops
 * a loop within one page load but not one that survives a redirect — degraded,
 * not absent.
 */
const memoryHopStore = new Map<string, string>();

export function hopMarkerStore(): HopMarkerStore {
  try {
    if (typeof window !== "undefined" && window.sessionStorage) {
      // Touch it: the throw happens on access, not on use.
      window.sessionStorage.getItem(WORKSPACE_HOP_KEY);
      return window.sessionStorage;
    }
  } catch {
    // fall through
  }
  return {
    getItem: (key) => memoryHopStore.get(key) ?? null,
    setItem: (key, value) => void memoryHopStore.set(key, value),
    removeItem: (key) => void memoryHopStore.delete(key),
  };
}

/**
 * Normalise the public workspace base URL — the link-out target `FileBrowser`
 * falls back to while the native surface is unconfigured, and the same value
 * the `nextcloud` / `org-nextcloud` tiles carry. Empty string = not set.
 */
export function workspaceLinkOut(baseUrl: string | null | undefined): string {
  return (baseUrl ?? "").trim().replace(/\/+$/, "");
}
