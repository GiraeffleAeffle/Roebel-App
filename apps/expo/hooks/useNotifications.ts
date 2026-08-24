/**
 * Push Notifications Hook
 *
 * Manages push notification registration, permissions, and preferences
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Platform, AppState, AppStateStatus } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useActiveAccount } from 'thirdweb/react';
import {
  registerPushToken,
  deactivatePushToken,
  linkPushTokenWallet,
  getNotificationPreferences,
  saveNotificationPreferences,
  initializePreferences,
  toggleEventCategory,
  NotificationPreferences,
  DEFAULT_PREFERENCES,
} from '@/lib/supabase-notifications';
import { EventCategory, EVENT_CATEGORIES } from '@/lib/categories';
import { getActiveConversationId } from '@/lib/active-conversation';
import { useConsent } from '@/context/ConsentContext';
import { useWalletBoot } from '@/context/WalletBootContext';

// AsyncStorage keys for prompt tracking
const PROMPT_SEEN_KEY = '@notification_prompt_seen';
const PROMPT_DISMISSED_KEY = '@notification_prompt_dismissed';

// Configure notification handler at module level. Runs only when a push
// arrives while the app is foregrounded.
Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    // Suppress the banner for a direct message the user is already viewing.
    const data = notification.request.content.data as
      | { type?: string; conversationId?: string }
      | undefined;
    if (
      data?.type === 'direct_message' &&
      data.conversationId &&
      data.conversationId === getActiveConversationId()
    ) {
      return {
        shouldShowAlert: false,
        shouldPlaySound: false,
        shouldSetBadge: false,
        shouldShowBanner: false,
        shouldShowList: false,
      };
    }
    return {
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
      shouldShowBanner: true,
      shouldShowList: true,
    };
  },
});

export type PermissionStatus = 'undetermined' | 'granted' | 'denied';

export interface UseNotificationsReturn {
  // State
  expoPushToken: string | null;
  permissionStatus: PermissionStatus;
  preferences: NotificationPreferences | null;
  isLoading: boolean;
  error: string | null;
  deviceId: string | null;
  hasSeenPrompt: boolean;
  hasDismissedPrompt: boolean;

  // Actions
  requestPermission: () => Promise<boolean>;
  refreshPreferences: () => Promise<void>;
  updatePreference: <K extends keyof NotificationPreferences>(
    key: K,
    value: NotificationPreferences[K]
  ) => Promise<void>;
  toggleCategory: (category: EventCategory) => Promise<void>;
  disableNotifications: () => Promise<void>;
  markPromptAsSeen: () => Promise<void>;
  markPromptAsDismissed: () => Promise<void>;
  enableAllNotifications: () => Promise<void>;
}

/**
 * Generate a unique device ID
 */
function getDeviceId(): string {
  // Use a combination of device properties to create a unique ID
  const deviceName = Device.deviceName || 'unknown';
  const osName = Device.osName || Platform.OS;
  const osVersion = Device.osVersion || 'unknown';
  const modelName = Device.modelName || 'unknown';

  // Create a semi-unique identifier (not cryptographically secure, but sufficient for device identification)
  const rawId = `${deviceName}-${modelName}-${osName}-${osVersion}`;

  // Simple hash to create a consistent ID
  let hash = 0;
  for (let i = 0; i < rawId.length; i++) {
    const char = rawId.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }

  return `device_${Math.abs(hash).toString(36)}`;
}

export type RegisteredPushDevice = {
  deviceId: string;
  token: string;
  preferences: NotificationPreferences;
  /** Non-null if the token could not be persisted to Supabase. */
  saveError: string | null;
};

/**
 * Register this device's Expo push token with Supabase and ensure notification
 * preferences exist. Standalone (no hook state) so opt-in surfaces like the
 * notification bottom sheet can register immediately after the OS grant,
 * without waiting for the hook's consent state to re-render.
 *
 * Callers are responsible for checking push consent first.
 * Returns null on simulators/emulators. Throws on configuration errors.
 *
 * Pass the logged-in wallet when known: a row created HERE for a fresh
 * install would otherwise stay unlinked until the next cold start (the
 * hook's wallet-link UPDATE matches zero rows before the row exists) and
 * targeted DM pushes would miss the device.
 */
