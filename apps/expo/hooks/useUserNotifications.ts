import { useState, useEffect, useCallback, useRef } from 'react';
import { useActiveAccount } from 'thirdweb/react';
import { supabase } from '@/lib/supabase';
import { useUser } from '@/context/UserContext';
import { useAccount } from '@/context/AccountContext';
import {
  fetchUserNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  getUnreadNotificationCount,
} from '@/lib/supabase-member-notifications';
import { acceptInvite, declineInvite } from '@/lib/supabase-invites';
import type { UserNotification } from '@/lib/types';

export default function useUserNotifications() {
  const { user } = useUser();
  const { refreshAccounts } = useAccount();
  const account = useActiveAccount();
  const walletAddress = user?.wallet_address;

  const [notifications, setNotifications] = useState<UserNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const pageRef = useRef(0);

  const load = useCallback(async () => {
    if (!walletAddress) return;

    const [{ data, hasMore: more }, count] = await Promise.all([
      fetchUserNotifications(walletAddress, 0),
      getUnreadNotificationCount(walletAddress),
    ]);

    setNotifications(data);
    setHasMore(more);
    setUnreadCount(count);
    pageRef.current = 0;
  }, [walletAddress]);

  // Initial load
  useEffect(() => {
    setIsLoading(true);
    load().finally(() => setIsLoading(false));
  }, [load]);

  // Realtime subscription
  useEffect(() => {
    if (!walletAddress) return;

    const channel = supabase
      .channel('user-notifications')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `recipient_wallet=eq.${walletAddress.toLowerCase()}`,
        },
        (payload) => {
          const newNotif = payload.new as UserNotification;
          setNotifications((prev) => [newNotif, ...prev]);
          setUnreadCount((prev) => prev + 1);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [walletAddress]);

  const refresh = useCallback(async () => {
    setIsRefreshing(true);
    await load();
    setIsRefreshing(false);
  }, [load]);

  const loadMore = useCallback(async () => {
    if (!walletAddress || isLoadingMore || !hasMore) return;

    setIsLoadingMore(true);
    const nextPage = pageRef.current + 1;
    const { data, hasMore: more } = await fetchUserNotifications(walletAddress, nextPage);

    setNotifications((prev) => [...prev, ...data]);
    setHasMore(more);
    pageRef.current = nextPage;
    setIsLoadingMore(false);
  }, [walletAddress, isLoadingMore, hasMore]);

  const markAsRead = useCallback(async (id: string) => {
    await markNotificationRead(id);
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, is_read: true } : n))
    );
    setUnreadCount((prev) => Math.max(0, prev - 1));
  }, []);

  const markAllAsRead = useCallback(async () => {
    if (!walletAddress) return;
    // Skip org_invite — pending invitations stay unread until the user
    // explicitly accepts or declines so the bell keeps reminding them.
    setNotifications((prev) =>
      prev.map((n) => (n.type === 'org_invite' ? n : { ...n, is_read: true }))
    );
    setUnreadCount((prev) => {
      const remainingUnreadInvites = notifications.filter(
        (n) => n.type === 'org_invite' && !n.is_read
      ).length;
      return remainingUnreadInvites;
    });
    try {
      await markAllNotificationsRead(walletAddress);
    } catch (err) {
      console.error('Failed to mark all notifications as read:', err);
    }
  }, [walletAddress, notifications]);

  const handleAcceptInvite = useCallback(
    async (notification: UserNotification) => {
      if (!account) return;
      const invitationId = (notification.metadata as any)?.invitation_id;
      if (!invitationId) return;

      await acceptInvite(account, invitationId);
      setNotifications((prev) =>
        prev.map((n) => (n.id === notification.id ? { ...n, is_read: true } : n))
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
      await refreshAccounts();
    },
    [account, refreshAccounts]
  );

  const handleDeclineInvite = useCallback(
    async (notification: UserNotification) => {
      if (!account) return;
      const invitationId = (notification.metadata as any)?.invitation_id;
      if (!invitationId) return;

      await declineInvite(account, invitationId);
      setNotifications((prev) =>
        prev.map((n) => (n.id === notification.id ? { ...n, is_read: true } : n))
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
    },
    [account]
  );

  return {
    notifications,
    unreadCount,
    isLoading,
    isRefreshing,
    isLoadingMore,
    hasMore,
    refresh,
    loadMore,
    markAsRead,
    markAllAsRead,
    acceptInvite: handleAcceptInvite,
    declineInvite: handleDeclineInvite,
  };
}
