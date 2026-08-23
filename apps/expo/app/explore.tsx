import React, { useState, useCallback, useMemo, useRef } from 'react';
import { View, StyleSheet, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import Animated, { useAnimatedScrollHandler, useSharedValue } from 'react-native-reanimated';
import { useQuery } from '@tanstack/react-query';
import { useTheme } from '@/context/ThemeContext';
import { supabase } from '@/lib/supabase';
import { fetchActiveDeals } from '@/lib/supabase-deals';
import { fetchMarketplaceListings } from '@/lib/supabase-marketplace';
import { isEventTodayOrFuture, isEventInRoebel } from '@/lib/utils';
import type {
  EventRecord,
  NewsArticle,
  MovieRecord,
  RestaurantRecord,
} from '@/lib/types';

import BottomNavigation, { BOTTOM_NAV_HEIGHT } from '@/components/BottomNavigation';
import ExploreSearchBar from '@/components/ExploreSearchBar';
import ExploreCategoryChips from '@/components/ExploreCategoryChips';
import DeckCardSwiper from '@/components/DeckCardSwiper';
import ThisWeekEventsHorizontal from '@/components/ThisWeekEventsHorizontal';
import AllEventsHorizontal from '@/components/AllEventsHorizontal';
import NewsSection from '@/components/NewsSection';
import RestaurantSection from '@/components/RestaurantSection';
import MovieSection from '@/components/MovieSection';
import MarketplaceSection from '@/components/MarketplaceSection';
import NearbyEventsSection from '@/components/NearbyEventsSection';
import NearbyOrgAccountsSection from '@/components/NearbyOrgAccountsSection';
import MapFAB from '@/components/MapFAB';
import MiniAppsEntry from '@/components/miniapp/MiniAppsEntry';
import SearchModal from '@/components/SearchModal';
import { Skeleton, HeroCardSkeleton } from '@/components/SkeletonLoader';

const EVENT_CARD_COLUMNS =
  'id, title, date, time, location, formatted_address, address_components, image_url, is_popular, is_cancelled, organizer_name';

// Stable (module-level) empty-array fallbacks: `data ?? []` would mint a new
// array identity every render, which defeats the useMemo below.
const EMPTY_EVENTS: EventRecord[] = [];

async function fetchExploreEvents() {
  const { data } = await supabase
    .from('events')
    .select(EVENT_CARD_COLUMNS)
    .eq('status', 'approved')
    .gte('date', new Date().toISOString().split('T')[0]) // LIMIT: only today+future
    .order('date', { ascending: true })
    .order('time', { ascending: true, nullsFirst: true })
    .limit(60); // LIMIT
  return (data ?? []) as EventRecord[];
}

async function fetchExplorePopularEvents() {
  const { data } = await supabase
    .from('events')
    .select(EVENT_CARD_COLUMNS)
    .eq('status', 'approved')
    .eq('is_popular', true)
    .order('date', { ascending: true })
    .order('time', { ascending: true, nullsFirst: true })
    .limit(3);
  return (data ?? []) as EventRecord[];
}

async function fetchExploreNews() {
  const { data } = await supabase
    .from('news_articles')
    .select('id, slug, title, cover_image_url, author_name, published_at, created_at, excerpt, status')
    .eq('status', 'published')
    .order('published_at', { ascending: false })
    .limit(20); // LIMIT
  return (data ?? []) as NewsArticle[];
}

async function fetchExploreMovies() {
  const { data } = await supabase
    .from('movies')
    .select('id, title, date, cover_image_url, fsk, status')
    .eq('status', 'published')
    .order('date', { ascending: true });
  return (data ?? []) as MovieRecord[];
}

async function fetchExploreRestaurants() {
  const { data } = await supabase
    .from('restaurants')
    // NOTE: no opening_hours here — that column does not exist on the
    // restaurants table (GastroCard tolerates it being undefined). A
    // nonexistent column 42703-fails the whole select and hides the section.
    .select('id, slug, name, cover_image_url, logo_url, background_color, account_id')
    .eq('status', 'published')
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })
    .limit(50); // LIMIT
  return (data ?? []) as RestaurantRecord[];
}

