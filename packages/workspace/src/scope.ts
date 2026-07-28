import type { WorkspaceScope } from "./types";
// Re-exported so callers (including this package's own tests) can import the
// scope type from "./scope" directly, without needing to also know about
// "./types".
export type { WorkspaceScope };

/**
 * A request tried to leave its scope. This is a security failure, not a 404 —
 * it is thrown rather than returned so it can never be ignored by a caller that
 * forgot to check a return value.
 */
export class ScopeViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScopeViolationError";
  }
}

/** Percent-encode one path segment, leaving the separator alone. */
function encodeSegment(segment: string): string {
  return encodeURIComponent(segment);
}

/**
 * Validate `scope.sub` and `scope.folderName` — each is meant to be ONE
 * opaque path component (a smart-account address; an `orgFolderName()`
 * output), never a path in its own right. This matters because
 * `encodeSegment` (`encodeURIComponent`) leaves "." unescaped: a component
 * that is exactly ".." passes straight through into the template literal in
 * `scopeRoot`, producing a literal `/../` with no decoding required from a
 * downstream client. That corrupts the root itself, before `resolvePath`'s
 * containment check ever runs — by then `root` is already wrong, and the
 * check trivially "passes". A raw "/" or "\" is rejected for the same
 * reason a relative path rejects them: a component is not supposed to carry
 * its own separators. "." is rejected alongside ".." even though it does not
 * escape anywhere, because neither a real `sub` nor a real `folderName` (it
 * always starts with "Org ") is ever legitimately just ".".
 */
function assertSafePathComponent(value: string, label: string): void {
  if (value.includes("\0")) {
    throw new ScopeViolationError(`${label} contains a null byte`);
  }
  if (value.includes("/") || value.includes("\\")) {
    throw new ScopeViolationError(`${label} must not contain a path separator`);
  }
  if (value === "." || value === "..") {
    throw new ScopeViolationError(`${label} must not be a navigation segment`);
  }
}

/**
 * Reject anything that could escape the scope root. Deliberately a denylist of
 * shapes plus a positive containment check afterwards: normalising a traversal
 * away and continuing would turn an attack into a silent success elsewhere.
 */
function assertSafeRelativePath(relPath: string): void {
  if (relPath.includes("\0")) {
    throw new ScopeViolationError("path contains a null byte");
  }
  if (relPath.startsWith("/")) {
    throw new ScopeViolationError("path must be relative to the scope root");
  }
  if (relPath.includes("\\")) {
    throw new ScopeViolationError("backslashes are not valid path separators");
  }
  // Decode first: "%2e%2e" is "..", and a caller that pre-encoded is either
  // confused or hostile. Either way the raw form is what we validate.
  let decoded: string;
  try {
    decoded = decodeURIComponent(relPath);
  } catch {
    throw new ScopeViolationError("path is not valid percent-encoding");
  }
  if (decoded.includes("\0") || decoded.includes("\\") || decoded.startsWith("/")) {
    throw new ScopeViolationError("path is unsafe once decoded");
  }
  for (const segment of decoded.split("/")) {
    if (segment === "..") {
      throw new ScopeViolationError("path traverses above the scope root");
    }
  }
}

/** The absolute WebDAV prefix every path in this scope must sit under. */
export function scopeRoot(scope: WorkspaceScope): string {
  assertSafePathComponent(scope.sub, "sub");
  const home = `/remote.php/dav/files/${encodeSegment(scope.sub)}/`;
  if (scope.kind === "personal") return home;
  if (!scope.folderName) {
    throw new ScopeViolationError("an org scope needs a folder name");
  }
  assertSafePathComponent(scope.folderName, "folderName");
  return `${home}${encodeSegment(scope.folderName)}/`;
}

/**
 * Resolve a caller-supplied relative path to an absolute WebDAV path, or throw.
 * The containment assertion at the end is the real guard — the shape checks
 * above only make its failure mode legible.
 */
export function resolvePath(scope: WorkspaceScope, relPath: string): string {
  const root = scopeRoot(scope);
  const trimmed = relPath.replace(/^\/+/, "");
  if (trimmed === "") return root;
  assertSafeRelativePath(relPath);

  const decoded = decodeURIComponent(trimmed);
  const encoded = decoded
    .split("/")
    .filter((segment) => segment.length > 0 && segment !== ".")
    .map(encodeSegment)
    .join("/");
  const absolute = `${root}${encoded}`;

  if (!absolute.startsWith(root)) {
    throw new ScopeViolationError("resolved path escaped the scope root");
  }
  return absolute;
}

/**
 * The group folder name for an org. Prefixed so a citizen who belongs to three
 * orgs can tell the folders apart in one list, and stripped of the characters
 * that would otherwise need escaping at every layer.
 *
 * Deliberately does NOT strip or reject ".": the "Org " prefix means its
 * output can never equal exactly "." or ".." (the only values
 * `assertSafePathComponent` treats as navigation segments), so an org named
 * e.g. "St. Georgs Kirche e.V." keeps its dots. That guard runs on
 * `scope.folderName` in `scopeRoot` regardless of whether the value passed
 * through this function at all, so this function does not need to duplicate
 * it — a caller who builds a `WorkspaceScope` by hand, skipping
 * `orgFolderName` entirely, is still checked at the one place that matters.
 */
export function orgFolderName(orgName: string): string {
  const cleaned = orgName
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return `Org ${cleaned}`;
}
