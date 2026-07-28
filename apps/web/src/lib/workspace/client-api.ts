/**
 * Browser-side helpers for the Dateien surface. Pure so they are unit-tested
 * without React; the components below only compose them.
 */

export interface FileScopeParams {
  scope: "personal" | "org";
  accountId?: string;
  orgName?: string;
}

export function buildFilesQuery(
  params: FileScopeParams & { path: string },
): string {
  const q = new URLSearchParams();
  if (params.scope === "org") {
    q.set("scope", "org");
    if (params.accountId) q.set("accountId", params.accountId);
    if (params.orgName) q.set("orgName", params.orgName);
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
