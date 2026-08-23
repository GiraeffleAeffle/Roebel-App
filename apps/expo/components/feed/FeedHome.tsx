import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View,
  StyleSheet,
  Pressable,
  ScrollView,
  UIManager,
  useWindowDimensions,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import Animated, {
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { useTheme } from '@/context/ThemeContext';
import { useUser } from '@/context/UserContext';
import { useAccount } from '@/context/AccountContext';
import { useRequireAuth } from '@/context/AuthGateContext';
import { useSnackbar } from '@/context/SnackbarContext';
import { useNotificationsContext } from '@/context/NotificationsContext';
import { useMessaging } from '@/context/MessagingContext';
import { useXmtp } from '@/context/XmtpContext';
import { deletePost, pinPost, DuplicateReportError } from '@/lib/supabase-posts';
import { isPostPinned, pinErrorMessage } from '@/lib/utils/pin';
import type { FeedType, PostRecord } from '@/lib/types/feed';
import BottomNavigation, { BOTTOM_NAV_HEIGHT } from '@/components/BottomNavigation';
import GlassSurface from '@/components/GlassSurface';
import FeedTabBar from './FeedTabBar';
import FeedList, { type FeedListHandle } from './FeedList';
import PostComposer from './PostComposer';
import PostOptionsDrawer from './PostOptionsDrawer';
import RepostDrawer from './RepostDrawer';
import ReportDrawer from './ReportDrawer';
import ConfirmationDrawer from '@/components/ConfirmationDrawer';
import FeedFAB from './FeedFAB';
import MailIcon from '@/assets/icons/mail-01.svg';
import CalendarIcon from '@/assets/icons/calendar-02.svg';
import NotificationIcon from '@/assets/icons/profile/notification.svg';
import PostBar from './PostBar';
import HomeStoryBar from './HomeStoryBar';
import { HeaderWeather } from './HeaderWeather';
import { useIsBusinessOwner } from '@/hooks/useIsBusinessOwner';
import { usePostActions } from '@/hooks/usePostActions';
import { useActiveProfileImage } from '@/hooks/useActiveProfileImage';
import { useFeedTabSeen } from '@/hooks/useFeedTabSeen';
import { usePendingPostFeedback } from '@/context/PendingPostFeedbackContext';

const HANDWRITTEN_LIGHT = require('@/assets/handwritten/light-mode.png');
const HANDWRITTEN_DARK = require('@/assets/handwritten/dark-mode.png');
// Tinting the source guarantees the strokes always contrast with the
// active surface even if either asset gets re-exported with a slightly
// different alpha/anti-alias ramp.

const TAB_ORDER: FeedType[] = ['main', 'rathaus', 'app'];

// Detect whether the native PagerView module is baked into the current
// binary. An EAS Update can ship JS that imports a new native module into
// a binary that was built before the module existed — rendering that
// module would crash the app. We fall back to a pure-JS horizontal
// ScrollView when the native view manager isn't registered.
const PagerViewModule = (() => {
  try {
    const mod = require('react-native-pager-view');
    const native =
      !!UIManager.getViewManagerConfig?.('RNCViewPager') ||
      !!UIManager.getViewManagerConfig?.('RCTRNCViewPager');
    return native ? mod.default : null;
  } catch {
    return null;
  }
})() as React.ComponentType<any> | null;

type PagerProps = {
  initialPage: number;
  scrollProgress: SharedValue<number>;
  onPageSelected: (index: number) => void;
  pageWidth: number;
  /** When false, horizontal paging is locked (non-citizens stay on 'main'). */
  scrollEnabled?: boolean;
  children: React.ReactNode;
};

type PagerHandle = {
  setPage: (index: number) => void;
};

const NativePager = PagerViewModule
  ? React.forwardRef<PagerHandle, PagerProps>(function NativePager(
      { initialPage, scrollProgress, onPageSelected, children, pageWidth: _pageWidth, scrollEnabled = true },
      ref,
    ) {
      const pagerRef = useRef<any>(null);
      React.useImperativeHandle(ref, () => ({
        setPage: (i: number) => pagerRef.current?.setPage?.(i),
      }));

      const handleScroll = useCallback(
        (e: { nativeEvent: { position: number; offset: number } }) => {
          scrollProgress.value = e.nativeEvent.position + e.nativeEvent.offset;
        },
        [scrollProgress],
      );

      const handleSelected = useCallback(
        (e: { nativeEvent: { position: number } }) => {
          onPageSelected(e.nativeEvent.position);
        },
        [onPageSelected],
      );

      const Pager = PagerViewModule!;
      return (
        <Pager
          ref={pagerRef}
          style={styles.pager}
          initialPage={initialPage}
          onPageScroll={handleScroll}
          onPageSelected={handleSelected}
          offscreenPageLimit={2}
          scrollEnabled={scrollEnabled}
          overdrag
        >
          {children}
        </Pager>
      );
    })
  : null;

const ScrollPager = React.forwardRef<PagerHandle, PagerProps>(function ScrollPager(
  { initialPage, scrollProgress, onPageSelected, pageWidth, children, scrollEnabled = true },
  ref,
) {
  const scrollRef = useRef<ScrollView>(null);
  const scrollX = useSharedValue(initialPage * pageWidth);

  React.useEffect(() => {
    scrollProgress.value = pageWidth > 0 ? scrollX.value / pageWidth : 0;
  }, [pageWidth, scrollProgress, scrollX]);

  React.useImperativeHandle(ref, () => ({
    setPage: (i: number) => {
      scrollRef.current?.scrollTo({ x: i * pageWidth, animated: true });
    },
  }));

  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (e) => {
      scrollX.value = e.contentOffset.x;
      scrollProgress.value = pageWidth > 0 ? e.contentOffset.x / pageWidth : 0;
    },
  });

  const handleMomentumEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (pageWidth <= 0) return;
      const idx = Math.round(e.nativeEvent.contentOffset.x / pageWidth);
      onPageSelected(idx);
    },
    [onPageSelected, pageWidth],
  );

  return (
    <Animated.ScrollView
      ref={scrollRef as any}
      horizontal
      pagingEnabled
      scrollEnabled={scrollEnabled}
      showsHorizontalScrollIndicator={false}
      onScroll={scrollHandler}
      scrollEventThrottle={16}
      onMomentumScrollEnd={handleMomentumEnd}
      decelerationRate="fast"
      disableIntervalMomentum
      bounces={false}
      overScrollMode="never"
      contentOffset={{ x: initialPage * pageWidth, y: 0 }}
      style={styles.pager}
    >
      {children}
    </Animated.ScrollView>
  );
});

