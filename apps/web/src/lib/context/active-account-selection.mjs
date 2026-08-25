function normalizedWallet(value) {
  return typeof value === "string" && value ? value.toLowerCase() : undefined;
}

/**
 * Serialize account refresh publication against ownership mutations.
 *
 * A refresh may finish after an organization has been created. Callers
 * invalidate before starting the create and again before publishing the new
 * owned-account snapshot; only a refresh whose generation is still current
 * may publish.
 */
export function createAccountRefreshCoordinator() {
  let generation = 0;

  return {
    begin() {
      generation += 1;
      return generation;
    },
    invalidate() {
      generation += 1;
      return generation;
    },
    isCurrent(candidate) {
      return candidate === generation;
    },
    current() {
      return generation;
    },
  };
}

/** Append one signer-created account to the current wallet's owned snapshot. */
export function appendWalletBoundOwnedAccount({
  currentWallet,
  stateWallet,
  ownedAccounts,
  account,
}) {
  const current = normalizedWallet(currentWallet);
  if (!current || normalizedWallet(stateWallet) !== current) {
    throw new Error("Account ownership does not belong to the connected wallet");
  }
  return [
    ...ownedAccounts.filter((candidate) => candidate.id !== account.id),
    account,
  ];
}

/** Resolve a switch target only from the current wallet's live owned snapshot. */
export function resolveWalletBoundOwnedAccount({
  currentWallet,
  stateWallet,
  ownedAccounts,
  accountId,
}) {
  const current = normalizedWallet(currentWallet);
  if (!current || normalizedWallet(stateWallet) !== current) return null;
  return ownedAccounts.find((account) => account.id === accountId) || null;
}

/**
 * Restore only an account returned by the current wallet's ownership query.
 * Browser storage is a preference, never authority to adopt an account.
 */
export function selectOwnedActiveAccount(
  ownedAccounts,
  persistedAccountId,
  storedAccountId,
) {
  const requestedAccountId = persistedAccountId || storedAccountId;
  if (!requestedAccountId) return null;
  return ownedAccounts.find((account) => account.id === requestedAccountId) || null;
}

/**
 * Resolve browser restoration and report whether its value is stale. The
 * caller must remove stale storage even when a persisted DB preference wins.
 */
export function resolveOwnedActiveAccount(
  ownedAccounts,
  persistedAccountId,
  storedAccountId,
) {
  const activeAccount = selectOwnedActiveAccount(
    ownedAccounts,
    persistedAccountId,
    storedAccountId,
  );

  return {
    activeAccount,
    clearStoredAccountId:
      Boolean(storedAccountId) && storedAccountId !== activeAccount?.id,
  };
}
