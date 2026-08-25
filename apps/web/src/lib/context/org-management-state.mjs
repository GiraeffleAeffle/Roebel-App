function normalized(value) {
  return typeof value === "string" && value ? value.toLowerCase() : undefined;
}

/** One management view belongs to exactly one normalized wallet/account pair. */
export function orgManagementBinding(walletAddress, accountId) {
  const wallet = normalized(walletAddress);
  const account = normalized(accountId);
  if (!wallet || !account) return undefined;
  return `${wallet}:${account}`;
}

export function createEmptyOrgManagementSnapshot(binding) {
  return {
    binding,
    members: [],
    pendingInvites: [],
    currentRole: null,
  };
}

export function createEmptyOrgManagementTransientState(binding) {
  return {
    binding,
    menuOpen: null,
    showInvite: false,
    inviteTab: "app",
    searchQuery: "",
    searchResults: [],
    selectedUser: null,
    inviteRole: "member",
    expiryDays: 7,
    generatedLink: null,
    isSending: false,
  };
}

/** Mask invite/search UI state before the identity-change effect can clear it. */
export function resolveBoundOrgManagementTransientState(
  currentBinding,
  transientState,
) {
  if (!currentBinding || transientState?.binding !== currentBinding) {
    return createEmptyOrgManagementTransientState(currentBinding);
  }
  return transientState;
}

/** Mask old organization data during the render before React effects run. */
export function resolveBoundOrgManagementSnapshot(currentBinding, snapshot) {
  if (!currentBinding || snapshot?.binding !== currentBinding) {
    return createEmptyOrgManagementSnapshot(currentBinding);
  }
  return snapshot;
}

/**
 * Load and publish one complete management snapshot only while its original
 * wallet/account request is still current. The optional request predicate also
 * rejects an older refresh for the same binding.
 */
export async function runOrgManagementLoad({
  binding,
  load,
  currentBinding,
  isCurrent = () => true,
}) {
  if (!binding) return null;
  const result = await load();
  if (currentBinding() !== binding || !isCurrent()) return null;
  return { ...result, binding };
}