export async function registerDevicePushToken(
  walletAddress?: string
): Promise<RegisteredPushDevice | null> {
  if (!Device.isDevice) {
    console.log('Push notifications not available on simulator/emulator');
    return null;
  }

  const projectId = Constants.expoConfig?.extra?.eas?.projectId;
  if (!projectId) {
    throw new Error('EAS Project ID not found in app.config.ts');
  }

  const tokenData = await Notifications.getExpoPushTokenAsync({ projectId });
  const token = tokenData.data;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Default',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#00498B',
    });
  }

  const deviceId = getDeviceId();
  const result = await registerPushToken(
    deviceId,
    token,
    Platform.OS as 'ios' | 'android',
    Constants.expoConfig?.version,
    walletAddress
  );
  if (!result.success) {
    console.error('Failed to save push token to Supabase:', result.error);
  }

  const preferences = await initializePreferences(deviceId);

  return {
    deviceId,
    token,
    preferences,
    saveError: result.success ? null : result.error || 'Failed to save push token',
  };
}

export function useNotifications(): UseNotificationsReturn {
  const { preferences: consentPrefs } = useConsent();
  const pushConsent = consentPrefs.push;
  const { autoConnectFinished } = useWalletBoot();
  const activeAccount = useActiveAccount();
  const walletAddress = activeAccount?.address ?? null;
  const [expoPushToken, setExpoPushToken] = useState<string | null>(null);
  const [permissionStatus, setPermissionStatus] = useState<PermissionStatus>('undetermined');
  const [preferences, setPreferences] = useState<NotificationPreferences | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [hasSeenPrompt, setHasSeenPrompt] = useState(false);
  const [hasDismissedPrompt, setHasDismissedPrompt] = useState(false);

  const notificationListener = useRef<Notifications.Subscription | undefined>(undefined);
  const responseListener = useRef<Notifications.Subscription | undefined>(undefined);
  const appState = useRef(AppState.currentState);

  /**
   * Check current permission status
   */
  const checkPermissionStatus = useCallback(async (): Promise<PermissionStatus> => {
    if (!Device.isDevice) {
      return 'denied'; // Push not available on simulator
    }

    const { status } = await Notifications.getPermissionsAsync();

    if (status === 'granted') return 'granted';
    if (status === 'denied') return 'denied';
    return 'undetermined';
  }, []);

  /**
   * Register push token with Expo and save to Supabase.
   * Deps matter: with `[]` this captured the mount-time pushConsent (false —
   * consent hydrates async from SecureStore), silently skipping registration
   * for the whole session.
   */
  const registerToken = useCallback(async () => {
    console.log('=== REGISTER TOKEN ===');

    if (!pushConsent) {
      console.log('Push consent not granted; skipping token registration');
      return;
    }

    try {
      const registered = await registerDevicePushToken(walletAddress ?? undefined);
      if (!registered) return;

      setExpoPushToken(registered.token);
      setDeviceId(registered.deviceId);
      setPreferences(registered.preferences);
      if (registered.saveError) {
        setError(registered.saveError);
      }

      console.log('=== TOKEN REGISTRATION COMPLETE ===');
    } catch (err) {
      console.error('Error registering push token:', err);
      setError('Failed to register for push notifications');
    }
  }, [pushConsent, walletAddress]);

  /**
   * Request notification permission
   */
  const requestPermission = useCallback(async (): Promise<boolean> => {
    console.log('=== REQUEST PERMISSION ===');
    console.log('Device.isDevice:', Device.isDevice);

    if (!pushConsent) {
      console.log('Push consent not granted; refusing to request OS permission');
      setError(null);
      return false;
    }

    if (!Device.isDevice) {
      console.log('Not a physical device, returning false');
      setError('Push notifications require a physical device');
      return false;
    }

    try {
      const { status: existingStatus } = await Notifications.getPermissionsAsync();
      console.log('Existing permission status:', existingStatus);
      let finalStatus = existingStatus;

      if (existingStatus !== 'granted') {
        console.log('Requesting permission from system...');
        const { status } = await Notifications.requestPermissionsAsync();
        console.log('System returned status:', status);
        finalStatus = status;
      }

      const newPermissionStatus: PermissionStatus =
        finalStatus === 'granted' ? 'granted' : 'denied';

      console.log('Final permission status:', newPermissionStatus);
      setPermissionStatus(newPermissionStatus);

      if (finalStatus === 'granted') {
        console.log('Permission granted! Registering token...');
        await registerToken();
        return true;
      }

      console.log('Permission not granted');
      return false;
    } catch (err) {
      console.error('Error requesting permission:', err);
      setError('Failed to request notification permission');
      return false;
    }
  }, [pushConsent, registerToken]);

  /**
   * Self-heal: register whenever both gates are open and no token has been
   * registered this session. Covers consent hydrating after the mount-time
   * initialize (which read pushConsent=false), the opt-in sheet granting the
   * OS permission mid-session, and returning from the system settings (the
   * AppState listener refreshes permissionStatus on foreground).
   */
  useEffect(() => {
    if (!pushConsent || permissionStatus !== 'granted' || expoPushToken) return;
    void registerToken();
  }, [pushConsent, permissionStatus, expoPushToken, registerToken]);

  /**
   * Keep the device's push token linked to the logged-in wallet so it can
   * receive targeted pushes (e.g. direct messages). Runs once the token is
   * registered (deviceId set) and whenever the wallet changes (login, account
   * switch, logout → null).
   */
  useEffect(() => {
    if (!deviceId) return;
    // During the cold-start reconnect window the wallet is transiently null.
    // Writing that null would unlink the device until the next full app start
    // — a killed app then misses every targeted DM push. Only a real logout
    // (null AFTER autoConnect settled) may clear the link.
    if (walletAddress === null && !autoConnectFinished) return;
    linkPushTokenWallet(deviceId, walletAddress);
  }, [deviceId, walletAddress, autoConnectFinished]);

  /**
   * Refresh preferences from Supabase
   */
  const refreshPreferences = useCallback(async () => {
    if (!deviceId) return;

    try {
      const prefs = await getNotificationPreferences(deviceId);
      if (prefs) {
        setPreferences(prefs);
      }
    } catch (err) {
      console.error('Error refreshing preferences:', err);
    }
  }, [deviceId]);

  /**
   * Update a specific preference
   */
  const updatePreference = useCallback(async <K extends keyof NotificationPreferences>(
    key: K,
    value: NotificationPreferences[K]
  ) => {
    if (!deviceId || !preferences) return;

    // Optimistic update
    const previousPrefs = preferences;
    setPreferences({ ...preferences, [key]: value });

    const result = await saveNotificationPreferences(deviceId, { [key]: value });

    if (!result.success) {
      // Revert on error
      setPreferences(previousPrefs);
      setError(result.error || 'Failed to save preference');
    }
  }, [deviceId, preferences]);

  /**
   * Toggle an event category
   */
  const toggleCategory = useCallback(async (category: EventCategory) => {
    if (!deviceId || !preferences) return;

    const result = await toggleEventCategory(
      deviceId,
      category,
      preferences.event_categories
    );

    if (result.success) {
      setPreferences({
        ...preferences,
        event_categories: result.newCategories,
      });
    } else {
      setError(result.error || 'Failed to update category');
    }
  }, [deviceId, preferences]);

  /**
   * Disable notifications (deactivate token)
   */
  const disableNotifications = useCallback(async () => {
    if (!deviceId) return;

    const result = await deactivatePushToken(deviceId);

    if (result.success) {
      setExpoPushToken(null);
      setPermissionStatus('denied');
    } else {
      setError(result.error || 'Failed to disable notifications');
    }
  }, [deviceId]);

  /**
   * Mark the notification prompt as seen
   */
  const markPromptAsSeen = useCallback(async () => {
    try {
      await AsyncStorage.setItem(PROMPT_SEEN_KEY, 'true');
      setHasSeenPrompt(true);
    } catch (err) {
      console.error('Error saving prompt seen state:', err);
    }
  }, []);

  /**
   * Mark the notification prompt as dismissed (user clicked "Nein, Danke")
   */
  const markPromptAsDismissed = useCallback(async () => {
    try {
      await AsyncStorage.setItem(PROMPT_DISMISSED_KEY, 'true');
      await AsyncStorage.setItem(PROMPT_SEEN_KEY, 'true');
      setHasDismissedPrompt(true);
      setHasSeenPrompt(true);
    } catch (err) {
      console.error('Error saving prompt dismissed state:', err);
    }
  }, []);

  /**
   * Enable all notifications with default preferences
   */
  const enableAllNotifications = useCallback(async () => {
    if (!deviceId) return;

    try {
      // Enable all notification preferences
      const allEnabledPrefs = {
        events_enabled: true,
        event_categories: [...EVENT_CATEGORIES],
        news_enabled: true,
        news_breaking: true,
        news_featured: true,
        feed_posts_enabled: true,
        dms_enabled: true,
      };

      const result = await saveNotificationPreferences(deviceId, allEnabledPrefs);

      if (result.success) {
        setPreferences(prev => prev ? { ...prev, ...allEnabledPrefs } : null);
      } else {
        setError(result.error || 'Failed to enable all notifications');
      }
    } catch (err) {
      console.error('Error enabling all notifications:', err);
      setError('Failed to enable all notifications');
    }
  }, [deviceId]);

  /**
   * Initialize on mount
   */
  useEffect(() => {
    let mounted = true;

    async function initialize() {
      setIsLoading(true);
      setError(null);

      // Debug logging
      console.log('=== NOTIFICATIONS DEBUG ===');
      console.log('Device.isDevice:', Device.isDevice);
      console.log('Device.modelName:', Device.modelName);
      console.log('Platform:', Platform.OS);

      try {
        // Load prompt state from AsyncStorage
        const [seenValue, dismissedValue] = await Promise.all([
          AsyncStorage.getItem(PROMPT_SEEN_KEY),
          AsyncStorage.getItem(PROMPT_DISMISSED_KEY),
        ]);

        if (mounted) {
          setHasSeenPrompt(seenValue === 'true');
          setHasDismissedPrompt(dismissedValue === 'true');
        }
        console.log('Prompt seen:', seenValue, 'Prompt dismissed:', dismissedValue);

        // Check current permission status
        const status = await checkPermissionStatus();
        console.log('Permission status:', status);

        if (mounted) {
          setPermissionStatus(status);
        }

        // If permission granted AND user has consented to push, register token
        if (status === 'granted' && pushConsent) {
          console.log('Permission granted, registering token...');
          await registerToken();
        } else {
          console.log('Permission not granted, setting up device ID only');
          // Still set device ID for preferences
          const id = getDeviceId();
          console.log('Device ID:', id);
          if (mounted) {
            setDeviceId(id);
            const prefs = await getNotificationPreferences(id);
            console.log('Loaded preferences:', prefs);
            setPreferences(prefs || {
              device_id: id,
              ...DEFAULT_PREFERENCES,
            });
          }
        }
      } catch (err) {
        console.error('Error initializing notifications:', err);
        if (mounted) {
          setError('Failed to initialize notifications');
        }
      } finally {
        if (mounted) {
          setIsLoading(false);
          console.log('=== NOTIFICATIONS INIT COMPLETE ===');
        }
      }
    }

    initialize();

    // Revoke token if consent flips off mid-session
    const revokeIfDenied = async () => {
      if (!pushConsent && expoPushToken) {
        await deactivatePushToken(getDeviceId());
        if (mounted) {
          setExpoPushToken(null);
        }
      }
    };
    void revokeIfDenied();

    // Set up notification listeners
    notificationListener.current = Notifications.addNotificationReceivedListener(
      (notification) => {
        console.log('Notification received:', notification.request.content.title);
      }
    );

    responseListener.current = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        console.log('Notification response:', response.notification.request.content.data);
        // Navigation handled in _layout.tsx NotificationHandler
      }
    );

    // Handle app state changes (re-check permission when app comes to foreground)
    const subscription = AppState.addEventListener('change', async (nextAppState: AppStateStatus) => {
      if (
        appState.current.match(/inactive|background/) &&
        nextAppState === 'active'
      ) {
        // App has come to foreground
        const status = await checkPermissionStatus();
        if (mounted) {
          setPermissionStatus(status);
        }
      }
      appState.current = nextAppState;
    });

    return () => {
      mounted = false;

      if (notificationListener.current) {
        notificationListener.current.remove();
      }
      if (responseListener.current) {
        responseListener.current.remove();
      }
      subscription.remove();
    };
  }, []);

  // Memoized so consumers (NotificationsContext) get a stable identity
  // between renders where none of these fields actually changed — the
  // notification-poll cascade otherwise re-renders every consumer even when
  // nothing here is new.
  return useMemo<UseNotificationsReturn>(
    () => ({
      expoPushToken,
      permissionStatus,
      preferences,
      isLoading,
      error,
      deviceId,
      hasSeenPrompt,
      hasDismissedPrompt,
      requestPermission,
      refreshPreferences,
      updatePreference,
      toggleCategory,
      disableNotifications,
      markPromptAsSeen,
      markPromptAsDismissed,
      enableAllNotifications,
    }),
    [
      expoPushToken,
      permissionStatus,
      preferences,
      isLoading,
      error,
      deviceId,
      hasSeenPrompt,
      hasDismissedPrompt,
      requestPermission,
      refreshPreferences,
      updatePreference,
      toggleCategory,
      disableNotifications,
      markPromptAsSeen,
      markPromptAsDismissed,
      enableAllNotifications,
    ]
  );
}

export default useNotifications;
