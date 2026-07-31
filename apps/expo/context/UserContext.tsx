import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { useActiveAccount, useActiveWallet } from 'thirdweb/react';
import { getUserEmail, getProfiles } from 'thirdweb/wallets/in-app';
import { client } from '@/constants/thirdweb';
import { useVerificationContext } from '@/context/VerificationContext';
import { useConsent } from '@/context/ConsentContext';
import { setSentryUser } from '@/lib/sentry-init';
import { Events, track } from '@/lib/analytics';
import { upsertUser, updateUserProfile, updateUserTier, fetchUserByWallet } from '@/lib/supabase-users';
import { logActivity } from '@/lib/supabase-activity';
import { loadCachedUser, saveCachedUser } from '@/lib/user-cache';
import { useWalletBoot } from '@/context/WalletBootContext';
import type { UserRecord, UserTier } from '@/lib/types';

const TIER_LABELS: Record<UserTier, string> = {
  guest: 'Gast',
  tourist: 'Besucher',
  citizen: 'Bürger',
};

interface UserContextValue {
  user: UserRecord | null;
  isLoading: boolean;

  tier: UserTier;
  tierLabel: string;
  isCitizen: boolean;
  isConnected: boolean;

  refreshUser: () => Promise<void>;
  updateProfile: (updates: {
    username?: string;
    bio?: string;
    profile_picture_url?: string;
    cover_image_url?: string;
    neighborhood?: string;
    interests?: string[];
  }) => Promise<void>;
}

const UserContext = createContext<UserContextValue | undefined>(undefined);

