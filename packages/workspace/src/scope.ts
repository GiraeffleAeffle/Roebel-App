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
 * opaque path component (a smart-account address; an `orgFolderMount()`
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
 * always starts with "org-") is ever legitimately just ".".
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
 * The Nextcloud group-folder mount point for an org, derived from its
 * accountId ALONE — never from any human-editable field.
 *
 * This function replaces an earlier `orgFolderName(orgName: string)` that
 * built the mount point from an org's display name. Two rounds of review
 * found the same folder-takeover reachable through two different trust
 * anchors that both turned out to be attacker-controllable:
 *   Round 1: a raw `orgName` client query parameter — fixed by looking the
 *   name up from the account registry instead of trusting the request.
 *   Round 2: `accounts.name` itself. It has no uniqueness constraint, and any
 *   logged-in citizen can create (or rename) an org to another org's exact
 *   display name through the product's own UI and becomes its real, honestly
 *   claimed owner. `orgFolderName`'s own sanitisation was lossy on top of
 *   that — `"Feuerwehr:"` and `"Feuerwehr"` both collapsed to `"Org
 *   Feuerwehr"` — so even a unique-name constraint on the column would not
 *   have closed it. Nextcloud group folders are matched by mount point with
 *   no accountId dimension, so whichever citizen's request resolved to that
 *   string got their group additively bound onto it.
 *
 * `accountId` is the one value a caller's ACL check has already authorised
 * and that a citizen cannot forge or collide: it is `accounts.id`, the
 * table's own primary key, unique by construction. Two different orgs can
 * therefore never produce the same mount point — structurally, regardless of
 * what any name column contains or who can write it. If a human-readable
 * name needs to be visible inside Nextcloud, it belongs as a folder
 * label/description, never as the folder's identity.
 *
 * Rejects the same unsafe shapes `assertSafePathComponent` rejects — a raw
 * slash/backslash, a null byte, or a bare "." / ".." — even though a real
 * `accounts.id` (a Postgres UUID) never contains them. `scopeRoot` re-checks
 * `folderName` on every WebDAV call regardless, but the provisioning path
 * (`Provisioner.ensureGroupFolder`) talks to Nextcloud directly and never
 * passes through `scopeRoot` — this is that path's only guard.
 */
export function orgFolderMount(accountId: string): string {
  assertSafePathComponent(accountId, "accountId");
  return `org-${accountId}`;
}
