import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fetchNotificationLog } from '@/lib/supabase-notifications';
import type { NotificationLogEntry } from '@/lib/types';

const READ_IDS_KEY = '@read_notification_ids';
const MAX_STORED_IDS = 500;

export function useNotificationInbox() {
  const [notifications, setNotifications] = useState<NotificationLogEntry[]>([]);
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const pageRef = useRef(0);

  useEffect(() => {
    loadReadIds();
    fetchInitial();
  }, []);

  const loadReadIds = async () => {
    try {
      const stored = await AsyncStorage.getItem(READ_IDS_KEY);
      if (stored) {
        setReadIds(new Set(JSON.parse(stored)));
      }
    } catch (err) {
      console.error('Error loading read notification IDs:', err);
    }
  };

  const saveReadIds = async (ids: Set<string>) => {
    try {
      const idsArray = Array.from(ids);
      const trimmed = idsArray.slice(-MAX_STORED_IDS);
      await AsyncStorage.setItem(READ_IDS_KEY, JSON.stringify(trimmed));
    } catch (err) {
      console.error('Error saving read notification IDs:', err);
    }
  };

  const fetchInitial = async () => {
    setIsLoading(true);
    pageRef.current = 0;
    const result = await fetchNotificationLog(0);
    setNotifications(result.data);
    setHasMore(result.hasMore);
    setIsLoading(false);
  };

  const refresh = useCallback(async () => {
    setIsRefreshing(true);
    pageRef.current = 0;
    const result = await fetchNotificationLog(0);
    setNotifications(result.data);
    setHasMore(result.hasMore);
    setIsRefreshing(false);
  }, []);

  const loadMore = useCallback(async () => {
    if (isLoadingMore || !hasMore) return;
    setIsLoadingMore(true);
    const nextPage = pageRef.current + 1;
    const result = await fetchNotificationLog(nextPage);
    pageRef.current = nextPage;
    setNotifications(prev => [...prev, ...result.data]);
    setHasMore(result.hasMore);
    setIsLoadingMore(false);
  }, [isLoadingMore, hasMore]);

  const markAsRead = useCallback(async (id: string) => {
    setReadIds(prev => {
      const next = new Set(prev);
      next.add(id);
      saveReadIds(next);
      return next;
    });
  }, []);

  const markAllAsRead = useCallback(async () => {
    setReadIds(prev => {
      const next = new Set(prev);
      notifications.forEach(n => next.add(n.id));
      saveReadIds(next);
      return next;
    });
  }, [notifications]);

  const unreadCount = notifications.filter(n => !readIds.has(n.id)).length;

  // Memoized so consumers (NotificationsContext) get a stable identity
  // between renders where none of these fields actually changed.
  return useMemo(
    () => ({
      notifications,
      readIds,
      isLoading,
      isRefreshing,
      isLoadingMore,
      hasMore,
      unreadCount,
      refresh,
      loadMore,
      markAsRead,
      markAllAsRead,
    }),
    [
      notifications,
      readIds,
      isLoading,
      isRefreshing,
      isLoadingMore,
      hasMore,
      unreadCount,
      refresh,
      loadMore,
      markAsRead,
      markAllAsRead,
    ]
  );
}
