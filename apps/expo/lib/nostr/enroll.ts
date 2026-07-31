/**
 * Public-record enrollment, chained into the app's ONE consent system.
 *
 * There is deliberately no separate dialog: the privacy consent (first-launch
 * screen and the policy-version re-consent sheet) carries the public-record
 * clause, and pressing its Accept is the consent moment. This module remembers
 * that acceptance and turns it into an enrollment — immediately for verified
 * Citizens, or later via self-heal for anyone who becomes one (or was offline
 * when they accepted).
 *
 * The durable acceptance proof remains the wallet-signed registration itself;
 * the flag here only bridges the gap between "accepted" and "enrolled".
 */
import * as SecureStore from 'expo-secure-store';
import type { SigningAccount } from './identity';

const CONSENT_AT_KEY = 'nostr.publicRecordConsentAt';

export async function markPublicRecordConsent(): Promise<void> {
  try {
    await SecureStore.setItemAsync(CONSENT_AT_KEY, new Date().toISOString());
  } catch {
    // Worst case the self-heal never fires and enrollment happens on the next
    // policy-version acceptance. Never block the consent flow over storage.
  }
}

export async function hasPublicRecordConsent(): Promise<boolean> {
  try {
    return !!(await SecureStore.getItemAsync(CONSENT_AT_KEY));
  } catch {
    return false;
  }
}

/**
 * Enroll and start the historic backfill. Callers gate on verified citizenship;
 * everything in here is silent and never throws.
 */
export async function enrollNow(account: SigningAccount): Promise<void> {
  try {
    const { ensureIdentitySilently, getRegisteredAt } = await import('./identity');
    await ensureIdentitySilently(account);
    if (await getRegisteredAt()) {
      const { ensureProfilePublished, retryPendingPublications } = await import('./publish');
      await ensureProfilePublished(account.address);
      await retryPendingPublications(account.address);
    }
  } catch {
    // Self-heal retries on a later launch.
  }
}

/**
 * Launch-time repair: consent was given but enrollment has not completed on
 * this device — the citizen was offline, the relay was down, or they were not
 * yet verified when they accepted. Also nudges the backfill along for the
 * already-enrolled.
 */
export async function selfHealEnrollment(
  account: SigningAccount,
  isVerifiedCitizen: boolean,
): Promise<void> {
  if (!isVerifiedCitizen) return;
  if (!(await hasPublicRecordConsent())) return;
  await enrollNow(account);
}
