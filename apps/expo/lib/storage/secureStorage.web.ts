/**
 * Web fork: namespaced localStorage. expo-secure-store's web build is an
 * empty module, so every call would throw. Secrets stored here are
 * wallet-derived and re-derivable (spec threat-model note). requireAuthentication
 * has no web equivalent and is ignored.
 */
export type SecureStoreOptions = {
  keychainService?: string;
  requireAuthentication?: boolean;
};

const PREFIX = 'roebel.secure.';

function storageKey(key: string, options?: SecureStoreOptions): string {
  return `${PREFIX}${options?.keychainService ?? 'default'}.${key}`;
}

export async function getItemAsync(key: string, options?: SecureStoreOptions): Promise<string | null> {
  try {
    return globalThis.localStorage?.getItem(storageKey(key, options)) ?? null;
  } catch {
    return null;
  }
}

export async function setItemAsync(key: string, value: string, options?: SecureStoreOptions): Promise<void> {
  try {
    globalThis.localStorage?.setItem(storageKey(key, options), value);
  } catch {
    // Quota exceeded / private mode: fail soft like a missing keychain.
  }
}

export async function deleteItemAsync(key: string, options?: SecureStoreOptions): Promise<void> {
  try {
    globalThis.localStorage?.removeItem(storageKey(key, options));
  } catch {
    // ignore
  }
}
