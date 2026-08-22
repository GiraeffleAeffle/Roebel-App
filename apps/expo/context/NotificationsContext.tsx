import React, { createContext, useCallback, useContext, useMemo } from 'react';
import * as Notifications from 'expo-notifications';
import useNotifications, { UseNotificationsReturn } from '@/hooks/useNotifications';
import { useNotificationInbox } from '@/hooks/useNotificationInbox';
import useUserNotifications from '@/hooks/useUserNotifications';

type InboxState = ReturnType<typeof useNotificationInbox>;
type UserNotifsState = ReturnType<typeof useUserNotifications>;

type NotificationsContextValue = UseNotificationsReturn & {
  inbox: InboxState;
  userNotifs: UserNotifsState;
  unreadCount: number;
  userUnreadCount: number;
  totalUnreadCount: number;
  refreshInbox: () => Promise<void>;
  refreshUserNotifications: () => Promise<void>;
  markAllAsRead: () => Promise<void>;
};

const NotificationsContext = createContext<NotificationsContextValue | undefined>(undefined);

export function NotificationsProvider({ children }: { children: React.ReactNode }) {
  const notifications = useNotifications();
  const inbox = useNotificationInbox();
  const userNotifs = useUserNotifications();

  const markAllAsRead = useCallback(async () => {
    await Promise.all([inbox.markAllAsRead(), userNotifs.markAllAsRead()]);
    // Sync the OS state with the now-empty in-app inbox: clear the iOS app-icon
    // badge and dismiss any notifications still sitting in the system tray
    // (Android derives its launcher count from undismissed tray entries).
    try {
      await Promise.all([
        Notifications.setBadgeCountAsync(0),
        Notifications.dismissAllNotificationsAsync(),
      ]);
    } catch (err) {
      console.error('Failed to clear notification badge:', err);
    }
  }, [inbox.markAllAsRead, userNotifs.markAllAsRead]);

  // NOTE: `notifications`, `inbox`, and `userNotifs` are fresh object
  // literals returned by their respective hooks on every render (none of
  // useNotifications/useNotificationInbox/useUserNotifications memoize their
  // return value), so this useMemo's deps change every render too and the
  // cascade isn't actually broken here — see task-3 report for detail. The
  // memoization is still exact/correct and becomes effective for free the
  // moment those hooks are memoized upstream.
  const value = useMemo<NotificationsContextValue>(
    () => ({
      ...notifications,
      inbox,
      userNotifs,
      unreadCount: inbox.unreadCount,
      userUnreadCount: userNotifs.unreadCount,
      totalUnreadCount: inbox.unreadCount + userNotifs.unreadCount,
      refreshInbox: inbox.refresh,
      refreshUserNotifications: userNotifs.refresh,
      markAllAsRead,
    }),
    [notifications, inbox, userNotifs, markAllAsRead]
  );

  return (
    <NotificationsContext.Provider value={value}>
      {children}
    </NotificationsContext.Provider>
  );
}

export function useNotificationsContext(): NotificationsContextValue {
  const context = useContext(NotificationsContext);
  if (!context) {
    throw new Error('useNotificationsContext must be used within NotificationsProvider');
  }
  return context;
}
