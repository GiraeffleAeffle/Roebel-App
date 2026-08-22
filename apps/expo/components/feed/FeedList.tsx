import React, { forwardRef, useCallback, useImperativeHandle, useRef, useState } from 'react';
import {
  View,
  FlatList,
  StyleSheet,
  RefreshControl,
  ViewToken,
} from 'react-native';
import Animated, {
  useAnimatedScrollHandler,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { useTheme } from '@/context/ThemeContext';
import { useFeed } from '@/hooks/useFeed';
import { usePostActions } from '@/hooks/usePostActions';
import { getUserLikedPostIds, getUserRepostedPostIds } from '@/lib/supabase-posts';
import { trackPostViews, setViewTrackerWallet } from '@/lib/viewTracker';
import type {
  FeedItem,
  FeedType,
  PostRecord,
  BusinessDealWithBusiness,
  GovernanceNudgeData,
  MeckyTipData,
  AudioPlayerData,
} from '@/lib/types/feed';
import type {
  EventRecord,
  MarketplaceListingRecord,
  NewsArticle,
  MovieRecord,
  RestaurantRecord,
  SpecialMenuRecord,
} from '@/lib/types';
import FeedPostCard from './FeedPostCard';
import FeedAlertCard from './FeedAlertCard';
import FeedMeckyCard from './FeedMeckyCard';
import FeedExperienceCard from './FeedExperienceCard';
import FeedSponsoredCard from './FeedSponsoredCard';
import FeedMarketplaceCard from './FeedMarketplaceCard';
import FeedEventCard from './FeedEventCard';
import FeedNewsSection from './FeedNewsSection';
import FeedCinemaSection from './FeedCinemaSection';
import FeedRestaurantSection from './FeedRestaurantSection';
import FeedSpecialMenuSection from './FeedSpecialMenuSection';
import FeedPostSkeleton from './FeedPostSkeleton';
import FeedEmptyState from './FeedEmptyState';
import GovernanceNudge from './GovernanceNudge';
import MeckyTip from './MeckyTip';
import FeedAudioPlayerCard from './FeedAudioPlayerCard';
import FeedProposalCard from './FeedProposalCard';
import FeedProposalCommentCard from './FeedProposalCommentCard';
import FeedProposalHeroCard from './FeedProposalHeroCard';

export type FeedListHandle = {
  refresh: () => void;
  removePost: (postId: string) => void;
};

type Props = {
  feedType: FeedType;
  isCitizen: boolean;
  walletAddress?: string;
  onCompose: () => void;
  onMore: (post: PostRecord) => void;
  /**
   * Opens the repost drawer for the given TARGET post (original for repost
   * rows), with the viewer's current reposted-state for that target.
   */
  onRepost?: (target: PostRecord, isReposted: boolean) => void;
  listHeader?: React.ReactNode;
  /** Shared value tracking the floating header translateY. Updated on scroll. */
  headerTranslateY?: SharedValue<number>;
  /** Total height of the floating header — used as the upper clamp for the translate. */
  headerHeight?: number;
  /** Additional top inset (e.g. status bar) added to the header padding. */
  topPadding?: number;
  /** Additional bottom inset (e.g. bottom nav) added to the footer padding. */
  bottomPadding?: number;
  /**
   * Whether this list is the on-screen feed tab AND the home screen is
   * focused. When false, videos are paused even if scroll-visible — prevents
   * off-tab / background audio from bleeding through. Defaults to true.
   */
  active?: boolean;
  /**
   * Gates the initial fetch. The list queries Supabase once, the first time
   * this is true. Used to keep rathaus/app tabs from fetching for non-citizens
   * who can never reach them. Defaults to true.
   */
  enabled?: boolean;
  /**
   * Reports the newest item `created_at` (ISO) whenever the feed's items change.
   * Used to drive the "new content" dot on inactive tabs. `null` when empty.
   */
  onNewestContent?: (feedType: FeedType, newestIso: string | null) => void;
  /**
   * When true, pins the animated proposal hero ("Bürgerumfrage") at the very top
   * of the feed, above all posts. The card self-gates (renders nothing when no
   * eligible proposal).
   */
  showProposalHero?: boolean;
};

const PROPOSAL_HERO_ID = '__proposal_hero';

const FeedList = forwardRef<FeedListHandle, Props>(function FeedList(
  {
    feedType,
    isCitizen,
    walletAddress,
    onCompose,
    onMore,
    onRepost,
    listHeader,
    headerTranslateY,
    headerHeight = 0,
    topPadding = 0,
    bottomPadding = 0,
    active = true,
    enabled = true,
    onNewestContent,
    showProposalHero = false,
  },
  ref,
) {
  const { colors } = useTheme();

  const { items, isLoading, isRefreshing, isLoadingMore, hasMore, refresh, loadMore, removePost, likedPostIds, repostedPostIds } =
    useFeed(feedType, enabled);

  // Surface the newest content timestamp so FeedHome can flag unseen content
  // on inactive tabs. Section cards (news/cinema/…) carry no created_at and are
  // ignored.
  React.useEffect(() => {
    if (!onNewestContent) return;
    let newest: number | null = null;
    for (const item of items) {
      const ts = (item.data as { created_at?: string })?.created_at;
      if (!ts) continue;
      const ms = new Date(ts).getTime();
      if (!Number.isNaN(ms) && (newest === null || ms > newest)) newest = ms;
    }
    onNewestContent(feedType, newest === null ? null : new Date(newest).toISOString());
  }, [items, feedType, onNewestContent]);

  const { isLiked, getLikeCount, toggleLike, sharePost, initLikes, initReposts, isReposted, getRepostCount } =
    usePostActions(walletAddress);

  useImperativeHandle(ref, () => ({ refresh, removePost }), [refresh, removePost]);

  const visibleDeals = useRef(new Set<string>());
  const [visibleVideoIds, setVisibleVideoIds] = useState<Set<string>>(new Set());

  React.useEffect(() => {
    setViewTrackerWallet(walletAddress);
  }, [walletAddress]);

  React.useEffect(() => {
    if (!walletAddress || items.length === 0) return;

    // Like/repost state binds to the TARGET post: the original on repost rows.
    const targets = items
      .filter((item) => item.type === 'post' || item.type === 'mecky')
      .map((item) => {
        const post = item.data as PostRecord;
        return post.post_type === 'repost' && post.quoted_post ? post.quoted_post : post;
      });

    if (targets.length === 0) return;

    const postIds = targets.map((t) => t.id);
    const counts: Record<string, number> = {};
    const repostCounts: Record<string, number> = {};
    targets.forEach((t) => {
      counts[t.id] = t.likes_count;
      repostCounts[t.id] = t.reposts_count ?? 0;
    });

    if (likedPostIds) {
      initLikes(likedPostIds, counts);
    } else {
      getUserLikedPostIds(postIds, walletAddress).then((likedIds) => {
        initLikes(likedIds, counts);
      });
    }
    if (repostedPostIds) {
      initReposts(repostedPostIds, repostCounts);
    } else {
      getUserRepostedPostIds(postIds, walletAddress).then((ids) => {
        initReposts(ids, repostCounts);
      });
    }
  }, [items, walletAddress, likedPostIds, repostedPostIds]);

  const onViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      const nextVideoIds = new Set<string>();
      const impressionIds: string[] = [];
      viewableItems.forEach((item) => {
        if (item.item?.type === 'sponsored') {
          const dealId = item.item.data?.id;
          if (dealId && !visibleDeals.current.has(dealId)) {
            visibleDeals.current.add(dealId);
          }
        }
        if (item.item?.type === 'post' || item.item?.type === 'mecky') {
          const post = item.item.data as PostRecord;
          if (post?.video_url) {
            nextVideoIds.add(post.id);
          }
          // Impressions count the ORIGINAL on repost rows.
          const target = post?.post_type === 'repost' && post.quoted_post ? post.quoted_post : post;
          if (target?.id) impressionIds.push(target.id);
        }
      });
      if (impressionIds.length > 0) trackPostViews(impressionIds);
      setVisibleVideoIds((prev) => {
        if (prev.size === nextVideoIds.size) {
          let same = true;
          prev.forEach((id) => {
            if (!nextVideoIds.has(id)) same = false;
          });
          if (same) return prev;
        }
        return nextVideoIds;
      });
    },
    [],
  );

  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: 70,
    minimumViewTime: 200,
  });

  const renderItem = useCallback(
    ({ item }: { item: FeedItem }) => {
      switch (item.type) {
        case 'alert':
          return (
            <View style={styles.moduleWrap}>
              <FeedAlertCard alert={item.data} />
            </View>
          );

        case 'post': {
          const post = item.data as PostRecord;
          if (post.post_type === 'event_experience') {
            return (
              <View style={styles.moduleWrap}>
                <FeedExperienceCard
                  post={post}
                  isLiked={isLiked(post.id)}
                  displayLikeCount={getLikeCount(post.id, post.likes_count)}
                  onLike={() => toggleLike(post.id, post.likes_count)}
                  onShare={() => sharePost(post.id, post.content)}
                  onMore={() => onMore(post)}
                />
              </View>
            );
          }
          const target = post.post_type === 'repost' && post.quoted_post ? post.quoted_post : post;
          return (
            <FeedPostCard
              post={post}
              isLiked={isLiked(target.id)}
              displayLikeCount={getLikeCount(target.id, target.likes_count)}
              walletAddress={walletAddress}
              isVisible={active && visibleVideoIds.has(post.id)}
              onLike={() => toggleLike(target.id, target.likes_count)}
              onShare={() => sharePost(target.id, target.content)}
              onMore={() => onMore(post)}
              isReposted={isReposted(target.id)}
              displayRepostCount={getRepostCount(target.id, target.reposts_count ?? 0)}
              onRepost={onRepost ? (t) => onRepost(t, isReposted(t.id)) : undefined}
            />
          );
        }

        case 'mecky': {
          const post = item.data as PostRecord;
          return (
            <FeedMeckyCard
              post={post}
              isLiked={isLiked(post.id)}
              displayLikeCount={getLikeCount(post.id, post.likes_count)}
              walletAddress={walletAddress}
              isVisible={active && visibleVideoIds.has(post.id)}
              onLike={() => toggleLike(post.id, post.likes_count)}
              onShare={() => sharePost(post.id, post.content)}
              onMore={() => onMore(post)}
            />
          );
        }

        case 'sponsored':
          return (
            <View style={styles.moduleWrap}>
              <FeedSponsoredCard
                deal={item.data as BusinessDealWithBusiness}
                isVisible={visibleDeals.current.has((item.data as BusinessDealWithBusiness).id)}
              />
            </View>
          );

        case 'marketplace':
          return (
            <View style={styles.moduleWrap}>
              <FeedMarketplaceCard listing={item.data as MarketplaceListingRecord} />
            </View>
          );

        case 'event':
          return (
            <View style={styles.moduleWrap}>
              <FeedEventCard event={item.data as EventRecord} />
            </View>
          );

        case 'news_section':
          return (
            <View style={styles.moduleWrap}>
              <FeedNewsSection articles={item.data as NewsArticle[]} />
            </View>
          );

        case 'cinema_section':
          return (
            <View style={styles.moduleWrap}>
              <FeedCinemaSection movies={item.data as MovieRecord[]} />
            </View>
          );

        case 'restaurant_section':
          return (
            <View style={styles.moduleWrap}>
              <FeedRestaurantSection restaurants={item.data as RestaurantRecord[]} />
            </View>
          );

        case 'special_menu_section':
          return (
            <View style={styles.moduleWrap}>
              <FeedSpecialMenuSection menus={item.data as SpecialMenuRecord[]} />
            </View>
          );

        case 'governance_nudge': {
          const nudge = item.data as GovernanceNudgeData;
          return (
            <View style={styles.moduleWrap}>
              <GovernanceNudge
                proposalId={nudge.proposalId}
                title={nudge.title}
                forPercentage={nudge.forPercentage}
                againstPercentage={nudge.againstPercentage}
                daysRemaining={nudge.daysRemaining}
              />
            </View>
          );
        }

        case 'mecky_tip': {
          const tip = item.data as MeckyTipData;
          return (
            <View style={styles.moduleWrap}>
              <MeckyTip text={tip.text} actionLabel={tip.actionLabel} actionRoute={tip.actionRoute} />
            </View>
          );
        }

        case 'audio_player':
          return (
            <View style={styles.moduleWrap}>
              <FeedAudioPlayerCard data={item.data as AudioPlayerData} />
            </View>
          );

        case 'proposal':
          return (
            <View style={styles.moduleWrap}>
              <FeedProposalCard proposal={item.data} />
            </View>
          );

        case 'proposal_comment':
          return (
            <View style={styles.moduleWrap}>
              <FeedProposalCommentCard comment={item.data} />
            </View>
          );

        case 'proposal_hero':
          return (
            <View style={styles.moduleWrap}>
              <FeedProposalHeroCard />
            </View>
          );

        default:
          return null;
      }
    },
    [walletAddress, isLiked, getLikeCount, toggleLike, sharePost, onMore, onRepost, isReposted, getRepostCount, visibleVideoIds, active],
  );

  const keyExtractor = useCallback((item: FeedItem) => item.id, []);

  // The animated proposal hero ("Bürgerumfrage") is pinned at the very top of
  // the feed, above all posts — new arrivals stack below it. The card
  // self-gates, so the injected sentinel renders nothing when there's no
  // eligible proposal.
  const displayData = React.useMemo(() => {
    // Repost rows whose original was deleted (quoted_post hydrated to null)
    // render nothing — drop them so they don't leave empty separator gaps.
    const visible = items.filter(
      (it) =>
        !(
          (it.type === 'post' || it.type === 'mecky') &&
          (it.data as PostRecord).post_type === 'repost' &&
          !(it.data as PostRecord).quoted_post
        ),
    );
    if (!showProposalHero) return visible;
    const hero: FeedItem = { type: 'proposal_hero', id: PROPOSAL_HERO_ID };
    return [hero, ...visible];
  }, [items, showProposalHero]);

  // X-style parallax chrome: the header physically tracks the scroll instead
  // of flipping between shown/hidden. Collapsing runs at PARALLAX_RATE (< 1)
  // so the feed body visibly overtakes and slides above the retreating
  // header; revealing runs at full finger speed so chrome comes back
  // instantly on scroll-up. When the gesture ends mid-way the header snaps
  // to the nearest edge so it never parks half-visible.
  const PARALLAX_RATE = 0.55;
  const prevScrollY = useSharedValue(0);
  // Guards the reset-at-top timing so bounce frames don't restart it.
  const resettingAtTop = useSharedValue(false);

  const snapToNearestEdge = () => {
    'worklet';
    if (!headerTranslateY || headerHeight <= 0) return;
    const v = headerTranslateY.value;
    if (v > -headerHeight && v < 0) {
      headerTranslateY.value = withTiming(v < -headerHeight / 2 ? -headerHeight : 0, {
        duration: 180,
      });
    }
  };

  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (e) => {
      if (!headerTranslateY || headerHeight <= 0) return;
      const y = e.contentOffset.y;
      const dy = y - prevScrollY.value;
      prevScrollY.value = y;

      if (y <= 0) {
        // At the top / overscroll: chrome always fully visible.
        if (headerTranslateY.value !== 0 && !resettingAtTop.value) {
          resettingAtTop.value = true;
          headerTranslateY.value = withTiming(0, { duration: 160 });
        }
        return;
      }
      resettingAtTop.value = false;

      if (dy > 0) {
        // Never collapse further than the content above the fold allows —
        // prevents the header vanishing on a tiny first scroll.
        const limit = Math.min(headerHeight, y);
        headerTranslateY.value = Math.max(
          -limit,
          headerTranslateY.value - dy * PARALLAX_RATE,
        );
      } else if (dy < 0) {
        headerTranslateY.value = Math.min(0, headerTranslateY.value - dy);
      }
    },
    onEndDrag: () => {
      snapToNearestEdge();
    },
    onMomentumEnd: () => {
      snapToNearestEdge();
    },
  });

  return (
    <Animated.FlatList
      data={displayData}
      keyExtractor={keyExtractor}
      renderItem={renderItem}
      ListHeaderComponent={listHeader ? <>{listHeader}</> : undefined}
      ItemSeparatorComponent={() => (
        <View style={[styles.separator, { backgroundColor: colors.border }]} />
      )}
      style={{ backgroundColor: colors.background }}
      refreshControl={
        <RefreshControl
          refreshing={isRefreshing}
          onRefresh={refresh}
          tintColor={colors.primary}
          progressViewOffset={topPadding}
        />
      }
      onScroll={scrollHandler}
      scrollEventThrottle={16}
      onEndReached={hasMore ? loadMore : undefined}
      onEndReachedThreshold={0.3}
      onViewableItemsChanged={onViewableItemsChanged}
      viewabilityConfig={viewabilityConfig.current}
      scrollIndicatorInsets={{ top: topPadding, bottom: bottomPadding }}
      ListEmptyComponent={
        isLoading ? (
          <View style={styles.skeletonList}>
            {[1, 2, 3, 4].map((i) => (
              <FeedPostSkeleton key={i} />
            ))}
          </View>
        ) : (
          <FeedEmptyState feedType={feedType} isCitizen={isCitizen} onCompose={onCompose} />
        )
      }
      ListFooterComponent={
        isLoadingMore ? (
          <View style={styles.footerLoader}>
            <FeedPostSkeleton />
          </View>
        ) : (
          <View style={{ height: bottomPadding + 40 }} />
        )
      }
      contentContainerStyle={[
        styles.feedContent,
        { paddingTop: topPadding + 8 },
        items.length === 0 && [styles.emptyContainer, { paddingTop: topPadding }],
      ]}
    />
  );
});

export default FeedList;

const styles = StyleSheet.create({
  feedContent: {
    paddingTop: 8,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    width: '100%',
  },
  // Non-post modules (news, deals, proposals, …) keep their rounded widget
  // look inside the otherwise edge-to-edge X-style list.
  moduleWrap: {
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  skeletonList: {
    flex: 1,
  },
  emptyContainer: {
    flex: 1,
  },
  footerLoader: {
    paddingTop: 4,
  },
  bottomPadding: {
    height: 100,
  },
});