export function UserProvider({ children }: { children: React.ReactNode }) {
  const account = useActiveAccount();
  const wallet = useActiveWallet();
  const router = useRouter();
  const { hasCitizenNFT, chainResolved } = useVerificationContext();
  const consent = useConsent();
  const { autoConnectFinished } = useWalletBoot();

  const [user, setUser] = useState<UserRecord | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const onboardingTriggeredFor = useRef<string | null>(null);
  const sentryIdentifiedFor = useRef<string | null>(null);
  const grandfatherCheckedFor = useRef<string | null>(null);

  // Optimistic hydration: restore the last synced user from local storage on
  // mount so the personalized feed (tier / citizen tabs / likes) renders
  // immediately, before thirdweb finishes reconnecting the wallet. `prev ?? cached`
  // ensures a freshly-synced record (from a fast reconnect) is never clobbered.
  useEffect(() => {
    let cancelled = false;
    loadCachedUser().then((cached) => {
      if (cancelled || !cached) return;
      setUser((prev) => prev ?? cached);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Persist the user record so it can be hydrated on the next cold start.
  useEffect(() => {
    if (user?.wallet_address) {
      void saveCachedUser(user);
    }
  }, [user]);

  // Sync user on login/account change
  useEffect(() => {
    if (!account?.address) {
      // Still reconnecting on cold start — keep the optimistically-hydrated
      // cached user on screen until auto-connect has actually finished.
      if (!autoConnectFinished) return;
      // Auto-connect finished with no account → genuine logout (covers all
      // useDisconnect sites). Clear both in-memory and persisted state.
      setUser(null);
      void saveCachedUser(null);
      onboardingTriggeredFor.current = null;
      return;
    }

    async function syncUser() {
      setIsLoading(true);
      try {
        let email: string | undefined;
        let authProvider: string | undefined;
        if (wallet && wallet.id === 'inApp') {
          // Two independent thirdweb round-trips — run them in parallel;
          // each failure stays non-fatal, matching the old behavior.
          const [emailRes, profilesRes] = await Promise.allSettled([
            getUserEmail({ client }),
            getProfiles({ client }),
          ]);
          if (emailRes.status === 'fulfilled') email = emailRes.value;
          if (profilesRes.status === 'fulfilled') {
            // thirdweb returns one profile per linked auth method
            // (apple, google, email, facebook, ...). We treat the first
            // matching social provider as the primary one.
            const primary = profilesRes.value?.find(
              (p: { type?: string }) => p.type && p.type !== 'guest'
            );
            authProvider = primary?.type;
          }
        }

        const userRecord = await upsertUser(account!.address, email, authProvider, account!);
        setUser(userRecord);

        // Record daily activity + device platform for DAU/platform analytics.
        // Fire-and-forget; never blocks login. Captures platform for ALL
        // logging-in users (not only push-enabled ones).
        const platform =
          Platform.OS === 'ios' || Platform.OS === 'android'
            ? Platform.OS
            : 'web';
        void logActivity(
          account!.address,
          platform,
          Constants.expoConfig?.version,
        );

        // Onboarding + consent re-prompt trigger — fires once per connection transition
        if (userRecord && onboardingTriggeredFor.current !== userRecord.wallet_address) {
          onboardingTriggeredFor.current = userRecord.wallet_address;
          track(Events.LOGIN_COMPLETED, {
            tier: userRecord.tier,
            is_returning_user: !!userRecord.terms_accepted_at,
            onboarding_completed: !!userRecord.onboarding_completed_at,
          });
          if (!userRecord.onboarding_completed_at) {
            setTimeout(() => router.push('/welcome' as any), 150);
          } else if (!userRecord.terms_accepted_at) {
            setTimeout(() => router.push('/welcome/consent' as any), 150);
          }
        }
      } catch (error) {
        console.error('Failed to sync user:', error);
      } finally {
        setIsLoading(false);
      }
    }

    syncUser();
  }, [account?.address, wallet, router, autoConnectFinished]);

  // Identify user in Sentry on login (consent-aware via setSentryUser);
  // reset on logout. PostHog identify is handled by <PostHogTelemetry />,
  // which only mounts when analytics consent is granted (so it stays inside
  // the actual <PostHogProvider> and never calls usePostHog without one).
  useEffect(() => {
    if (user?.wallet_address) {
      if (consent.preferences.crash) {
        setSentryUser({ id: user.wallet_address, segment: user.tier });
        sentryIdentifiedFor.current = user.wallet_address;
      }
    } else if (sentryIdentifiedFor.current) {
      setSentryUser(null);
      sentryIdentifiedFor.current = null;
    }
  }, [
    user?.wallet_address,
    user?.tier,
    consent.preferences.crash,
  ]);

  // Reconcile device-level consent record with the wallet once it appears.
  // Apply the grandfather "Accept all" path for users who already accepted
  // terms before the granular consent system existed.
  useEffect(() => {
    if (!user?.wallet_address) return;
    if (!consent.ready) return;
    void consent.reconcileWallet(user.wallet_address);

    if (
      grandfatherCheckedFor.current === user.wallet_address ||
      consent.needsConsent === false
    ) {
      // either we already grandfathered on this wallet, or there's stored
      // consent (handled by the standard flow), or the modal will be shown.
    }

    if (
      consent.needsConsent &&
      user.terms_accepted_at &&
      grandfatherCheckedFor.current !== user.wallet_address
    ) {
      grandfatherCheckedFor.current = user.wallet_address;
      void consent.applyGrandfather();
    }
  }, [user?.wallet_address, user?.terms_accepted_at, consent]);

  // Auto-upgrade tier when citizen NFT is detected
  useEffect(() => {
    if (user && hasCitizenNFT && user.tier !== 'citizen') {
      updateUserTier(user.wallet_address, 'citizen', true)
        .then(() => {
          setUser(prev =>
            prev ? { ...prev, tier: 'citizen' as const, is_verified_citizen: true, verification_status: 'approved' as const } : null
          );
        })
        .catch(err => console.error('Failed to upgrade tier:', err));
    }
    // Auto-downgrade if NFT lost. Gated on chainResolved: hasCitizenNFT starts
    // false on every cold start (before autoConnect + the on-chain read
    // finish), and without this guard a citizen would be spuriously
    // downgraded — and the DB write reversed seconds later once the real
    // read lands — on every single app launch. Downgrades require a
    // confirmed on-chain read for the current wallet; the upgrade branch
    // above stays ungated since upgrading on a cached/optimistic true is
    // harmless.
    if (user && !hasCitizenNFT && user.tier === 'citizen' && user.is_verified_citizen && chainResolved) {
      updateUserTier(user.wallet_address, 'tourist', false)
        .then(() => {
          setUser(prev =>
            prev ? { ...prev, tier: 'tourist' as const, is_verified_citizen: false } : null
          );
        })
        .catch(err => console.error('Failed to downgrade tier:', err));
    }
  }, [hasCitizenNFT, chainResolved, user?.tier, user?.wallet_address, user?.is_verified_citizen]);

  const refreshUser = useCallback(async () => {
    if (!account?.address) return;
    try {
      const userRecord = await fetchUserByWallet(account.address);
      if (userRecord) setUser(userRecord);
    } catch (error) {
      console.error('Failed to refresh user:', error);
    }
  }, [account?.address]);

  const updateProfile = useCallback(async (updates: {
    username?: string;
    bio?: string;
    profile_picture_url?: string;
    cover_image_url?: string;
    neighborhood?: string;
    interests?: string[];
  }) => {
    if (!user?.wallet_address) throw new Error('No user logged in');
    const updated = await updateUserProfile(user.wallet_address, updates);
    if (updated) setUser(updated);
  }, [user?.wallet_address]);

  const tier: UserTier = user?.tier || (account?.address ? 'tourist' : 'guest');
  const tierLabel = TIER_LABELS[tier];
  const isCitizen = hasCitizenNFT || user?.is_verified_citizen || false;
  const isConnected = !!account?.address;

  const value: UserContextValue = useMemo(() => ({
    user,
    isLoading,
    tier,
    tierLabel,
    isCitizen,
    isConnected,
    refreshUser,
    updateProfile,
  }), [user, isLoading, tier, tierLabel, isCitizen, isConnected, refreshUser, updateProfile]);

  return (
    <UserContext.Provider value={value}>
      {children}
    </UserContext.Provider>
  );
}

export function useUser(): UserContextValue {
  const context = useContext(UserContext);
  if (!context) {
    throw new Error('useUser must be used within UserProvider');
  }
  return context;
}
