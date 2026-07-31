import React, { useEffect } from 'react';
import { useRouter } from 'expo-router';
import * as Linking from 'expo-linking';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { queryClient, persistOptions } from '@/lib/query-client';
import {
  checkClipboardForReferral,
  extractReferralCode,
  storePendingReferralCode,
} from '@/lib/referral-deeplink';
import { TransitionStack } from '@/lib/navigation/TransitionStack';
import { noTransition } from '@/lib/navigation/transitionPresets';
import { AuthGateProvider } from '@/context/AuthGateContext';
import { BookmarksProvider } from '@/context/BookmarksContext';
import { InterestProvider } from '@/context/InterestContext';
import { LocationProvider } from '@/context/LocationContext';
import { GovernanceTestProvider } from '@/context/GovernanceTestContext';
import { DeveloperModeProvider } from '@/context/DeveloperModeContext';
import { AccountProvider } from '@/context/AccountContext';
import { ExploreDotProvider } from '@/context/ExploreDotContext';
import { PendingPostFeedbackProvider } from '@/context/PendingPostFeedbackContext';
import { SnackbarProvider } from '@/context/SnackbarContext';
import { VerificationProvider } from '@/context/VerificationContext';
import { UserProvider } from '@/context/UserContext';
import { NotificationsProvider } from '@/context/NotificationsContext';
import { MessagingProvider } from '@/context/MessagingContext';
import { XmtpProvider } from '@/context/XmtpContext';
import { ThemeProvider, useTheme } from '@/context/ThemeContext';
import { MeckyProvider } from '@/context/MeckyContext';
import { RewardsProvider } from '@/context/RewardsContext';
import { RewardCelebrationProvider } from '@/context/RewardCelebrationContext';
import { RoebelTalerProvider } from '@/context/RoebelTalerProvider';
import { MaciProvider } from '@/context/MaciContext';
import { useDeferredTaskTriggers } from '@/hooks/useDeferredTaskTriggers';
import { StatusBar, View, StyleSheet, Text, Platform } from 'react-native';
import '@/lib/patch-text';
import useAppFonts from '@/hooks/useFonts';
import * as SplashScreen from 'expo-splash-screen';
import ErrorBoundary from '@/components/ErrorBoundary';
import { ThirdwebProvider } from 'thirdweb/react';
import { useScreenTracking } from '@/hooks/useAnalytics';
import { WalletBootProvider } from '@/context/WalletBootContext';
import { GnosisWalletProvider } from '@/context/GnosisWalletContext';
import { ConsentProvider } from '@/context/ConsentContext';
import { ConditionalPostHogProvider } from '@/components/consent/ConditionalPostHogProvider';
import { ConsentGate } from '@/components/consent/ConsentGate';
import { PostHogTelemetry } from '@/components/consent/PostHogTelemetry';
import { AppUpdateGate } from '@/components/AppUpdateGate';
import AnimatedSplash from '@/components/AnimatedSplash';
// DISABLED — debug-log FAB kept for later (also re-enable the capture in index.js):
// import DebugLogOverlay from '@/components/DebugLogOverlay';

// Keep the splash screen visible while we fetch resources
SplashScreen.preventAutoHideAsync();

// Check for OTA updates on native platforms
if (Platform.OS !== 'web') {
  const Updates = require('expo-updates');
  Updates.checkForUpdateAsync()
    .then((update: any) => {
      if (update.isAvailable) {
        return Updates.fetchUpdateAsync().then(() => Updates.reloadAsync());
      }
    })
    .catch(() => {
      // silently fail — user continues with current version
    });
}

// Native-only: lock orientation. The notification foreground handler is set
// in hooks/useNotifications.ts — do NOT set another one here: this module
// evaluates after its imports, so a handler here would silently override the
// suppression logic (no banner for the chat you're currently reading).
if (Platform.OS !== 'web') {
  const ScreenOrientation = require('expo-screen-orientation');
  ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
}

/**
 * Component to handle notification deep linking (native only)
 */
