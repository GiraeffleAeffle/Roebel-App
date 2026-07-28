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
