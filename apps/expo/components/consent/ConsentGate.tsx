/**
 * Watches consent state and:
 *  - pushes the user to /consent on first launch (when no granular prefs exist
 *    yet AND the user is not already inside the welcome flow),
 *  - initializes / closes Sentry as the `crash` flag flips,
 *  - mounts the policy-version re-consent sheet globally.
 */

import React, { useEffect, useRef } from 'react';
import { useRouter, usePathname } from 'expo-router';
import { useConsent } from '@/context/ConsentContext';
import {
  closeSentry,
  initSentryWithBufferReplay,
} from '@/lib/sentry-init';
import { ConsentReconsentSheet } from './ConsentReconsentSheet';
import { useActiveAccount } from 'thirdweb/react';
import { useUser } from '@/context/UserContext';

export function ConsentGate() {
  const { ready, needsConsent, preferences } = useConsent();
  const router = useRouter();
  const pathname = usePathname();
  const pushedRef = useRef(false);
  const account = useActiveAccount();
  const { user } = useUser();
  const healedRef = useRef(false);

  // Public-record self-heal: consent was accepted earlier but enrollment has
  // not completed on this device (offline then, verified later, new device).
  // Once per launch, entirely silent.
  useEffect(() => {
    if (!ready || needsConsent || healedRef.current) return;
    if (!user?.is_verified_citizen || !account) return;
    healedRef.current = true;
    const acct = account;
    const timer = setTimeout(() => {
      void import('@/lib/nostr/enroll')
        .then(({ selfHealEnrollment }) => selfHealEnrollment(acct, true))
        .catch(() => {});
    }, 4000);
    return () => clearTimeout(timer);
  }, [ready, needsConsent, user?.is_verified_citizen, account]);

  // Route to /consent on first launch once the SecureStore read has resolved.
  useEffect(() => {
    if (!ready || !needsConsent) return;
    if (pushedRef.current) return;
    if (pathname?.startsWith('/welcome') || pathname === '/consent') return;
    pushedRef.current = true;
    setTimeout(() => router.push('/consent' as any), 100);
  }, [ready, needsConsent, pathname, router]);

  // Re-eligible to push if state changes back to needing consent (rare).
  useEffect(() => {
    if (!needsConsent) pushedRef.current = false;
  }, [needsConsent]);

  // Manual Sentry lifecycle.
  useEffect(() => {
    if (!ready) return;
    if (preferences.crash) {
      initSentryWithBufferReplay();
    } else {
      closeSentry();
    }
  }, [ready, preferences.crash]);

  return <ConsentReconsentSheet />;
}
