import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SearchIcon, CalendarIcon } from '@/components/Icons';
import { supabase } from '@/lib/supabase';
import { EventRecord, Filters, NewsArticle, MovieRecord, RestaurantRecord } from '@/lib/types';
import EventCard from '@/components/EventCard';
import SwipeableCardStack from '@/components/SwipeableCardStack';
import ThisWeekEvents from '@/components/ThisWeekEvents';
import NewsSection from '@/components/NewsSection';
import MovieSection from '@/components/MovieSection';
import RestaurantSection from '@/components/RestaurantSection';
import SearchModal from '@/components/SearchModal';
import CalendarModal from '@/components/CalendarModal';
import BottomNavigation from '@/components/BottomNavigation';
import { Skeleton, EventCardSkeleton, HeroCardSkeleton } from '@/components/SkeletonLoader';
import { useRouter, Redirect } from 'expo-router';
import { isEventThisWeek, isEventTodayOrFuture, isEventInRoebel } from '@/lib/utils';
import HomeCategoryChips from '@/components/HomeCategoryChips';
import NearbyEventsSection from '@/components/NearbyEventsSection';
import { EventCategory } from '@/lib/categories';
import NotificationPromptDrawer from '@/components/NotificationPromptDrawer';
import { useNotificationsContext } from '@/context/NotificationsContext';
import { useTheme } from '@/context/ThemeContext';
import { useUser } from '@/context/UserContext';
import FeedHome from '@/components/feed/FeedHome';
import { useLivestream } from '@/hooks/useLivestream';
import { useAnnouncements } from '@/hooks/useAnnouncements';
import LivestreamBanner from '@/components/LivestreamBanner';
import AnnouncementModal from '@/components/AnnouncementModal';
import NotificationSheet from '@/components/onboarding/NotificationSheet';
import { isNotificationPromptPending, clearNotificationPromptPending } from '@/lib/onboarding-storage';
import { isNotificationPromptDue, markNotificationPromptDismissed } from '@/lib/notification-prompt';
import { useConsent } from '@/context/ConsentContext';
import { useDebouncedValue as useDebounced } from '@/hooks/useDebouncedValue';
import { bootState } from '@/lib/navigation/bootPathname';

// True once this screen has rendered at least once in the current JS process.
// Module scope (not a ref) so the flag survives this component unmounting and
// remounting as the user tabs away and back — it should only ever gate the
// very first mount of this file, not every mount.
let hasHomeScreenRenderedBefore = false;

