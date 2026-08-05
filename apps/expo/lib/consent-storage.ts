/**
 * SecureStore-backed persistence for the consent system.
 *
 * Uses iOS Keychain / Android Keystore via expo-secure-store. Pinned to
 * device-only via the keychainService option (no iCloud Keychain sync, so
 * a reinstall on the same device keeps consent but a different user on a
 * shared device never inherits it).
 */

import * as SecureStore from '@/lib/storage/secureStorage';
import * as Crypto from 'expo-crypto';
import {
  CONSENT_STORAGE_KEYS,
  DEFAULT_PREFERENCES,
  type ConsentCategoryId,
  type ConsentPreferences,
} from '@/constants/consent';

const SECURE_OPTS: SecureStore.SecureStoreOptions = {
  keychainService: 'roebel-consent',
  requireAuthentication: false,
};

export type PromptState = {
  lastPromptAt: number | null;
  promptCount: number;
  contextualDismissals: Partial<Record<ConsentCategoryId, number[]>>;
};

const DEFAULT_PROMPT_STATE: PromptState = {
  lastPromptAt: null,
  promptCount: 0,
  contextualDismissals: {},
};

async function readJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await SecureStore.getItemAsync(key, SECURE_OPTS);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(key: string, value: unknown): Promise<void> {
  try {
    await SecureStore.setItemAsync(key, JSON.stringify(value), SECURE_OPTS);
  } catch (err) {
    if (__DEV__) console.warn('[consent-storage] write failed', key, err);
  }
}

export async function loadConsent(): Promise<ConsentPreferences | null> {
  try {
    const raw = await SecureStore.getItemAsync(
      CONSENT_STORAGE_KEYS.preferences,
      SECURE_OPTS
    );
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ConsentPreferences>;
    return { ...DEFAULT_PREFERENCES, ...parsed, essential: true };
  } catch {
    return null;
  }
}

export async function saveConsent(prefs: ConsentPreferences): Promise<void> {
  await writeJson(CONSENT_STORAGE_KEYS.preferences, {
    ...prefs,
    essential: true,
  });
}

export async function loadVersion(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(
      CONSENT_STORAGE_KEYS.policyVersion,
      SECURE_OPTS
    );
  } catch {
    return null;
  }
}

export async function saveVersion(version: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(
      CONSENT_STORAGE_KEYS.policyVersion,
      version,
      SECURE_OPTS
    );
  } catch (err) {
    if (__DEV__) console.warn('[consent-storage] save version failed', err);
  }
}

export async function loadDeviceId(): Promise<string> {
  try {
    const existing = await SecureStore.getItemAsync(
      CONSENT_STORAGE_KEYS.deviceId,
      SECURE_OPTS
    );
    if (existing) return existing;
    const fresh = Crypto.randomUUID();
    await SecureStore.setItemAsync(
      CONSENT_STORAGE_KEYS.deviceId,
      fresh,
      SECURE_OPTS
    );
    return fresh;
  } catch {
    // Fallback to an ephemeral id if SecureStore is unavailable. The audit
    // trail will still get a row; reconciliation may fail but the app keeps
    // working.
    return Crypto.randomUUID();
  }
}

export async function loadPromptState(): Promise<PromptState> {
  return readJson<PromptState>(
    CONSENT_STORAGE_KEYS.promptState,
    DEFAULT_PROMPT_STATE
  );
}

export async function savePromptState(state: PromptState): Promise<void> {
  await writeJson(CONSENT_STORAGE_KEYS.promptState, state);
}

export async function loadGrandfatherBannerDismissed(): Promise<boolean> {
  try {
    const v = await SecureStore.getItemAsync(
      CONSENT_STORAGE_KEYS.grandfatherBannerDismissed,
      SECURE_OPTS
    );
    return v === '1';
  } catch {
    return false;
  }
}

export async function setGrandfatherBannerDismissed(): Promise<void> {
  try {
    await SecureStore.setItemAsync(
      CONSENT_STORAGE_KEYS.grandfatherBannerDismissed,
      '1',
      SECURE_OPTS
    );
  } catch {
    // ignore
  }
}

export async function loadWalletReconciled(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(
      CONSENT_STORAGE_KEYS.walletReconciled,
      SECURE_OPTS
    );
  } catch {
    return null;
  }
}

export async function setWalletReconciled(walletAddress: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(
      CONSENT_STORAGE_KEYS.walletReconciled,
      walletAddress,
      SECURE_OPTS
    );
  } catch {
    // ignore
  }
}
