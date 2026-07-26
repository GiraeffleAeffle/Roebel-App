import React, { useCallback, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  Pressable,
  ActivityIndicator,
  RefreshControl,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { useNotificationsContext } from '@/context/NotificationsContext';
import NotificationCard from '@/components/NotificationCard';
import InviteNotificationCard from '@/components/InviteNotificationCard';
import { NotificationCardSkeleton } from '@/components/SkeletonLoader';
import { cleanNotificationTitle, cleanNotificationBody } from '@/lib/notification-display';
import type { NotificationLogEntry, UserNotification } from '@/lib/types';
import { useTheme } from '@/context/ThemeContext';

import ChevronLeftIcon from '@/assets/icons/chevron-left.svg';
import NotificationIcon from '@/assets/icons/profile/notification.svg';

type MergedItem =
  | { kind: 'push'; data: NotificationLogEntry }
  | { kind: 'user'; data: UserNotification };

export default function NotificationsInboxScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { inbox: pushInbox, userNotifs, markAllAsRead } = useNotificationsContext();

  // Clear the header badge whenever the inbox is focused. Both server-side
  // (user notifications) and local (push log readIds) state are flipped to
  // read; new notifications arriving after this point will re-show the count.
  useFocusEffect(
    useCallback(() => {
      markAllAsRead();
    }, [markAllAsRead])
  );

  const isLoading = pushInbox.isLoading || userNotifs.isLoading;
  const isRefreshing = pushInbox.isRefreshing || userNotifs.isRefreshing;

  // Merge both notification sources chronologically
  const merged = useMemo<MergedItem[]>(() => {
    const pushItems: MergedItem[] = pushInbox.notifications.map((n) => ({ kind: 'push', data: n }));
    const userItems: MergedItem[] = userNotifs.notifications.map((n) => ({ kind: 'user', data: n }));
    return [...pushItems, ...userItems].sort(
      (a, b) => new Date(b.data.created_at).getTime() - new Date(a.data.created_at).getTime()
    );
  }, [pushInbox.notifications, userNotifs.notifications]);

  const handleRefresh = async () => {
    await Promise.all([pushInbox.refresh(), userNotifs.refresh()]);
  };

  const handleLoadMore = () => {
    if (pushInbox.hasMore) pushInbox.loadMore();
    if (userNotifs.hasMore) userNotifs.loadMore();
  };

  const handlePushNotificationPress = (notification: NotificationLogEntry) => {
    pushInbox.markAsRead(notification.id);
  };

  const renderItem = ({ item }: { item: MergedItem }) => {
    if (item.kind === 'push') {
      return (
        <NotificationCard
          notification={item.data}
          isRead={pushInbox.readIds.has(item.data.id)}
          onPress={handlePushNotificationPress}
        />
      );
    }

    // User notification
    if (item.data.type === 'org_invite') {
      return (
        <InviteNotificationCard
          notification={item.data}
          onAccept={userNotifs.acceptInvite}
          onDecline={userNotifs.declineInvite}
        />
      );
    }

    // Generic user notification (e.g. post_like / post_comment).
    // Deep-link to the post when metadata carries a post_id.
    const postId = (item.data.metadata as { post_id?: string } | undefined)?.post_id;
    return (
      <Pressable
        onPress={() => {
          userNotifs.markAsRead(item.data.id);
          if (postId) router.push(`/post/${postId}` as any);
          else if (item.data.type === 'story_invite') router.push('/messages/mecky' as any);
        }}
        style={[styles.genericCard, { backgroundColor: colors.surface }]}
      >
        <Text style={[styles.genericTitle, { color: colors.textPrimary }]}>
          {cleanNotificationTitle(item.data.title, item.data.type)}
        </Text>
        <Text style={[styles.genericBody, { color: colors.textSecondary }]}>
          {cleanNotificationBody(item.data.body)}
        </Text>
      </Pressable>
    );
  };

  const renderHeader = () => (
    <View style={[styles.header, { borderBottomColor: colors.border }]}>
      <Pressable onPress={() => router.back()} style={styles.backButton}>
        <ChevronLeftIcon width={24} height={24} color={colors.textPrimary} />
      </Pressable>
      <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>Benachrichtigungen</Text>
      <Pressable
        onPress={() => router.push('/notifications/settings' as any)}
        style={styles.settingsButton}
      >
        <NotificationIcon width={20} height={20} color={colors.textPrimary} />
      </Pressable>
    </View>
  );

  if (isLoading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        {renderHeader()}
        <View style={styles.flex1}>
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <NotificationCardSkeleton key={i} />
          ))}
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      {renderHeader()}
      <FlatList
        data={merged}
        keyExtractor={(item) => `${item.kind}-${item.data.id}`}
        renderItem={renderItem}
        refreshControl={
          <RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} tintColor={colors.primary} />
        }
        onEndReached={handleLoadMore}
        onEndReachedThreshold={0.3}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={[styles.emptyTitle, { color: colors.textPrimary }]}>Keine Benachrichtigungen</Text>
            <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
              Neue Benachrichtigungen erscheinen hier
            </Text>
          </View>
        }
        ListFooterComponent={
          pushInbox.isLoadingMore || userNotifs.isLoadingMore ? (
            <ActivityIndicator style={styles.loader} color={colors.primary} />
          ) : (
            <View style={styles.footerSpacer} />
          )
        }
        contentContainerStyle={merged.length === 0 ? { flex: 1 } : undefined}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex1: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 16, borderBottomWidth: 1 },
  backButton: { width: 40, height: 40, justifyContent: 'center', alignItems: 'flex-start' },
  headerTitle: { fontSize: 18, fontFamily: 'MonaSansSemiCondensed-Medium'},
  settingsButton: { width: 40, height: 40, justifyContent: 'center', alignItems: 'flex-end' },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32, paddingTop: 80 },
  emptyTitle: { fontSize: 16, fontFamily: 'Inter-Medium', marginBottom: 8 },
  emptySubtitle: { fontSize: 14, fontFamily: 'Inter-Regular', textAlign: 'center' },
  loader: { padding: 20 },
  footerSpacer: { height: 100 },
  genericCard: {
    borderRadius: 12,
    padding: 14,
    marginHorizontal: 16,
    marginVertical: 4,
  },
  genericTitle: { fontSize: 14, fontFamily: 'Inter-SemiBold', marginBottom: 4 },
  genericBody: { fontSize: 13, fontFamily: 'Inter-Regular' },
});