export default function HomeScreen() {
  // The app opens on "Erkunden" (/explore) instead of the feed (see
  // app/_layout.tsx's `ThemedLayout`, which captures the cold-boot pathname
  // into `bootState` during its own render — always before this component's
  // first render in the same initial commit). Redirect to /explore only when
  // BOTH are true: this is this screen's first-ever mount in the process, AND
  // that first mount is happening because the app actually cold-booted into
  // `/` (default landing with no deep link, or a deep link explicitly
  // targeting `/` — today's behavior stomps that case too, so this replicates
  // it exactly). A cold boot that deep-linked elsewhere leaves `bootState`
  // pointing at that other path, so the first later in-session visit to `/`
  // renders the feed normally, same as every visit after that.
  const isColdStartLandingOnRoot =
    !hasHomeScreenRenderedBefore && bootState.pathname === '/';
  hasHomeScreenRenderedBefore = true;

  // Feed is the home screen for ALL modes (spec section 2)
  // Content adapts per mode via the feed algorithm
  const [showNotificationSheet, setShowNotificationSheet] = useState(false);
  const promptedThisSession = useRef(false);

  const { permissionStatus, isLoading: notificationsLoading } = useNotificationsContext();
  const {
    preferences: consentPrefs,
    ready: consentReady,
    needsConsent,
    needsReconsent,
  } = useConsent();

  // Push counts as activated only when the OS permission AND the consent
  // category are both granted — otherwise no token is registered and the
  // device receives nothing.
  const pushActive = permissionStatus === 'granted' && consentPrefs.push;

  useEffect(() => {
    // This render redirects away instead of showing the feed — nothing to
    // schedule (this instance unmounts as soon as the redirect takes hold).
    if (isColdStartLandingOnRoot) return;
    // Wait until permission + consent state are known, and never fight the
    // full-screen consent modal or the re-consent sheet for attention.
    if (promptedThisSession.current) return;
    if (notificationsLoading || !consentReady || needsConsent || needsReconsent) return;
    if (pushActive) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    (async () => {
      const pending = await isNotificationPromptPending();
      const due = pending || (await isNotificationPromptDue());
      if (cancelled || !due || promptedThisSession.current) return;
      promptedThisSession.current = true;
      if (pending) {
        setShowNotificationSheet(true);
      } else {
        // Re-engagement path: give the feed a moment to render first.
        timer = setTimeout(() => setShowNotificationSheet(true), 1500);
      }
    })();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [isColdStartLandingOnRoot, notificationsLoading, consentReady, needsConsent, needsReconsent, pushActive]);

  const handleNotificationDismiss = async () => {
    setShowNotificationSheet(false);
    await Promise.all([clearNotificationPromptPending(), markNotificationPromptDismissed()]);
  };

  if (isColdStartLandingOnRoot) {
    return <Redirect href="/explore" />;
  }

  return (
    <>
      <FeedHome />
      <NotificationSheet visible={showNotificationSheet} onDismiss={handleNotificationDismiss} />
    </>
  );
}

function DefaultHome() {
  const router = useRouter();
  const { colors } = useTheme();
  const [filters, setFilters] = useState<Filters>({
    query: '',
    category: '', // No default category selection
    freeOnly: false,
    startDate: null,
    endDate: null,
  });
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [popularEvents, setPopularEvents] = useState<EventRecord[]>([]);
  const [newsArticles, setNewsArticles] = useState<NewsArticle[]>([]);
  const [movies, setMovies] = useState<MovieRecord[]>([]);
  const [restaurants, setRestaurants] = useState<RestaurantRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [eventsListLoading, setEventsListLoading] = useState(false);
  const [showSearchModal, setShowSearchModal] = useState(false);
  const [showCalendarModal, setShowCalendarModal] = useState(false);
  const [activeTab, setActiveTab] = useState<'home' | 'explore' | 'profile'>('home');
  const [showNotificationPrompt, setShowNotificationPrompt] = useState(false);
  const [showAnnouncementModal, setShowAnnouncementModal] = useState(false);
  const announcementShownRef = useRef(false);
  const { primaryLiveEvent } = useLivestream();
  const { announcement, dismiss: dismissAnnouncement } = useAnnouncements();

  const {
    permissionStatus,
    hasSeenPrompt,
    isLoading: notificationsLoading,
    requestPermission,
    markPromptAsDismissed,
    enableAllNotifications,
  } = useNotificationsContext();

  const debounced = useDebounced(filters, 300);

  // Show notification prompt drawer for first-time users
  useEffect(() => {
    // Only show if: permission undetermined, hasn't seen prompt, and notifications loaded
    if (
      permissionStatus === 'undetermined' &&
      !hasSeenPrompt &&
      !notificationsLoading &&
      !loading
    ) {
      // Delay to let home screen render first
      const timer = setTimeout(() => {
        setShowNotificationPrompt(true);
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [permissionStatus, hasSeenPrompt, notificationsLoading, loading]);

  // Show announcement modal once per session
  useEffect(() => {
    if (
      announcement &&
      !announcementShownRef.current &&
      !loading
    ) {
      const timer = setTimeout(() => {
        setShowAnnouncementModal(true);
        announcementShownRef.current = true;
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [announcement, loading]);

  // Handle notification prompt activate
  const handleNotificationActivate = async () => {
    const granted = await requestPermission();
    if (granted) {
      await enableAllNotifications();
    }
    setShowNotificationPrompt(false);
  };

  // Handle notification prompt dismiss
  const handleNotificationDismiss = async () => {
    await markPromptAsDismissed();
    setShowNotificationPrompt(false);
  };

  // Initial load effect
  useEffect(() => {
    let isCancelled = false;
    async function fetchInitialData() {
      setLoading(true);

      try {
        // Fetch all approved events
        const eventsQuery = supabase
          .from('events')
          .select('*')
          .eq('status', 'approved')
          .order('date', { ascending: true })
          .order('time', { ascending: true, nullsFirst: true });

        // Fetch popular events for hero section
        const popularQuery = supabase
          .from('events')
          .select('*')
          .eq('status', 'approved')
          .eq('is_popular', true)
          .order('date', { ascending: true })
          .order('time', { ascending: true, nullsFirst: true })
          .limit(3);

        // Fetch published news articles
        const newsQuery = supabase
          .from('news_articles')
          .select('*')
          .eq('status', 'published')
          .order('published_at', { ascending: false });

        // Fetch published movies
        const moviesQuery = supabase
          .from('movies')
          .select('id, title, description, date, time, cover_image_url, trailer_youtube_url, fsk, status, created_at, updated_at')
          .eq('status', 'published')
          .order('date', { ascending: true });

        // Fetch published restaurants
        const restaurantsQuery = supabase
          .from('restaurants')
          .select('*')
          .eq('status', 'published')
          .order('sort_order', { ascending: true })
          .order('name', { ascending: true });

        const [eventsResult, popularResult, newsResult, moviesResult, restaurantsResult] = await Promise.all([
          eventsQuery,
          popularQuery,
          newsQuery,
          moviesQuery,
          restaurantsQuery
        ]);

        if (!isCancelled) {
          if (eventsResult.error || !eventsResult.data || eventsResult.data.length === 0) {
            console.error('Events error:', eventsResult.error);
            createMockEvents();
          } else {
            setEvents(eventsResult.data as EventRecord[]);
          }

          if (popularResult.error || !popularResult.data || popularResult.data.length === 0) {
            console.error('Popular events error:', popularResult.error);
            createMockPopularEvents();
          } else {
            setPopularEvents(popularResult.data as EventRecord[]);
          }

          if (newsResult.data) {
            setNewsArticles(newsResult.data as NewsArticle[]);
          }

          if (moviesResult.data) {
            setMovies(moviesResult.data as MovieRecord[]);
          }

          if (restaurantsResult.data) {
            setRestaurants(restaurantsResult.data as RestaurantRecord[]);
          }

          setLoading(false);
        }
      } catch (error) {
        if (!isCancelled) {
          console.error('Fetch error:', error);
          createMockEvents();
          createMockPopularEvents();
          setLoading(false);
        }
      }
    }

    fetchInitialData();
    return () => {
      isCancelled = true;
    };
  }, []);

  const createMockEvents = () => {
    const mockEvents: EventRecord[] = [
      {
        id: '1',
        title: 'Sommerfest am Müritzufer',
        description: 'Ein gemütliches Fest direkt am Wasser mit Live-Musik und regionalen Spezialitäten.',
        date: '2025-09-15',
        time: '18:00:00',
        end_time: '23:00:00',
        location: 'Müritzufer, Röbel',
        organizer_name: 'Stadt Röbel',
        organizer_email: 'info@roebel.de',
        organizer_phone: null,
        ticket_price: 0,
        category: 'Fest',
        status: 'approved' as const,
        is_popular: true,
        image_url: null,
        website_url: null,
        max_attendees: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        latitude: null,
        longitude: null,
        place_id: null,
        formatted_address: null,
        address_components: null,
        livestream_url: null,
        livestream_active: false
      },
      {
        id: '2',
        title: 'Kulturabend in der Scheune',
        description: 'Ein Abend voller Kultur mit Theater, Musik und Poesie.',
        date: '2025-09-20',
        time: '19:30:00',
        end_time: '22:00:00',
        location: 'Kulturscheune, Röbel',
        organizer_name: 'Kulturverein Röbel',
        organizer_email: 'kultur@roebel.de',
        organizer_phone: null,
        ticket_price: 12,
        category: 'Kultur',
        status: 'approved' as const,
        is_popular: false,
        image_url: null,
        website_url: null,
        max_attendees: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        latitude: null,
        longitude: null,
        place_id: null,
        formatted_address: null,
        address_components: null,
        livestream_url: null,
        livestream_active: false
      },
      {
        id: '3',
        title: 'Naturwanderung um die Müritz',
        description: 'Geführte Wanderung durch die Mecklenburgische Seenplatte.',
        date: '2025-09-22',
        time: '09:00:00',
        end_time: '14:00:00',
        location: 'Nationalpark Müritz',
        organizer_name: 'Naturpark Müritz',
        organizer_email: 'info@naturpark-mueritz.de',
        organizer_phone: null,
        ticket_price: 8,
        category: 'Natur',
        status: 'approved' as const,
        is_popular: false,
        image_url: null,
        website_url: null,
        max_attendees: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        latitude: null,
        longitude: null,
        place_id: null,
        formatted_address: null,
        address_components: null,
        livestream_url: null,
        livestream_active: false
      },
      {
        id: '4',
        title: 'Mittelaltermarkt',
        description: 'Historischer Markt mit Rittern, Handwerk und mittelalterlichen Köstlichkeiten.',
        date: '2025-09-25',
        time: '10:00:00',
        end_time: '18:00:00',
        location: 'Stadtplatz Röbel',
        organizer_name: 'Mittelalterverein',
        organizer_email: 'mittelalter@roebel.de',
        organizer_phone: null,
        ticket_price: 5,
        category: 'Mittelalter',
        status: 'approved' as const,
        is_popular: true,
        image_url: null,
        website_url: null,
        max_attendees: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        latitude: null,
        longitude: null,
        place_id: null,
        formatted_address: null,
        address_components: null,
        livestream_url: null,
        livestream_active: false
      },
      {
        id: '5',
        title: 'Lesung: Mecklenburgische Geschichten',
        description: 'Autorin liest aus ihrem neuen Buch über die Region.',
        date: '2025-09-28',
        time: '18:00:00',
        end_time: '20:00:00',
        location: 'Stadtbibliothek Röbel',
        organizer_name: 'Stadtbibliothek',
        organizer_email: 'bibliothek@roebel.de',
        organizer_phone: null,
        ticket_price: 0,
        category: 'Lesung',
        status: 'approved' as const,
        is_popular: false,
        image_url: null,
        website_url: null,
        max_attendees: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        latitude: null,
        longitude: null,
        place_id: null,
        formatted_address: null,
        address_components: null,
        livestream_url: null,
        livestream_active: false
      },
      {
        id: '6',
        title: 'Herbstkonzert im Stadtpark',
        description: 'Klassische Musik unter freiem Himmel mit dem Röbeler Kammerorchester.',
        date: '2025-10-05',
        time: '17:00:00',
        end_time: '19:00:00',
        location: 'Stadtpark Röbel',
        organizer_name: 'Musikverein Röbel',
        organizer_email: 'musik@roebel.de',
        organizer_phone: null,
        ticket_price: 15,
        category: 'Kultur',
        status: 'approved' as const,
        is_popular: false,
        image_url: null,
        website_url: null,
        max_attendees: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        latitude: null,
        longitude: null,
        place_id: null,
        formatted_address: null,
        address_components: null,
        livestream_url: null,
        livestream_active: false
      }
    ];
    
    setEvents(mockEvents);
    console.log('Using mock events for testing');
  };

  const createMockPopularEvents = () => {
    const mockPopularEvents: EventRecord[] = [
      {
        id: '1',
        title: 'Sommerfest am Müritzufer',
        description: 'Ein gemütliches Fest direkt am Wasser mit Live-Musik und regionalen Spezialitäten.',
        date: '2025-09-15',
        time: '18:00:00',
        end_time: '23:00:00',
        location: 'Müritzufer, Röbel',
        organizer_name: 'Stadt Röbel',
        organizer_email: 'info@roebel.de',
        organizer_phone: null,
        ticket_price: 0,
        category: 'Fest',
        status: 'approved' as const,
        is_popular: true,
        image_url: null,
        website_url: null,
        max_attendees: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        latitude: null,
        longitude: null,
        place_id: null,
        formatted_address: null,
        address_components: null,
        livestream_url: null,
        livestream_active: false
      },
      {
        id: '4',
        title: 'Mittelaltermarkt',
        description: 'Historischer Markt mit Rittern, Handwerk und mittelalterlichen Köstlichkeiten.',
        date: '2025-09-25',
        time: '10:00:00',
        end_time: '18:00:00',
        location: 'Stadtplatz Röbel',
        organizer_name: 'Mittelalterverein',
        organizer_email: 'mittelalter@roebel.de',
        organizer_phone: null,
        ticket_price: 5,
        category: 'Mittelalter',
        status: 'approved' as const,
        is_popular: true,
        image_url: null,
        website_url: null,
        max_attendees: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        latitude: null,
        longitude: null,
        place_id: null,
        formatted_address: null,
        address_components: null,
        livestream_url: null,
        livestream_active: false
      }
    ];

    setPopularEvents(mockPopularEvents);
  };

  // Filter changes effect - only triggers events list loading
  useEffect(() => {
    // Skip if initial load is still happening
    if (loading) return;
    
    let isCancelled = false;
    async function fetchFilteredEvents() {
      // Only show loading for events list, not entire screen
      setEventsListLoading(true);

      // Fetch all approved events (we need both popular and non-popular for categories and hero)
      let q = supabase
        .from('events')
        .select('*')
        .eq('status', 'approved')
        .order('date', { ascending: true })
        .order('time', { ascending: true, nullsFirst: true });

      if (debounced.query.trim()) {
        const like = `%${debounced.query.trim()}%`;
        q = q.or(
          `title.ilike.${like},description.ilike.${like},location.ilike.${like},organizer_name.ilike.${like}`
        );
      }
      if (debounced.category && debounced.category.trim() !== '') {
        q = q.eq('category', debounced.category);
      }
      if (debounced.freeOnly) {
        q = q.lte('ticket_price', 0);
      }
      if (debounced.startDate) {
        q = q.gte('date', debounced.startDate);
      }
      if (debounced.endDate) {
        q = q.lte('date', debounced.endDate);
      }

      const { data, error } = await q;
      if (!isCancelled) {
        if (error) {
          // eslint-disable-next-line no-console
          console.error(error);
          setEvents([]);
        } else {
          setEvents(data as EventRecord[]);
        }
        setEventsListLoading(false);
      }
    }

    fetchFilteredEvents();
    return () => {
      isCancelled = true;
    };
  }, [debounced, loading]);

  // Filter popular events to only show today or future events
  const futurePopularEvents = useMemo(() => {
    return popularEvents.filter(event => isEventTodayOrFuture(event.date));
  }, [popularEvents]);

  // Filter events based on selected category for the list below (not hero)
  // Only show events in Röbel/Müritz area
  const eventsToDisplay = useMemo(() => {
    // Only show events where is_popular is explicitly false (exclude true and null)
    // Also exclude events already shown in "Diese Woche" section
    // Only include events in Röbel
    let eventsForList = events.filter(event =>
      event.is_popular === false &&
      !(isEventThisWeek(event.date) && isEventTodayOrFuture(event.date)) &&
      isEventInRoebel(event.location, event.formatted_address, event.address_components)
    );

    // Apply category filter if one is selected
    if (filters.category && filters.category.trim() !== '') {
      eventsForList = eventsForList.filter(event => event.category === filters.category);
    }

    return eventsForList;
  }, [events, filters.category]);

  const handleTabPress = (tab: 'home' | 'explore' | 'profile') => {
    setActiveTab(tab);
    if (tab === 'explore') {
      router.push('/explore');
    } else if (tab === 'profile') {
      router.push('/profile');
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        style={styles.scrollView}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        <View style={styles.header}>
          <Text style={[styles.title, { color: colors.textPrimary }]}>Röbel App</Text>
          <View style={styles.headerActions}>
            <Pressable
              style={[styles.actionBtn, { backgroundColor: colors.surfaceSecondary }]}
              accessibilityLabel="Kalender öffnen"
              onPress={() => setShowCalendarModal(true)}
            >
              <CalendarIcon size={20} color={colors.tabIconActive} />
            </Pressable>
            <Pressable
              style={[styles.actionBtn, { backgroundColor: colors.surfaceSecondary }]}
              accessibilityLabel="Suchen"
              onPress={() => setShowSearchModal(true)}
            >
              <SearchIcon size={20} color={colors.tabIconActive} />
            </Pressable>
          </View>
        </View>
        {loading ? (
          <>
            <HeroCardSkeleton />
            <View style={{ paddingHorizontal: 16, marginTop: 24, marginBottom: 12 }}>
              <Skeleton width={180} height={22} borderRadius={6} />
            </View>
            {[1, 2, 3].map((index) => (
              <EventCardSkeleton key={index} />
            ))}
          </>
        ) : (
          <>
            {primaryLiveEvent && <LivestreamBanner event={primaryLiveEvent} />}
            <SwipeableCardStack events={futurePopularEvents} showPagination loop containerStyle={{ paddingVertical: 16, marginBottom: 0 }} />
            <ThisWeekEvents events={events} />
            <NewsSection articles={newsArticles} />

            <MovieSection movies={movies} />

            <RestaurantSection restaurants={restaurants} />

            <NearbyEventsSection events={events} />

            <View style={styles.eventsSection}>
              <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>Weitere Veranstaltungen</Text>
              <HomeCategoryChips
                onCategoryPress={(category: EventCategory) => {
                  router.push(`/category/${category}` as any);
                }}
              />
              <View style={styles.eventsList}>
              {eventsListLoading ? (
                // Show skeleton loaders only for events list
                <>
                  {[1, 2, 3].map((index) => (
                    <EventCardSkeleton key={index} />
                  ))}
                </>
              ) : eventsToDisplay.length === 0 ? (
                <Text style={{ color: colors.textPrimary, textAlign: 'center', marginTop: 20 }}>Keine Veranstaltungen entsprechen deinen Filtern.</Text>
              ) : (
                eventsToDisplay.map((event) => (
                  <EventCard key={event.id} event={event} />
                ))
              )}
              </View>
            </View>
          </>
        )}
      </ScrollView>
      
      <SearchModal 
        visible={showSearchModal}
        onClose={() => setShowSearchModal(false)}
      />
      
      <CalendarModal
        visible={showCalendarModal}
        onClose={() => setShowCalendarModal(false)}
      />

      <NotificationPromptDrawer
        visible={showNotificationPrompt}
        onActivate={handleNotificationActivate}
        onDismiss={handleNotificationDismiss}
      />

      {announcement && (
        <AnnouncementModal
          visible={showAnnouncementModal}
          announcement={announcement}
          onDismiss={() => {
            setShowAnnouncementModal(false);
            if (announcement.show_once) {
              dismissAnnouncement(announcement.id);
            }
          }}
        />
      )}

      <BottomNavigation
        activeTab={activeTab}
        onTabPress={handleTabPress}
      />
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
  scrollContent: {
    paddingTop: 0,
    paddingBottom: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
    paddingHorizontal: 16,
  },
  title: {
    fontSize: 22,
    fontFamily: 'Inter-Medium',
  },
  headerActions: {
    flexDirection: 'row',
    gap: 8,
  },
  actionBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  center: { alignItems: 'center', padding: 20 },
  eventsSection: {
    marginTop: 24,
  },
  sectionTitle: {
    fontSize: 22,
    fontFamily: 'MonaSansSemiCondensed-Medium',
    marginBottom: 12,
    paddingHorizontal: 16,
  },
  eventsList: {
    marginTop: 0,
  },
});
