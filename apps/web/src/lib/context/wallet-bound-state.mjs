function normalizeBinding(value) {
  return typeof value === "string" && value
    ? value.toLowerCase()
    : undefined;
}

/**
 * A React effect runs after render. Mask profile state synchronously so a
 * wallet switch can never render the previous wallet's profile while the
 * replacement request is starting.
 */
export function resolveWalletBoundProfileState({
  currentWallet,
  stateWallet,
  user,
  profilePersistence,
  isLoading,
  error,
}) {
  const current = normalizeBinding(currentWallet);
  const bound = normalizeBinding(stateWallet);
  if (!current) {
    return {
      user: null,
      profilePersistence: null,
      isLoading: false,
      error: null,
    };
  }
  if (bound !== current) {
    return {
      user: null,
      profilePersistence: null,
      isLoading: true,
      error: null,
    };
  }
  return { user, profilePersistence, isLoading, error };
}

export function publicProfileRequestBinding(targetWallet, viewerWallet) {
  const target = normalizeBinding(targetWallet);
  if (!target) return undefined;
  return `${target}:${normalizeBinding(viewerWallet) || "public"}`;
}

/** Mask a privacy-filtered response until both target and viewer match. */
export function resolveRequestBoundPublicProfileState({
  currentRequest,
  stateRequest,
  profile,
  isLoading,
  error,
}) {
  if (!currentRequest) {
    return { profile: null, isLoading: false, error: null };
  }
  if (stateRequest !== currentRequest) {
    return { profile: null, isLoading: true, error: null };
  }
  return { profile, isLoading, error };
}

/**
 * Accounts, roles, and every derived authority view share one wallet binding.
 * Returning an all-or-nothing snapshot avoids a mixed old/new identity render.
 */
export function resolveWalletBoundAccountState({
  currentWallet,
  accountsWallet,
  activeAccountWallet,
  roleWallet,
  roleAccountId,
  activeAccount,
  ownedAccounts,
  roleInActiveAccount,
}) {
  const current = normalizeBinding(currentWallet);
  const accountStateIsCurrent = Boolean(
    current &&
      normalizeBinding(accountsWallet) === current &&
      normalizeBinding(activeAccountWallet) === current,
  );
  if (!accountStateIsCurrent) {
    return {
      activeAccount: null,
      ownedAccounts: [],
      roleInActiveAccount: null,
      authorityStateIsCurrent: false,
    };
  }

  const safeActiveAccount = activeAccount || null;
  const roleIsCurrent = Boolean(
    safeActiveAccount &&
      normalizeBinding(roleWallet) === current &&
      roleAccountId === safeActiveAccount.id,
  );
  return {
    activeAccount: safeActiveAccount,
    ownedAccounts,
    roleInActiveAccount: roleIsCurrent ? roleInActiveAccount : null,
    authorityStateIsCurrent: true,
  };
}
