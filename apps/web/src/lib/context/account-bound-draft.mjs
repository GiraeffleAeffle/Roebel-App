function normalized(value) {
  return typeof value === "string" && value ? value.toLowerCase() : undefined;
}

/** One editable organization view belongs to one wallet/account pair. */
export function accountIdentityBinding(walletAddress, accountId) {
  const wallet = normalized(walletAddress);
  const account = normalized(accountId);
  if (!wallet || !account) return undefined;
  return `${wallet}:${account}`;
}

export function createAccountBoundDraft(binding, value) {
  return { binding, value };
}

/** Mask an old draft during the render before identity-change effects run. */
export function resolveAccountBoundDraft(currentBinding, draft, emptyValue) {
  if (!currentBinding || draft?.binding !== currentBinding) {
    return {
      binding: currentBinding,
      value: emptyValue,
      current: false,
    };
  }
  return { binding: currentBinding, value: draft.value, current: true };
}

/**
 * Start and publish an async action only for its original wallet/account.
 * The external operation may finish after a switch, but its result cannot be
 * projected into the replacement identity.
 */
export async function runAccountBoundAction({
  binding,
  currentBinding,
  action,
  publish,
}) {
  if (!binding || currentBinding() !== binding) {
    return { started: false, current: false };
  }

  const value = await action();
  if (currentBinding() !== binding) {
    return { started: true, current: false, value };
  }

  publish?.(value);
  return { started: true, current: true, value };
}