// Section skeleton: title bar + horizontal row of card-shaped placeholders,
// mirroring the horizontal-rail layout every explore section uses.
function SectionRailSkeleton({ titleWidth = '40%' }: { titleWidth?: string | number }) {
  return (
    <View style={styles.skeletonSection}>
      <Skeleton width={titleWidth} height={24} borderRadius={6} style={{ marginBottom: 12, marginHorizontal: 16 }} />
      <View style={styles.skeletonRow}>
        <Skeleton width={240} height={140} borderRadius={12} style={{ marginLeft: 16 }} />
        <Skeleton width={240} height={140} borderRadius={12} style={{ marginLeft: 12 }} />
      </View>
    </View>
  );
}

export default function ExploreScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const [activeTab, setActiveTab] = useState<'home' | 'explore' | 'profile'>('explore');

  const [refreshing, setRefreshing] = useState(false);
  const [showSearchModal, setShowSearchModal] = useState(false);
  // FAB show/hide-on-scroll runs entirely on the UI thread (Reanimated) so a
  // direction flip never triggers a JS re-render of this screen. MapFAB owns
  // the actual translateY/opacity tween (via useAnimatedStyle) off this
  // shared value — this only tracks scroll position + the visible/hidden bit.
  const lastScrollY = useSharedValue(0);
  const fabVisible = useSharedValue(true);
  // When the user taps a result/tile inside the search modal we close the modal
  // and navigate, but flag it to reopen once Explore regains focus — so pressing
  // back from the subpage returns to the search page, not the bare feed.
  const reopenSearch = useRef(false);

  useFocusEffect(
    useCallback(() => {
      if (reopenSearch.current) {
        reopenSearch.current = false;
        setShowSearchModal(true);
      }
    }, [])
  );

  const eventsQuery = useQuery({
    queryKey: ['explore', 'events'],
    queryFn: fetchExploreEvents,
    meta: { persist: true },
  });
  const popularQuery = useQuery({
    queryKey: ['explore', 'popular-events'],
    queryFn: fetchExplorePopularEvents,
    meta: { persist: true },
  });
  const newsQuery = useQuery({
    queryKey: ['explore', 'news'],
    queryFn: fetchExploreNews,
    meta: { persist: true },
  });
  const moviesQuery = useQuery({
    queryKey: ['explore', 'movies'],
    queryFn: fetchExploreMovies,
    meta: { persist: true },
  });
  const restaurantsQuery = useQuery({
    queryKey: ['explore', 'restaurants'],
    queryFn: fetchExploreRestaurants,
    meta: { persist: true },
  });
  const dealsQuery = useQuery({
    queryKey: ['explore', 'deals'],
    queryFn: () => fetchActiveDeals(),
    meta: { persist: true },
  });
  const listingsQuery = useQuery({
    queryKey: ['explore', 'listings'],
    queryFn: () => fetchMarketplaceListings({ limit: 10 }),
    meta: { persist: true },
  });

  const events = eventsQuery.data ?? EMPTY_EVENTS;
  const popularEvents = popularQuery.data ?? EMPTY_EVENTS;
  const newsArticles = newsQuery.data ?? [];
  const movies = moviesQuery.data ?? [];
  const restaurants = restaurantsQuery.data ?? [];
  const deals = dealsQuery.data ?? [];
  const listings = listingsQuery.data ?? [];

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([
      eventsQuery.refetch(),
      popularQuery.refetch(),
      newsQuery.refetch(),
      moviesQuery.refetch(),
      restaurantsQuery.refetch(),
      dealsQuery.refetch(),
      listingsQuery.refetch(),
    ]);
    setRefreshing(false);
  };

  const handleTabPress = (tab: 'home' | 'explore' | 'profile') => {
    setActiveTab(tab);
    if (tab === 'home') {
      router.replace('/');
    } else if (tab === 'profile') {
      router.push('/profile');
    }
  };

  // Same thresholds/direction logic as the old JS-thread handler
  // (scroll down 10px -> hide, scroll up 10px -> show), just running as a
  // worklet on the UI thread instead of via setState on every frame. The
  // translateY/opacity tween itself lives in MapFAB's useAnimatedStyle.
  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (event) => {
      const currentY = event.contentOffset.y;
      if (currentY > lastScrollY.value + 10) {
        fabVisible.value = false;
      } else if (currentY < lastScrollY.value - 10) {
        fabVisible.value = true;
      }
      lastScrollY.value = currentY;
    },
  });

  // Filter events for sections. `events`/`popularEvents` are referentially
  // stable across renders (EMPTY_EVENTS fallback, unchanged query data), so
  // these only recompute when the underlying query data actually changes.
  const futurePopularEvents = useMemo(
    () => popularEvents.filter((e) => isEventTodayOrFuture(e.date)),
    [popularEvents]
  );
  const futureEvents = useMemo(
    () => events.filter((e) => isEventTodayOrFuture(e.date)),
    [events]
  );
  const nearbyEvents = useMemo(
    () =>
      futureEvents.filter(
        (e) => !isEventInRoebel(e.location, e.formatted_address, e.address_components) && !e.is_popular
      ),
    [futureEvents]
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <Animated.ScrollView
        // flex:1 is load-bearing on web: react-native-web sizes an unstyled
        // ScrollView to its content, so `overflow-y: auto` never has anything
        // to scroll and the page (body has overflow:hidden) just clips it.
        // Native bounds it regardless, which is why this only broke the PWA.
        style={styles.scrollView}
        showsVerticalScrollIndicator={false}
        onScroll={scrollHandler}
        scrollEventThrottle={16}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
        }
      >
        {/* Search bar */}
        <ExploreSearchBar onPress={() => setShowSearchModal(true)} />

        {/* Category tiles */}
        <ExploreCategoryChips />

        {/* Hero Swiper */}
        {popularQuery.isPending ? (
          <HeroCardSkeleton />
        ) : (
          <DeckCardSwiper
            events={futurePopularEvents}
            showPagination
            loop
            containerStyle={{ paddingTop: 40, paddingBottom: 16, marginBottom: 0 }}
          />
        )}

        {/* This Week Events - Horizontal */}
        {eventsQuery.isPending ? (
          <SectionRailSkeleton titleWidth="35%" />
        ) : (
          <ThisWeekEventsHorizontal events={futureEvents} />
        )}

        {/* Movies */}
        {moviesQuery.isPending ? (
          <SectionRailSkeleton titleWidth="25%" />
        ) : (
          <MovieSection movies={movies} />
        )}

        {/* Mini Apps store entry */}
        <MiniAppsEntry />

        {/* Marketplace (listings + promotional deals in one rail) */}
        {listingsQuery.isPending || dealsQuery.isPending ? (
          <SectionRailSkeleton titleWidth="35%" />
        ) : (
          <MarketplaceSection listings={listings} deals={deals} />
        )}

        {/* News */}
        {newsQuery.isPending ? (
          <SectionRailSkeleton titleWidth="40%" />
        ) : (
          <NewsSection articles={newsArticles} />
        )}

        {/* Restaurants */}
        {restaurantsQuery.isPending ? (
          <SectionRailSkeleton titleWidth="40%" />
        ) : (
          <RestaurantSection restaurants={restaurants} />
        )}

        {/* Nearby Events */}
        {eventsQuery.isPending ? (
          <SectionRailSkeleton titleWidth="30%" />
        ) : (
          <NearbyEventsSection events={nearbyEvents} />
        )}

        {/* Nearby Org Accounts (Unternehmen) */}
        <NearbyOrgAccountsSection />

        {/* All Events - Horizontal */}
        {eventsQuery.isPending ? (
          <SectionRailSkeleton titleWidth="50%" />
        ) : (
          <AllEventsHorizontal events={futureEvents} />
        )}

        {/* Bottom padding for BottomNavigation */}
        <View style={{ height: BOTTOM_NAV_HEIGHT + 10 }} />
      </Animated.ScrollView>

      {/* Search Modal */}
      <SearchModal
        visible={showSearchModal}
        onClose={() => setShowSearchModal(false)}
        onNavigate={() => {
          reopenSearch.current = true;
          setShowSearchModal(false);
        }}
      />

      {/* Map FAB */}
      <MapFAB visible={fabVisible} />

      {/* Bottom Navigation */}
      <BottomNavigation activeTab={activeTab} onTabPress={handleTabPress} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  skeletonSection: {
    marginBottom: 32,
  },
  skeletonRow: {
    flexDirection: 'row',
  },
});