function NotificationHandler() {
  const router = useRouter();

  useEffect(() => {
    if (Platform.OS === 'web') return;

    const Notifications = require('expo-notifications');

    // Handle notification response when app is open
    const subscription = Notifications.addNotificationResponseReceivedListener((response: any) => {
      const data = response.notification.request.content.data;

      if (data?.type === 'event' && data?.eventId) {
        router.push(`/event/${data.eventId}` as any);
      } else if (data?.type === 'news' && data?.slug) {
        router.push(`/news/${data.slug}` as any);
      } else if (data?.type === 'post' && data?.postId) {
        router.push(`/post/${data.postId}` as any);
      } else if (data?.type === 'direct_message' && data?.conversationId) {
        router.push(`/messages/${data.conversationId}` as any);
      } else if (data?.type === 'org_invite') {
        router.push('/notifications' as any);
      } else if (data?.type === 'reward') {
        router.push('/rewards' as any);
      }
    });

    // Handle notification that opened the app from closed state
    Notifications.getLastNotificationResponseAsync().then((response: any) => {
      if (response) {
        const data = response.notification.request.content.data;

        if (data?.type === 'event' && data?.eventId) {
          setTimeout(() => {
            router.push(`/event/${data.eventId}` as any);
          }, 100);
        } else if (data?.type === 'news' && data?.slug) {
          setTimeout(() => {
            router.push(`/news/${data.slug}` as any);
          }, 100);
        } else if (data?.type === 'post' && data?.postId) {
          setTimeout(() => {
            router.push(`/post/${data.postId}` as any);
          }, 100);
        } else if (data?.type === 'direct_message' && data?.conversationId) {
          setTimeout(() => {
            router.push(`/messages/${data.conversationId}` as any);
          }, 100);
        } else if (data?.type === 'org_invite') {
          setTimeout(() => {
            router.push('/notifications' as any);
          }, 100);
        } else if (data?.type === 'reward') {
          setTimeout(() => {
            router.push('/rewards' as any);
          }, 100);
        }
      }
    });

    return () => subscription.remove();
  }, [router]);

  return null;
}

/**
 * Component to handle Firebase Analytics screen tracking
 */
function AnalyticsTracker() {
  useScreenTracking();
  return null;
}

/**
 * Captures referral deep-links (roebel://r/<code> and
 * https://www.roebel.app/r/<code>) and stores the code for the next login to
 * redeem. Also pushes the /rewards/referral screen so the user sees the hero
 * immediately when they land from a shared link.
 */
function ReferralDeepLinkHandler() {
  const router = useRouter();

  useEffect(() => {
    const handle = async (url: string | null) => {
      const code = extractReferralCode(url);
      if (!code) return;
      await storePendingReferralCode(code);
      setTimeout(() => router.push('/rewards/referral' as any), 200);
    };

    // Initial URL (cold start).
    Linking.getInitialURL()
      .then((url) => handle(url))
      .catch(() => {});

    // Deferred deep link: if the app was installed from the store after tapping
    // an invite link, the URL above is empty. The web landing page leaves the
    // invite URL on the clipboard, so read it once on first launch and store
    // any referral code silently (no auto-navigation — the match is heuristic).
    void checkClipboardForReferral();

    const sub = Linking.addEventListener('url', (event) => {
      void handle(event.url);
    });
    return () => sub.remove();
  }, [router]);

  return null;
}

/**
 * Observes user/permission state and auto-completes onboarding rewards tasks.
 */
function RewardsTaskTriggers() {
  useDeferredTaskTriggers();
  return null;
}

function ThemedLayout() {
  const { colors, isDark } = useTheme();

  return (
    <>
      <NotificationHandler />
      <AnalyticsTracker />
      <PostHogTelemetry />
      <RewardsTaskTriggers />
      <ReferralDeepLinkHandler />
      <View style={[styles.gradientContainer, { backgroundColor: colors.background }]}>
        <TransitionStack screenOptions={{ headerShown: false, animation: 'none' }}>
          <TransitionStack.Screen
            name="submit"
            options={{ headerShown: true, title: 'Veranstaltung einreichen', animation: 'none' }}
          />
          <TransitionStack.Screen name="games/mecky-jump" options={noTransition()} />
          <TransitionStack.Screen name="games/mecky-portal" options={noTransition()} />
          <TransitionStack.Screen name="games/speedrun" options={noTransition()} />
          <TransitionStack.Screen name="games/fortune-cards" options={noTransition()} />
          <TransitionStack.Screen
            name="welcome"
            options={{ headerShown: false, presentation: 'fullScreenModal', animation: 'fade' }}
          />
          <TransitionStack.Screen
            name="consent"
            options={{
              headerShown: false,
              presentation: 'fullScreenModal',
              animation: 'fade',
              gestureEnabled: false,
            }}
          />
          <TransitionStack.Screen
            name="app-update"
            options={{
              headerShown: false,
              presentation: 'fullScreenModal',
              animation: 'fade',
              gestureEnabled: true,
            }}
          />
          <TransitionStack.Screen name="settings/consent/index" options={{ headerShown: false }} />
          <TransitionStack.Screen name="settings/consent/[category]" options={{ headerShown: false }} />
          <TransitionStack.Screen name="settings/consent/history" options={{ headerShown: false }} />
          <TransitionStack.Screen name="settings/reveal-key" options={{ headerShown: false }} />
          <TransitionStack.Screen name="settings/dev-mini-app" options={{ headerShown: false }} />
          <TransitionStack.Screen name="rewards" options={{ headerShown: false }} />
        </TransitionStack>
      </View>
      <StatusBar
        barStyle={isDark ? 'light-content' : 'dark-content'}
        backgroundColor={colors.background}
        translucent={false}
      />
    </>
  );
}

