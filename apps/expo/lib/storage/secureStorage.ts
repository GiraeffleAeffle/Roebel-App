/**
 * Platform-neutral SecureStore facade. Native (this file): pass-through to
 * expo-secure-store (Keychain / EncryptedSharedPreferences). Web
 * (secureStorage.web.ts): namespaced localStorage — acceptable because every
 * secret stored through this wrapper is wallet-derived and re-derivable; see
 * the threat-model note in docs/superpowers/specs/2026-08-05-expo-web-pwa-design.md.
 */
import * as SecureStore from 'expo-secure-store';

export type SecureStoreOptions = SecureStore.SecureStoreOptions;

export function getItemAsync(key: string, options?: SecureStoreOptions): Promise<string | null> {
  return SecureStore.getItemAsync(key, options);
}

export function setItemAsync(key: string, value: string, options?: SecureStoreOptions): Promise<void> {
  return SecureStore.setItemAsync(key, value, options);
}

export function deleteItemAsync(key: string, options?: SecureStoreOptions): Promise<void> {
  return SecureStore.deleteItemAsync(key, options);
}
