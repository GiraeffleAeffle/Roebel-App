export const EPHEMERAL_PROFILE_WRITE_ERROR =
  "Staging guest profiles cannot be updated";
export const STAGING_PROFILE_MUTATION_ERROR =
  "Profile mutations are disabled in the staging lab";
export const STAGING_PRIVATE_PROFILE_READ_ERROR =
  "Private profile reads are disabled in the staging lab";

/**
 * The staging lab is an explicit, opt-in environment. Keep this predicate
 * dependency-free so server routes and the boundary tests use identical
 * fail-closed semantics.
 */
export function isExplicitStaging(raw) {
  const value = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  return value === "1" || value === "true";
}

/** Server-side mutation guard for routes that cannot authenticate a wallet. */
export function resolveStagingMutationPermission(raw) {
  if (isExplicitStaging(raw)) {
    return { allowed: false, error: STAGING_PROFILE_MUTATION_ERROR };
  }
  return { allowed: true };
}

export function resolvePrivateProfileReadPermission(raw) {
  if (isExplicitStaging(raw)) {
    return { allowed: false, error: STAGING_PRIVATE_PROFILE_READ_ERROR };
  }
  return { allowed: true };
}

/** Execute a private-profile query only when that legacy surface is enabled. */
export async function runPrivateProfileRead(stagingFlag, query) {
  const permission = resolvePrivateProfileReadPermission(stagingFlag);
  if (!permission.allowed) {
    return { allowed: false, error: permission.error };
  }
  return { allowed: true, value: await query() };
}

/** Caller-provided viewer identities never unlock private staging fields. */
export function resolvePublicProfileViewer(stagingFlag, requestedViewer) {
  if (isExplicitStaging(stagingFlag)) return null;
  return typeof requestedViewer === "string" && requestedViewer
    ? requestedViewer
    : null;
}

/** Execute the public projection with the environment-safe viewer identity. */
export async function runPublicProfileRead(
  stagingFlag,
  requestedViewer,
  query,
) {
  return query(resolvePublicProfileViewer(stagingFlag, requestedViewer));
}

/** Execute a complete unauthenticated route mutation only outside staging. */
export async function runStagingRouteMutation(stagingFlag, mutation) {
  const permission = resolveStagingMutationPermission(stagingFlag);
  if (!permission.allowed) {
    return { allowed: false, error: permission.error };
  }
  return { allowed: true, value: await mutation() };
}

/** A route may validate shape without pretending it proves wallet ownership. */
export function isEvmWalletAddress(value) {
  return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value);
}

/**
 * The only client-side permission for a profile mutation. Explicit staging is
 * display-only for both existing and synthetic profiles: no users-table or
 * Storage write may be attempted. Outside staging, requiring the loaded
 * profile to match the active wallet makes stale async state fail closed.
 */
export function resolveProfileWritePermission({
  stagingFlag,
  profilePersistence,
  profileWalletAddress,
  activeWalletAddress,
}) {
  const stagingPermission = resolveStagingMutationPermission(stagingFlag);
  if (!stagingPermission.allowed) return stagingPermission;
  if (profilePersistence !== "persisted") {
    return { allowed: false, error: EPHEMERAL_PROFILE_WRITE_ERROR };
  }

  if (
    !profileWalletAddress ||
    !activeWalletAddress ||
    profileWalletAddress.toLowerCase() !== activeWalletAddress.toLowerCase()
  ) {
    return { allowed: false, error: "Profile does not match the connected wallet" };
  }

  return { allowed: true };
}

/** Execute a write only after the canonical profile permission succeeds. */
export async function runProfileWrite(permission, mutation) {
  if (!permission.allowed) {
    return { success: false, error: permission.error };
  }
  return mutation();
}

/**
 * Run an account/profile-adjacent capability only outside the explicit
 * staging lab. Keeping the callback behind this pure boundary lets callers
 * prove that no network-producing function was invoked when staging is on.
 */
export async function runNonStagingMutation(stagingFlag, mutation) {
  const permission = resolveStagingMutationPermission(stagingFlag);
  if (!permission.allowed) throw new Error(permission.error);
  return mutation();
}

const STAGING_ORG_READ_ACTIONS = new Set([
  "list_invites",
  "has_pending_invite",
]);

export function resolveStagingOrgActionPermission(stagingFlag, action) {
  if (STAGING_ORG_READ_ACTIONS.has(action)) return { allowed: true };
  return resolveStagingMutationPermission(stagingFlag);
}

/**
 * The signed org edge-function mixes reads and writes behind one transport.
 * Keep its two exact read actions working, while treating every other and
 * every unknown action as a mutation that explicit staging must not invoke.
 */
export async function runStagingOrgAction(stagingFlag, action, operation) {
  const permission = resolveStagingOrgActionPermission(stagingFlag, action);
  if (!permission.allowed) {
    return { allowed: false, error: permission.error };
  }
  return { allowed: true, value: await operation() };
}
