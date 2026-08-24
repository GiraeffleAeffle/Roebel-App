import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useTheme } from '@/context/ThemeContext';
import { useUser } from '@/context/UserContext';
import { fetchThisWeekEvents } from '@/lib/supabase-posts';
import type { EventRecord } from '@/lib/types';
import { fetchEventStoriesAudioUrl } from '@/lib/supabase-app-settings';
import {
  fetchHomeFeedStoryCollections,
  fetchSlidesForCollections,
  type StoryCollection,
  type StorySlide,
} from '@/lib/supabase-story-collections';
import { loadCachedStories, saveCachedStories } from '@/lib/story-cache';
import StoryViewer, {
  type StoryGroup,
  type StorySlideInput,
} from './StoryViewer';
import { ShimmerGroup, ShimmerBlock } from './Shimmer';

// Shared background track playing under all event stories — title shown in
// the marquee tooltip, link opened when the tooltip is tapped.
const EVENT_STORIES_SONG_TITLE = 'Röbeler PLATTmusikanten | Wo sünd all de Lüd?';
const EVENT_STORIES_SONG_URL =
  'https://www.youtube.com/watch?v=Y55K5v1bL8Q&list=RDY55K5v1bL8Q&start_radio=1';

function formatEventDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('de-DE', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

function formatWeekdayLong(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('de-DE', { weekday: 'long' });
}

// Where to open the viewer. groupIdx 0 = events, 1+ = collections.
type OpenTarget = { groupIdx: number; slideIdx: number };

// Module-level cache of the last loaded stories. Seeds initial state so a
// remount (e.g. after navigating away and back) shows data instantly instead
// of flashing skeletons / empty while the queries re-run in the background.
let cachedEvents: EventRecord[] = [];
let cachedCollections: StoryCollection[] = [];
let cachedCollectionSlides: Record<string, StorySlide[]> = {};
let cachedAudioUrl: string | null = null;
let hasLoadedStories = false;
// When the module cache was last refreshed from the network. While it's fresh
// (within the TTL) a remount reuses the in-memory cache and skips re-querying.
let lastFetchedAt = 0;
const STORY_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Warm expo-image's disk/memory cache for every story image so the full-screen
// viewer (especially collection slide backgrounds, which the rail never shows)
// opens instantly instead of fading in from network. Fire-and-forget.
function prefetchStoryImages(
  events: EventRecord[],
  collections: StoryCollection[],
  collectionSlides: Record<string, StorySlide[]>,
): void {
  const urls = new Set<string>();
  for (const e of events) if (e.image_url) urls.add(e.image_url);
  for (const c of collections) if (c.cover_image_url) urls.add(c.cover_image_url);
  for (const slides of Object.values(collectionSlides)) {
    for (const s of slides) {
      if (s.background_image_url) urls.add(s.background_image_url);
    }
  }
  if (urls.size === 0) return;
  try {
    void Image.prefetch(Array.from(urls), 'memory-disk');
  } catch {
    // Non-fatal — images simply load lazily when first rendered.
  }
}

type Props = {
  /**
   * Fires with true while a finger is down on the horizontal rail, false
   * when it lifts. FeedHome uses this to lock the feed pager so a story
   * swipe never falls through and switches the tab instead.
   */
  onRailTouchActive?: (active: boolean) => void;
};

export default function HomeStoryBar({ onRailTouchActive }: Props) {
  const { colors } = useTheme();
  const router = useRouter();
  const { isCitizen } = useUser();

  const [events, setEvents] = useState<EventRecord[]>(cachedEvents);
  const [collections, setCollections] = useState<StoryCollection[]>(cachedCollections);
  const [collectionSlides, setCollectionSlides] = useState<
    Record<string, StorySlide[]>
  >(cachedCollectionSlides);
  // Shared background track that loops under ALL event stories (admin-set).
  const [eventStoriesAudioUrl, setEventStoriesAudioUrl] = useState<
    string | null
  >(cachedAudioUrl);
  const [openTarget, setOpenTarget] = useState<OpenTarget | null>(null);
  // Only show skeletons on the very first load (when nothing is cached yet).
  const [loading, setLoading] = useState(!hasLoadedStories);

  useEffect(() => {
    let cancelled = false;

    // 1. Optimistic hydration from the persisted bundle (cold start only —
    //    on a same-session remount the module cache already seeded state). The
    //    `prev.length ? prev : …` guards ensure we never clobber fresher
    //    in-memory or network data with the on-disk snapshot.
    if (!hasLoadedStories) {
      loadCachedStories().then((bundle) => {
        if (cancelled || !bundle) return;
        setEvents((prev) => (prev.length ? prev : bundle.events));
        setCollections((prev) => (prev.length ? prev : bundle.collections));
        setCollectionSlides((prev) =>
          Object.keys(prev).length ? prev : bundle.collectionSlides,
        );
        setEventStoriesAudioUrl((prev) => prev ?? bundle.audioUrl);
        setLoading(false);
        prefetchStoryImages(
          bundle.events,
          bundle.collections,
          bundle.collectionSlides,
        );
      });
    }

    // 2. Skip the network entirely while the in-memory cache is still fresh.
    if (
      hasLoadedStories &&
      Date.now() - lastFetchedAt < STORY_CACHE_TTL_MS &&
      (cachedEvents.length > 0 || cachedCollections.length > 0)
    ) {
      return () => {
        cancelled = true;
      };
    }

    // 3. Refresh from the network in the background.
    let freshEvents: EventRecord[] = cachedEvents;
    let freshCollections: StoryCollection[] = cachedCollections;
    let freshSlides: Record<string, StorySlide[]> = cachedCollectionSlides;
    let freshAudio: string | null = cachedAudioUrl;

    const eventsP = fetchThisWeekEvents().then((data) => {
      if (cancelled) return;
      freshEvents = data as EventRecord[];
      cachedEvents = freshEvents;
      setEvents(freshEvents);
    });

    const audioP = fetchEventStoriesAudioUrl().then((url) => {
      if (cancelled) return;
      freshAudio = url;
      cachedAudioUrl = url;
      setEventStoriesAudioUrl(url);
    });

    const collectionsP = fetchHomeFeedStoryCollections().then(async (cols) => {
      if (cancelled) return;
      freshCollections = cols;
      cachedCollections = cols;
      setCollections(cols);
      // One round-trip for all slides — admin-curated, small list.
      const map = await fetchSlidesForCollections(cols.map((c) => c.id));
      if (cancelled) return;
      freshSlides = map;
      cachedCollectionSlides = map;
      setCollectionSlides(map);
    });

    Promise.allSettled([eventsP, audioP, collectionsP]).then(() => {
      if (cancelled) return;
      hasLoadedStories = true;
      lastFetchedAt = Date.now();
      setLoading(false);
      prefetchStoryImages(freshEvents, freshCollections, freshSlides);
      void saveCachedStories({
        events: freshEvents,
        collections: freshCollections,
        collectionSlides: freshSlides,
        audioUrl: freshAudio,
        savedAt: lastFetchedAt,
      });
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const showSkeletons =
    loading && events.length === 0 && collections.length === 0;

  // ── Group sequence ──────────────────────────────────────────
  // Index 0: ONE events group with all events as slides (grouped progress
  //          bars at the top, one segment per event). Per-slide header and
  //          onSwipeUp carry each event's organizer info / detail-page link.
  // Index 1+: one group per collection.
  const groups = useMemo<StoryGroup[]>(() => {
    const result: StoryGroup[] = [];

    if (events.length > 0) {
      const eventSlides: StorySlideInput[] = events.map((event) => {
        // Resolved at fetch time — org name/avatar or citizen username/avatar,
        // never a wallet address. See resolveEventAuthors in supabase-posts.
        const orgName = event.author?.name ?? 'Veranstalter';
        const orgAvatar = event.author?.avatarUrl ?? null;
        return {
          backgroundUrl: event.image_url ?? '',
          imageFit: 'contain',
          pillText: formatWeekdayLong(event.date),
          title: event.title,
          subtitleLine: event.location || undefined,
          header: {
            avatarUrl: orgAvatar,
            title: orgName,
            subtitle: formatEventDate(event.date),
          },
          onSwipeUp: () => {
            router.push(`/event/${event.id}` as any);
            setTimeout(() => setOpenTarget(null), 300);
          },
          cta: {
            label: 'Mehr erfahren',
            onPress: () => {
              router.push(`/event/${event.id}` as any);
              setTimeout(() => setOpenTarget(null), 300);
            },
          },
          // Per-event OVERRIDE track. When set, the StoryViewer ducks the
          // shared events background track out and crossfades this one in
          // for the duration of this slide. Null for most events.
          audioUrl: event.audio_url ?? null,
        };
      });

      result.push({
        id: 'events',
        // Shared background track for ALL event slides — loops continuously
        // and is ducked under any per-event override track (see StoryViewer).
        audioUrl: eventStoriesAudioUrl,
        audioTitle: EVENT_STORIES_SONG_TITLE,
        audioLinkUrl: EVENT_STORIES_SONG_URL,
        // Event stories linger a little longer than collections (default 6s).
        durationMs: 10000,
        slides: eventSlides,
      });
    }

    for (const c of collections) {
      const slides = collectionSlides[c.id] ?? [];
      result.push({
        id: `collection:${c.id}`,
        header: {
          avatarUrl: c.cover_image_url,
          title: c.title,
          subtitle: c.subtitle ?? undefined,
        },
        // One track per collection — same URL across all slides keeps the
        // player instance alive, so the track loops continuously.
        audioUrl: c.audio_url ?? null,
        slides:
          slides.length > 0
            ? slides.map((s) => ({
                backgroundUrl: s.background_image_url,
                overlayText: s.overlay_text,
                textColor: s.text_color ?? '#FFFFFF',
                imageFit: 'cover' as const,
              }))
            : [
                {
                  backgroundUrl: c.cover_image_url ?? '',
                  imageFit: 'cover' as const,
                },
              ],
      });
    }

    return result;
  }, [events, collections, collectionSlides, eventStoriesAudioUrl, router]);

  const handleClose = useCallback(() => setOpenTarget(null), []);

  const hasEvents = events.length > 0;
  // Collections start at groupIdx 1 if events exist, otherwise 0.
  const collectionsGroupStart = hasEvents ? 1 : 0;

  return (
    <View style={[styles.wrapper, { borderBottomColor: colors.border }]}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
        onTouchStart={() => onRailTouchActive?.(true)}
        onTouchEnd={() => onRailTouchActive?.(false)}
        onTouchCancel={() => onRailTouchActive?.(false)}
      >
        {/* First-load skeletons — shimmering placeholder cards matching real
            card geometry while the events/collections queries resolve. */}
        {showSkeletons && (
          <ShimmerGroup>
            {Array.from({ length: 5 }).map((_, i) => (
              <ShimmerBlock key={`story-skeleton-${i}`} style={styles.card} />
            ))}
          </ShimmerGroup>
        )}

        {/* One bubble per event. Tapping any opens the SAME unified events
            story at that event's slide index. */}
        {events.map((event, idx) => {
          const orgName = event.author?.name ?? 'Veranstalter';
          const orgAvatar = event.author?.avatarUrl ?? null;
          return (
            <Pressable
              key={`event-${event.id}`}
              onPress={() => setOpenTarget({ groupIdx: 0, slideIdx: idx })}
              style={styles.card}
            >
              {event.image_url ? (
                <Image
                  source={{ uri: event.image_url }}
                  style={StyleSheet.absoluteFill}
                  contentFit="cover"
                />
              ) : (
                <View
                  style={[StyleSheet.absoluteFill, styles.cardImageFallback]}
                />
              )}
              <View style={styles.storyOrgRow}>
                <View style={styles.storyOrgAvatar}>
                  {orgAvatar ? (
                    <Image
                      source={{ uri: orgAvatar }}
                      style={[StyleSheet.absoluteFill, styles.storyOrgAvatarImg]}
                      contentFit="cover"
                    />
                  ) : (
                    <Text style={styles.storyOrgLetter}>
                      {orgName.charAt(0).toUpperCase()}
                    </Text>
                  )}
                </View>
              </View>
              <LinearGradient
                colors={['transparent', 'rgba(0,0,0,0.82)']}
                style={styles.cardGradient}
              >
                <Text style={styles.cardTitle} numberOfLines={2}>
                  {event.title}
                </Text>
              </LinearGradient>
            </Pressable>
          );
        })}

        {/* Collection bubbles (rendered after the event bubbles) */}
        {collections.map((c, idx) => (
          <Pressable
            key={`collection-${c.id}`}
            onPress={() =>
              setOpenTarget({
                groupIdx: collectionsGroupStart + idx,
                slideIdx: 0,
              })
            }
            style={styles.card}
          >
            {c.cover_image_url ? (
              <Image
                source={{ uri: c.cover_image_url }}
                style={StyleSheet.absoluteFill}
                contentFit="cover"
              />
            ) : (
              <View
                style={[
                  StyleSheet.absoluteFill,
                  { backgroundColor: colors.primary },
                ]}
              />
            )}
            <LinearGradient
              colors={['transparent', 'rgba(0,0,0,0.85)']}
              style={styles.cardGradient}
            >
              <Text style={styles.cardTitle} numberOfLines={2}>
                {c.title}
              </Text>
            </LinearGradient>
          </Pressable>
        ))}

        {/* Create event card — rendered last, after the events and
            collections. Only for citizens (personal Bürger or org accounts
            where the connected wallet is a verified citizen). */}
        {!showSkeletons && isCitizen ? (
          <Pressable
            onPress={() => router.push('/submit-event' as any)}
            style={[
              styles.card,
              styles.createCard,
              {
                backgroundColor: colors.background,
                borderColor: colors.background,
              },
            ]}
          >
            <View
              style={[
                styles.createCardTopHalf,
                { backgroundColor: colors.feedBackground },
              ]}
            />
            <View
              style={[styles.plusCircle, { backgroundColor: colors.primary }]}
            >
              <Text style={[styles.plusText, { color: colors.background }]}>
                +
              </Text>
            </View>
            <Text style={[styles.createLabel, { color: colors.textPrimary }]}>
              {'Veranstaltung\nerstellen'}
            </Text>
          </Pressable>
        ) : null}
      </ScrollView>

      <StoryViewer
        visible={openTarget !== null && groups.length > 0}
        groups={groups}
        initialGroupIndex={openTarget?.groupIdx ?? 0}
        initialSlideIndex={openTarget?.slideIdx ?? 0}
        onClose={handleClose}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  scroll: {
    // FeedList's contentContainer already supplies an 8px horizontal gutter;
    // 8 + 8 = 16px from the phone edge for the first/last card.
    paddingHorizontal: 8,
    paddingVertical: 12,
    gap: 10,
  },
  card: {
    width: 90,
    height: 140,
    borderRadius: 14,
    overflow: 'hidden',
    flexShrink: 0,
  },
  createCard: {
    borderWidth: 1.5,
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingBottom: 10,
  },
  createCardTopHalf: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 70,
    borderTopLeftRadius: 13,
    borderTopRightRadius: 13,
  },
  plusCircle: {
    position: 'absolute',
    top: 50,
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 2,
  },
  plusText: {
    fontSize: 24,
    fontFamily: 'Inter-Bold',
    lineHeight: 28,
  },
  createLabel: {
    fontSize: 11,
    fontFamily: 'Inter-Regular',
    textAlign: 'center',
    lineHeight: 15,
  },
  cardImageFallback: {
    backgroundColor: '#1a2a4a',
  },
  storyOrgRow: {
    position: 'absolute',
    top: 6,
    left: 6,
  },
  storyOrgAvatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#ffffff',
    backgroundColor: '#00498B',
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
  },
  // Round the image itself (not just the container) so it stays a perfect
  // circle on Android, where overflow:hidden clipping of an absolutely-
  // positioned child image is unreliable.
  storyOrgAvatarImg: {
    borderRadius: 12,
  },
  storyOrgLetter: {
    color: '#ffffff',
    fontSize: 9,
    fontFamily: 'Inter-SemiBold',
  },
  cardGradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 6,
    paddingTop: 16,
    justifyContent: 'flex-end',
  },
  cardTitle: {
    color: '#ffffff',
    fontSize: 10,
    fontFamily: 'Inter-SemiBold',
    lineHeight: 13,
  },
});