function Layout() {
  const { fontsLoaded, fontError } = useAppFonts();
  const [splashDone, setSplashDone] = React.useState(false);

  React.useEffect(() => {
    if (fontsLoaded) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded]);

  // Show error state if fonts fail to load
  if (fontError) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20, backgroundColor: '#ffffff' }}>
        <Text style={{ fontSize: 20, fontWeight: '600', marginBottom: 16, color: '#000000' }}>Font Loading Error</Text>
        <Text style={{ fontSize: 14, color: '#6b7280', textAlign: 'center' }}>
          Die Schriftarten konnten nicht geladen werden. Bitte versuchen Sie es später erneut.
        </Text>
        <Text style={{ fontSize: 12, color: '#dc2626', marginTop: 16, textAlign: 'center' }}>
          {fontError.message}
        </Text>
      </View>
    );
  }

  if (!fontsLoaded) {
    return null;
  }

  return (
    <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
    <ErrorBoundary>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider>
          <ThemeProvider>
            <ConsentProvider>
              <ConditionalPostHogProvider>
                <ThirdwebProvider>
                  <WalletBootProvider>
                  <GnosisWalletProvider>
                  <AuthGateProvider>
                    <VerificationProvider>
                      <UserProvider>
                      <AccountProvider>
                      <XmtpProvider>
                      <MessagingProvider>
                      <NotificationsProvider>
                      <RewardsProvider>
                      <MeckyProvider>
                      <GovernanceTestProvider>
                      <DeveloperModeProvider>
                      <MaciProvider>
                      <InterestProvider>
                      <BookmarksProvider>
                        <LocationProvider>
                          <SnackbarProvider>
                            <RoebelTalerProvider>
                            <RewardCelebrationProvider>
                            <PendingPostFeedbackProvider>
                              <ExploreDotProvider>
                                <ConsentGate />
                                <AppUpdateGate />
                                <ThemedLayout />
                                {/* <DebugLogOverlay /> — debug-log FAB disabled; re-enable here + in index.js */}
                              </ExploreDotProvider>
                            </PendingPostFeedbackProvider>
                            </RewardCelebrationProvider>
                            </RoebelTalerProvider>
                          </SnackbarProvider>
                        </LocationProvider>
                      </BookmarksProvider>
                      </InterestProvider>
                      </MaciProvider>
                      </DeveloperModeProvider>
                      </GovernanceTestProvider>
                      </MeckyProvider>
                      </RewardsProvider>
                      </NotificationsProvider>
                      </MessagingProvider>
                      </XmtpProvider>
                      </AccountProvider>
                      </UserProvider>
                    </VerificationProvider>
                  </AuthGateProvider>
                  </GnosisWalletProvider>
                  </WalletBootProvider>
                </ThirdwebProvider>
              </ConditionalPostHogProvider>
            </ConsentProvider>
          </ThemeProvider>
        </SafeAreaProvider>
        {!splashDone && <AnimatedSplash onFinish={() => setSplashDone(true)} />}
      </GestureHandlerRootView>
    </ErrorBoundary>
    </PersistQueryClientProvider>
  );
}

// Sentry is initialized manually inside ConsentGate when the user opts in to
// crash reporting. See lib/sentry-init.ts.
export default Layout;

const styles = StyleSheet.create({
  gradientContainer: {
    flex: 1,
  },
});