const Pager = (NativePager ?? ScrollPager) as React.ForwardRefExoticComponent<
  PagerProps & React.RefAttributes<PagerHandle>
>;

export default function FeedHome() {
  const { colors, isDark } = useTheme();
  const router = useRouter();
  const { user, isCitizen } = useUser();
  const walletAddress = user?.wallet_address;
  const { isOwnerOf, activeAccount } = useAccount();
  const activeProfileImage = useActiveProfileImage();
  const requireAuth = useRequireAuth();
  const { showSnackbar } = useSnackbar();
  const { totalUnreadCount } = useNotificationsContext();
  const { unreadCount: unreadMessages } = useMessaging();
  // Nudge every not-yet-activated user into the DM tab, where the
  // "Private Nachrichten aktivieren" sheet auto-presents.
  const { activationAvailable: xmtpActivationPending } = useXmtp();
  const { width: screenWidth } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const [headerHeight, setHeaderHeight] = useState(0);
  const headerTranslateY = useSharedValue(0);

  const onHeaderLayout = useCallback((e: LayoutChangeEvent) => {
    const next = e.nativeEvent.layout.height;
    setHeaderHeight((prev) => (prev === next ? prev : next));
  }, []);

  const headerAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: headerTranslateY.value }],
  }));

  // Bottom nav slides off only when the header is fully collapsed.
  const bottomNavTranslateY = useDerivedValue(() => {
    if (headerHeight === 0) return 0;
    const collapsed = headerTranslateY.value <= -headerHeight + 1;
    return withTiming(collapsed ? BOTTOM_NAV_HEIGHT + insets.bottom + 16 : 0, {
      duration: 180,
    });
  });
  const bottomNavAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: bottomNavTranslateY.value }],
  }));

  // FAB shrinks away alongside the bottom nav so it doesn't float in
  // empty space when the chrome is hidden.
  const fabVisibilityScale = useDerivedValue(() => {
    if (headerHeight === 0) return 1;
    const collapsed = headerTranslateY.value <= -headerHeight + 1;
    return withTiming(collapsed ? 0 : 1, { duration: 180 });
  });

  const [activeTab, setActiveTab] = useState<FeedType>('main');
  const [navTab, setNavTab] = useState<'home' | 'explore' | 'map' | 'profile'>('home');
  // While a finger is on the horizontal story rail, the pager's own
  // horizontal gesture is disabled so a story swipe can never fall through
  // and flip the feed tab instead.
  const [storyRailActive, setStoryRailActive] = useState(false);
  const [reportDrawerVisible, setReportDrawerVisible] = useState(false);
  const [reportingPostId, setReportingPostId] = useState<string | null>(null);
  const [optionsDrawerVisible, setOptionsDrawerVisible] = useState(false);
  const [selectedPost, setSelectedPost] = useState<PostRecord | null>(null);
  const [deleteConfirmVisible, setDeleteConfirmVisible] = useState(false);
  const [editComposerVisible, setEditComposerVisible] = useState(false);
  const [repostTarget, setRepostTarget] = useState<{ post: PostRecord; reposted: boolean } | null>(
    null,
  );

  const pagerRef = useRef<PagerHandle>(null);
  const scrollProgress = useSharedValue(0);

  const mainListRef = useRef<FeedListHandle>(null);
  const rathausListRef = useRef<FeedListHandle>(null);
  const appListRef = useRef<FeedListHandle>(null);

  const { reportPost, repost, unrepost } = usePostActions(walletAddress);

  const refreshAll = useCallback(() => {
    mainListRef.current?.refresh();
    rathausListRef.current?.refresh();
    appListRef.current?.refresh();
  }, []);

  const { consume: consumePostFeedback } = usePendingPostFeedback();

  useFocusEffect(
    useCallback(() => {
      const pending = consumePostFeedback();
      if (pending) {
        refreshAll();
        showSnackbar({ message: pending.message });
      }
    }, [consumePostFeedback, refreshAll, showSnackbar])
  );

  // Track whether the home screen is focused so feed videos pause (audio +
  // video) when the user navigates to another screen — otherwise an unmuted
  // video keeps playing in the background.
  const [screenFocused, setScreenFocused] = useState(true);
  useFocusEffect(
    useCallback(() => {
      setScreenFocused(true);
      return () => setScreenFocused(false);
    }, [])
  );

  const removePostEverywhere = useCallback((postId: string) => {
    mainListRef.current?.removePost(postId);
    rathausListRef.current?.removePost(postId);
    appListRef.current?.removePost(postId);
  }, []);

  const isOwnPost = useCallback(
    (post: PostRecord | null): boolean => {
      if (!post || !walletAddress) return false;
      if (post.wallet_address?.toLowerCase() === walletAddress.toLowerCase()) return true;
      return isOwnerOf(post.account_id ?? null);
    },
    [walletAddress, isOwnerOf],
  );

  // Onboarding "Bürger:in" gate for the pinned proposal hero card. Distinct
  // from isCitizen (NFT-verified) — driven by the role picked in onboarding.
  const isBuerger = user?.preferred_role === 'buerger';
  const { isBusinessOwner } = useIsBusinessOwner();

  // Audience gates. `canSeeProposals` shows the proposal hero card to
  // self-selected Bürger AND shop/business owners even before they hold the
  // Citizen NFT. `canAccessCityTabs` additionally unlocks the 'Umfragen' and
  // 'App' tabs for verified citizens and business owners. Voting itself stays
  // gated on the real `isCitizen` NFT (see VoteButtons) — a non-verified viewer
  // gets the "verify to vote" state with a verification CTA.
  const canSeeProposals = isBuerger || isBusinessOwner;
  const canAccessCityTabs = isCitizen || isBusinessOwner;

  // "New content" dots on the Stadt/App tabs. Each FeedList reports its newest
  // item timestamp; we compare against the persisted last-seen time.
  const { lastSeen, markSeen } = useFeedTabSeen();
  const [newestByTab, setNewestByTab] = useState<{ rathaus: string | null; app: string | null }>({
    rathaus: null,
    app: null,
  });
  const handleNewestContent = useCallback((feedType: FeedType, newestIso: string | null) => {
    if (feedType !== 'rathaus' && feedType !== 'app') return;
    setNewestByTab((prev) => (prev[feedType] === newestIso ? prev : { ...prev, [feedType]: newestIso }));
  }, []);

  const isUnseen = (newest: string | null, seen: string | undefined): boolean =>
    newest !== null && (!seen || newest > seen);
  const tabUnread = {
    rathaus: isUnseen(newestByTab.rathaus, lastSeen.rathaus),
    app: isUnseen(newestByTab.app, lastSeen.app),
  };

  const effectiveTab: FeedType = canAccessCityTabs ? activeTab : 'main';

  // Mark the active tab as seen (clears its dot) while the user is viewing it,
  // and keep it clear as new items stream in.
  useEffect(() => {
    if (!screenFocused) return;
    if (activeTab === 'rathaus' || activeTab === 'app') markSeen(activeTab);
  }, [activeTab, screenFocused, newestByTab.rathaus, newestByTab.app, markSeen]);

  const handleTabChange = (tab: FeedType) => {
    const idx = TAB_ORDER.indexOf(tab);
    if (idx === -1) return;
    pagerRef.current?.setPage(idx);
    setActiveTab(tab);
  };

  const handlePageSelected = useCallback((idx: number) => {
    const next = TAB_ORDER[idx];
    if (next) setActiveTab(next);
  }, []);

  const handleNavTabPress = (tab: 'home' | 'explore' | 'map' | 'profile') => {
    setNavTab(tab);
    if (tab === 'explore') {
      router.push('/explore');
    } else if (tab === 'map') {
      router.push('/location');
    } else if (tab === 'profile') {
      router.push('/profile');
    }
  };

  const handleCompose = () => {
    requireAuth(() => {
      router.push({ pathname: '/create', params: { feedType: effectiveTab } } as any);
    });
  };

  const handleMore = (post: PostRecord) => {
    setSelectedPost(post);
    setOptionsDrawerVisible(true);
  };

  const handleRepostPress = useCallback(
    (target: PostRecord, reposted: boolean) => {
      requireAuth(() => setRepostTarget({ post: target, reposted }));
    },
    [requireAuth],
  );

  const handleConfirmRepost = async () => {
    if (!repostTarget) return;
    const { post: target, reposted } = repostTarget;
    setRepostTarget(null);
    try {
      if (reposted) {
        await unrepost(target);
        showSnackbar({ message: 'Repost entfernt' });
      } else {
        await repost(target, activeAccount?.id);
        showSnackbar({ message: 'Repostet — erscheint in „Für Alle“' });
      }
      refreshAll();
    } catch (e) {
      console.error('[FeedHome.handleConfirmRepost]', e);
      showSnackbar({ message: 'Repost fehlgeschlagen' });
    }
  };

  const handleQuote = () => {
    if (!repostTarget) return;
    const id = repostTarget.post.id;
    setRepostTarget(null);
    requireAuth(() => {
      router.push({ pathname: '/create', params: { quotedPostId: id } } as any);
    });
  };

  const handleEditPost = () => {
    setEditComposerVisible(true);
  };

  const handleDeletePost = () => {
    setDeleteConfirmVisible(true);
  };

  const confirmDeletePost = async () => {
    if (!selectedPost || !walletAddress) return;
    if (selectedPost.wallet_address?.toLowerCase() !== walletAddress.toLowerCase()) {
      showSnackbar({ message: 'Du kannst diesen Beitrag nicht löschen' });
      return;
    }
    const postId = selectedPost.id;
    try {
      await deletePost(postId, walletAddress);
      removePostEverywhere(postId);
      showSnackbar({ message: 'Beitrag gelöscht' });
      setDeleteConfirmVisible(false);
      setSelectedPost(null);
      refreshAll();
    } catch (e) {
      console.error('[FeedHome.confirmDeletePost]', e);
      showSnackbar({ message: 'Fehler beim Löschen des Beitrags' });
    }
  };

  const handlePostUpdated = () => {
    setEditComposerVisible(false);
    setSelectedPost(null);
    refreshAll();
  };

  const handleTogglePin = async () => {
    if (!selectedPost || !walletAddress) return;
    const currentlyPinned = isPostPinned(selectedPost.pinned_until);
    try {
      await pinPost(selectedPost.id, walletAddress, !currentlyPinned);
      showSnackbar({
        message: currentlyPinned ? 'Anheftung aufgehoben' : 'Beitrag oben angeheftet',
      });
      setSelectedPost(null);
      refreshAll();
    } catch (e) {
      console.error('[FeedHome.handleTogglePin]', e);
      showSnackbar({ message: pinErrorMessage(e) });
    }
  };

  const handleOpenReport = () => {
    if (!selectedPost) return;
    setReportingPostId(selectedPost.id);
    setReportDrawerVisible(true);
  };

  const handleSubmitReport = async (reason: string) => {
    if (!reportingPostId) return;
    try {
      await reportPost(reportingPostId, reason);
      showSnackbar({ message: 'Beitrag wurde gemeldet' });
    } catch (err) {
      if (err instanceof DuplicateReportError) {
        showSnackbar({ message: 'Du hast diesen Beitrag bereits gemeldet.' });
        return;
      }
      showSnackbar({ message: 'Fehler beim Melden des Beitrags' });
      throw new Error('Report failed');
    }
  };

  const appHeader = (
    <Animated.View
      onLayout={onHeaderLayout}
      style={[
        styles.headerWrapper,
        styles.headerFloating,
        { paddingTop: insets.top },
        headerAnimatedStyle,
      ]}
    >
      <GlassSurface />
      <View style={styles.header}>
        <HeaderWeather
          fallbackSource={isDark ? HANDWRITTEN_DARK : HANDWRITTEN_LIGHT}
          fallbackTintColor={colors.textPrimary}
        />
        <View style={styles.headerActions}>
          <Pressable
            style={styles.headerIconBtn}
            accessibilityLabel="Kalender"
            onPress={() => router.push('/calendar' as any)}
          >
            <CalendarIcon width={22} height={22} color={colors.textPrimary} />
          </Pressable>
          <Pressable
            style={styles.headerIconBtn}
            accessibilityLabel="Nachrichten"
            onPress={() => router.push('/messages' as any)}
          >
            <MailIcon width={22} height={22} color={colors.textPrimary} />
            {(unreadMessages > 0 || xmtpActivationPending) && <View style={styles.dot} />}
          </Pressable>
          <Pressable
            style={styles.headerIconBtn}
            accessibilityLabel="Benachrichtigungen"
            onPress={() => router.push('/notifications' as any)}
          >
            <NotificationIcon width={22} height={22} color={colors.textPrimary} />
            {totalUnreadCount > 0 && <View style={styles.dot} />}
          </Pressable>
        </View>
      </View>

      <PostBar
        avatarUrl={activeProfileImage.url}
        fallbackInitial={activeProfileImage.fallbackInitial}
        disableFrame={activeProfileImage.isOrg}
        onPress={handleCompose}
      />

      {canAccessCityTabs && (
        <FeedTabBar
          activeTab={activeTab}
          onTabChange={handleTabChange}
          scrollProgress={scrollProgress}
          unread={tabUnread}
        />
      )}
    </Animated.View>
  );

  const bottomPadding = BOTTOM_NAV_HEIGHT + insets.bottom;
  const feedListProps = {
    headerTranslateY,
    headerHeight,
    topPadding: headerHeight,
    bottomPadding,
    onRepost: handleRepostPress,
  };

  return (
    <SafeAreaView
      edges={['left', 'right']}
      style={[styles.container, { backgroundColor: colors.background }]}
    >
      {/* Bottom safe-area band sits beneath the floating bottom nav
          (zIndex 9 < 10) so when the nav slides away on scroll the
          home-indicator area keeps a solid surface fill instead of
          revealing the gray feed beneath. The top band is rendered
          AFTER the header below so it paints above it and the status
          bar zone stays a constant colors.background regardless of
          scroll position. */}
      <View pointerEvents="none" style={[styles.bottomSafeBand, { height: insets.bottom }]}>
        <GlassSurface />
      </View>
      {/* The Pager is ALWAYS rendered (even for non-citizens, where it's
          locked to the 'main' page via scrollEnabled={false}). Keeping the
          structure stable means the 'main' FeedList + its HomeStoryBar header
          mount once and survive the isCitizen flip on cold start — so posts and
          stories never disappear/reload. rathaus/app only fetch once isCitizen
          resolves (enabled gate); offscreenPageLimit keeps all pages mounted so
          tab switches don't refetch. */}
      <Pager
        ref={pagerRef}
        initialPage={0}
        scrollProgress={scrollProgress}
        onPageSelected={handlePageSelected}
        pageWidth={screenWidth}
        scrollEnabled={canAccessCityTabs && !storyRailActive}
      >
        <View key="main" style={[styles.page, { width: screenWidth }]} collapsable={false}>
          <FeedList
            ref={mainListRef}
            feedType="main"
            isCitizen={isCitizen}
            walletAddress={walletAddress}
            onCompose={handleCompose}
            onMore={handleMore}
            listHeader={<HomeStoryBar onRailTouchActive={setStoryRailActive} />}
            showProposalHero={canSeeProposals}
            active={screenFocused && effectiveTab === 'main'}
            {...feedListProps}
          />
        </View>
        <View key="rathaus" style={[styles.page, { width: screenWidth }]} collapsable={false}>
          <FeedList
            ref={rathausListRef}
            feedType="rathaus"
            isCitizen={isCitizen}
            walletAddress={walletAddress}
            onCompose={handleCompose}
            onMore={handleMore}
            active={screenFocused && effectiveTab === 'rathaus'}
            enabled={canAccessCityTabs}
            onNewestContent={handleNewestContent}
            showProposalHero={canSeeProposals}
            {...feedListProps}
          />
        </View>
        <View key="app" style={[styles.page, { width: screenWidth }]} collapsable={false}>
          <FeedList
            ref={appListRef}
            feedType="app"
            isCitizen={isCitizen}
            walletAddress={walletAddress}
            onCompose={handleCompose}
            onMore={handleMore}
            active={screenFocused && effectiveTab === 'app'}
            enabled={canAccessCityTabs}
            onNewestContent={handleNewestContent}
            {...feedListProps}
          />
        </View>
      </Pager>

      {appHeader}

      {/* Status-bar strip painted on top of everything: glass instead of a
          solid fill, so mid-scroll the feed body visibly slides beneath the
          clock while staying legible. */}
      <View pointerEvents="none" style={[styles.topSafeBand, { height: insets.top }]}>
        <GlassSurface />
      </View>

      {walletAddress && (
        <FeedFAB onPress={handleCompose} visibilityScale={fabVisibilityScale} />
      )}

      <PostOptionsDrawer
        visible={optionsDrawerVisible}
        onClose={() => setOptionsDrawerVisible(false)}
        postId={selectedPost?.id}
        isOwner={isOwnPost(selectedPost)}
        canPin={isOwnPost(selectedPost) && isCitizen}
        isPinned={isPostPinned(selectedPost?.pinned_until)}
        onTogglePin={handleTogglePin}
        onEdit={handleEditPost}
        onDelete={handleDeletePost}
        onReport={handleOpenReport}
      />

      <ReportDrawer
        visible={reportDrawerVisible}
        onClose={() => setReportDrawerVisible(false)}
        onReport={handleSubmitReport}
      />

      <RepostDrawer
        visible={!!repostTarget}
        onClose={() => setRepostTarget(null)}
        isReposted={repostTarget?.reposted ?? false}
        onRepost={handleConfirmRepost}
        onQuote={handleQuote}
      />

      <ConfirmationDrawer
        visible={deleteConfirmVisible}
        title="Beitrag löschen?"
        message="Dieser Beitrag wird dauerhaft entfernt."
        variant="destructive"
        confirmText="Löschen"
        cancelText="Abbrechen"
        onConfirm={confirmDeletePost}
        onCancel={() => setDeleteConfirmVisible(false)}
      />

      {selectedPost && (
        <PostComposer
          visible={editComposerVisible}
          onClose={() => setEditComposerVisible(false)}
          onPostCreated={() => {}}
          feedType={effectiveTab}
          walletAddress={walletAddress || ''}
          isCitizen={isCitizen}
          user={user}
          editingPost={selectedPost}
          onPostUpdated={handlePostUpdated}
        />
      )}

      <Animated.View
        style={[styles.bottomFloating, bottomNavAnimatedStyle]}
      >
        <GlassSurface />
        {/* BottomNavigation now owns its own safe-area bottom padding
            (Task 7) — no extra paddingBottom here, or the home-indicator
            inset would be applied twice and the glass overlay would grow
            taller than the scroll content's reserved bottomPadding below. */}
        <BottomNavigation activeTab={navTab} onTabPress={handleNavTabPress} transparent />
      </Animated.View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  headerWrapper: {
    zIndex: 1,
  },
  headerFloating: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
  },
  bottomFloating: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 10,
  },
  topSafeBand: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 20,
  },
  bottomSafeBand: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 9,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  headerWordmark: {
    width: 84,
    height: 36,
  },
  headerActions: {
    flexDirection: 'row',
    gap: 8,
  },
  headerIconBtn: {
    width: 36,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
  },
  pager: {
    flex: 1,
  },
  page: {
    flex: 1,
  },
  dot: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: '#DC2626',
  },
});
