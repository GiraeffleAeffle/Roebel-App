import { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Pressable, Dimensions, ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  runOnJS,
  interpolate,
  Easing,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { format, parseISO } from 'date-fns';
import { de } from 'date-fns/locale';
import { EventRecord } from '@/lib/types';
import { useTheme } from '@/context/ThemeContext';
import { formatTime, formatLocation } from '@/lib/utils';
import { softShadow } from '@/lib/shadow';
import EventCancelledScrim from '@/components/EventCancelledScrim';
import { transformedImageUrl } from '@/lib/image-url';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const CARD_WIDTH = SCREEN_WIDTH - 40;
const CARD_HEIGHT = 520;

// Deck geometry: cards sit stacked behind the top card, peeking above it,
// each step smaller and higher. A swiped card physically tucks BEHIND the
// deck: it flies out to the side, its z-order drops below the stack, then
// it glides back in to become the last card.
const VISIBLE_CARDS = 3;
const STEP_Y = -16;
const STEP_SCALE = 0.055;
const SWIPE_THRESHOLD = 90;
const FLING_VELOCITY = 800;
const FLYOUT_X = CARD_WIDTH * 0.82;

// Called from useAnimatedStyle worklets — MUST be worklets themselves.
// Without the directive they reach the UI runtime as plain host objects
// and calling them crashes release builds ("Object is not a function").
const slotY = (slot: number) => {
  'worklet';
  return slot * STEP_Y;
};
const slotScale = (slot: number) => {
  'worklet';
  return 1 - slot * STEP_SCALE;
};

type Props = {
  events: EventRecord[];
  showPagination?: boolean;
  loop?: boolean;
  spaceBetween?: number;
  containerStyle?: ViewStyle;
};

export default function DeckCardSwiper({
  events,
  showPagination = false,
  containerStyle,
}: Props) {
  const { colors } = useTheme();
  const [activeIndex, setActiveIndex] = useState(0);
  const progress = useSharedValue(0);

  const containerOpacity = useSharedValue(0);
  const containerTranslateY = useSharedValue(20);

  useEffect(() => {
    setTimeout(() => {
      containerOpacity.value = withTiming(1, {
        duration: 300,
        easing: Easing.out(Easing.ease),
      });
      containerTranslateY.value = withTiming(0, {
        duration: 300,
        easing: Easing.out(Easing.ease),
      });
    }, 500);
  }, []);

  const containerAnimatedStyle = useAnimatedStyle(() => ({
    opacity: containerOpacity.value,
    transform: [{ translateY: containerTranslateY.value }],
  }));

  const prevActiveIndexRef = useRef(activeIndex);

  const slideNext = () => {
    setActiveIndex((prev) => (prev + 1) % events.length);
  };

  // Reset progress in the render body so it syncs with the slot shift:
  // promoted cards were at their next slot's pose at progress=1, which is
  // exactly their new base pose at progress=0 — a seamless handoff.
  if (prevActiveIndexRef.current !== activeIndex) {
    progress.value = 0;
    prevActiveIndexRef.current = activeIndex;
  }

  if (events.length === 0) return null;

  return (
    <Animated.View style={[styles.container, containerStyle, containerAnimatedStyle]}>
      <View style={styles.deckContainer}>
        <View style={styles.deckWrapper}>
          {events.map((event, index) => {
            const slideIndex = (index - activeIndex + events.length) % events.length;
            // The last slot stays mounted even beyond the visible window so
            // a just-tucked card can finish its return glide behind the deck.
            if (slideIndex >= VISIBLE_CARDS && slideIndex !== events.length - 1) return null;

            return (
              <DeckCard
                key={`${event.id}-${index}`}
                event={event}
                slideIndex={slideIndex}
                isActive={slideIndex === 0}
                progress={progress}
                onSlideNext={slideNext}
                totalSlides={events.length}
              />
            );
          })}
        </View>

        {showPagination && (
          <View style={styles.pagination}>
            {events.map((_, index) => (
              <View
                key={index}
                style={[
                  styles.paginationBullet,
                  index === activeIndex && [
                    styles.paginationBulletActive,
                    { backgroundColor: colors.textPrimary },
                  ],
                ]}
              />
            ))}
          </View>
        )}
      </View>
    </Animated.View>
  );
}

type DeckCardProps = {
  event: EventRecord;
  slideIndex: number;
  isActive: boolean;
  progress: Animated.SharedValue<number>;
  onSlideNext: () => void;
  totalSlides: number;
};

function DeckCard({
  event,
  slideIndex,
  isActive,
  progress,
  onSlideNext,
  totalSlides,
}: DeckCardProps) {
  const router = useRouter();
  const { colors, isDark } = useTheme();

  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  // 1 while the card is returning from its flyout pose into the back slot.
  const tuck = useSharedValue(0);
  const isTucking = useSharedValue(false);

  const slideIndexSV = useSharedValue(slideIndex);
  slideIndexSV.value = slideIndex;

  const dayName = event.date
    ? format(parseISO(event.date), 'EEEE', { locale: de })
    : '';

  const timeStr = formatTime(event.time);
  const sublineParts: string[] = [];
  if (timeStr) sublineParts.push(`${timeStr} Uhr`);
  if (event.organizer_name) sublineParts.push(`Von ${event.organizer_name}`);
  const subline = sublineParts.join(' • ');

  const locationText = formatLocation(event.location).toUpperCase();

  const prevSlideIndexRef = useRef(slideIndex);
  useEffect(() => {
    const prev = prevSlideIndexRef.current;
    prevSlideIndexRef.current = slideIndex;

    if (prev === 0 && slideIndex === totalSlides - 1 && totalSlides > 1) {
      // Just advanced: this card is now behind the deck, still off to the
      // side at its flyout pose. Glide it back underneath.
      isTucking.value = true;
      tuck.value = 1;
      tuck.value = withSpring(0, { damping: 26, stiffness: 160 }, (finished) => {
        if (finished) {
          translateX.value = 0;
          translateY.value = 0;
          isTucking.value = false;
        }
      });
    } else if (!isTucking.value) {
      // Any other slot change (incl. becoming active): clean pan state.
      translateX.value = 0;
      translateY.value = 0;
      tuck.value = 0;
    }
  }, [slideIndex, totalSlides]);

  const gesture = Gesture.Pan()
    .enabled(isActive && totalSlides > 1)
    .activeOffsetX([-10, 10])
    .failOffsetY([-10, 10])
    .onUpdate((e) => {
      translateX.value = e.translationX;
      translateY.value = e.translationY * 0.12;
      progress.value = Math.min(Math.abs(e.translationX) / 180, 1);
    })
    .onEnd((e) => {
      const dist = Math.abs(e.translationX);
      const shouldSwipe = dist > SWIPE_THRESHOLD || Math.abs(e.velocityX) > FLING_VELOCITY;

      if (shouldSwipe) {
        const direction = e.translationX > 0 ? 1 : -1;
        progress.value = withTiming(1, { duration: 220 });
        translateY.value = withTiming(0, { duration: 220 });
        translateX.value = withTiming(
          direction * FLYOUT_X,
          { duration: 220, easing: Easing.out(Easing.ease) },
          (finished) => {
            if (finished) {
              runOnJS(onSlideNext)();
            }
          },
        );
      } else {
        translateX.value = withSpring(0, { damping: 20, stiffness: 200 });
        translateY.value = withSpring(0, { damping: 20, stiffness: 200 });
        progress.value = withSpring(0, { damping: 20, stiffness: 200 });
      }
    });

  const animatedStyle = useAnimatedStyle(() => {
    const si = slideIndexSV.value;
    // Deepest occupied slot — slot 1 in a two-card deck, slot 2 otherwise.
    const backSlot = Math.min(totalSlides - 1, VISIBLE_CARDS - 1);

    if (si === 0) {
      // Top card: tracks the finger, tilts with the drag.
      const rotate = (translateX.value / CARD_WIDTH) * 14;
      return {
        transform: [
          { translateX: translateX.value },
          { translateY: translateY.value },
          { scale: 1 },
          { rotateZ: `${rotate}deg` },
        ],
        zIndex: 30,
        opacity: 1,
      };
    }

    if (si === totalSlides - 1 && tuck.value > 0) {
      // Tucking card: blend from the flyout pose (tuck=1) into the back
      // slot's resting pose (tuck=0). z-order already dropped below the
      // deck the moment the index advanced — the visible "moves back".
      const t = tuck.value;
      const rotate = (translateX.value / CARD_WIDTH) * 14 * t;
      const scale = slotScale(backSlot) + (1 - slotScale(backSlot)) * t;
      const isGhost = si >= VISIBLE_CARDS;
      return {
        transform: [
          { translateX: translateX.value * t },
          { translateY: slotY(backSlot) * (1 - t) },
          { scale },
          { rotateZ: `${rotate}deg` },
        ],
        zIndex: isGhost ? 4 : 6,
        // A ghost (deck deeper than 3) must vanish once it slides behind
        // the identical-looking real back card.
        opacity: isGhost ? interpolate(t, [0, 0.12, 1], [0, 1, 1]) : 1,
      };
    }

    if (si >= VISIBLE_CARDS) {
      // Parked ghost slot — fully hidden behind the deck.
      return {
        transform: [
          { translateX: 0 },
          { translateY: slotY(backSlot) },
          { scale: slotScale(backSlot) },
          { rotateZ: '0deg' },
        ],
        zIndex: 4,
        opacity: 0,
      };
    }

    // Back cards: rest at their slot, glide one slot forward as the top
    // card is dragged (progress 0→1).
    const fromY = slotY(si);
    const toY = slotY(si - 1);
    const fromScale = slotScale(si);
    const toScale = slotScale(si - 1);
    return {
      transform: [
        { translateX: 0 },
        { translateY: interpolate(progress.value, [0, 1], [fromY, toY]) },
        { scale: interpolate(progress.value, [0, 1], [fromScale, toScale]) },
        { rotateZ: '0deg' },
      ],
      zIndex: 20 - si * 5,
      opacity: 1,
    };
  });

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View
        style={[
          styles.cardWrapper,
          animatedStyle,
          slideIndex === 0 && softShadow(3, isDark),
        ]}
      >
        <Pressable
          onPress={() => {
            if (isActive) {
              router.push({
                pathname: '/event/[id]',
                params: { id: event.id },
              });
            }
          }}
          style={[
            styles.card,
            { backgroundColor: colors.background, borderColor: colors.borderSecondary },
          ]}
        >
          {/* Image Section */}
          <View style={styles.imageSection}>
            {event.image_url ? (
              <>
                {/* Blurred background */}
                <Image
                  source={{
                    uri:
                      transformedImageUrl(event.image_url, { width: 64, quality: 40 }) ??
                      undefined,
                  }}
                  style={styles.blurredBg}
                  contentFit="cover"
                  cachePolicy="memory-disk"
                  blurRadius={20}
                />
                {/* 20% white overlay */}
                <View style={styles.whiteOverlay} />
                {/* Sharp event image */}
                <Image
                  source={{ uri: transformedImageUrl(event.image_url, { width: 1080 }) ?? undefined }}
                  style={styles.sharpImage}
                  contentFit="contain"
                  cachePolicy="memory-disk"
                />
              </>
            ) : (
              <View style={[styles.imagePlaceholder, { backgroundColor: colors.cardPlaceholder }]} />
            )}

            {/* Day pill */}
            {dayName ? (
              <View style={[styles.dayPill, { backgroundColor: colors.background }]}>
                <Text style={[styles.dayPillText, { color: colors.textPrimary }]}>{dayName}</Text>
              </View>
            ) : null}

            {event.is_cancelled && <EventCancelledScrim radius={18} />}
          </View>

          {/* Content Section */}
          <View style={styles.contentSection}>
            <Text style={[styles.title, { color: colors.textPrimary }]} numberOfLines={2}>
              {event.title}
            </Text>

            {subline ? (
              <Text style={[styles.subline, { color: colors.textSecondary }]}>{subline}</Text>
            ) : null}

            {/* Divider */}
            <View style={[styles.divider, { backgroundColor: colors.borderSecondary }]} />

            {/* Bottom row: Location + Button */}
            <View style={styles.bottomRow}>
              <Text
                style={[styles.locationText, { color: colors.textSecondary }]}
                numberOfLines={2}
              >
                {locationText}
              </Text>

              <Pressable
                style={[styles.moreButton, { backgroundColor: colors.surfaceSecondary }]}
                onPress={(e) => {
                  e.stopPropagation();
                  router.push({
                    pathname: '/event/[id]',
                    params: { id: event.id },
                  });
                }}
              >
                <Text style={[styles.moreButtonText, { color: colors.textPrimary }]}>
                  Mehr erfahren
                </Text>
              </Pressable>
            </View>
          </View>
        </Pressable>
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 50,
    marginBottom: 20,
  },
  deckContainer: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    position: 'relative',
    overflow: 'visible',
  },
  deckWrapper: {
    width: '100%',
    height: '100%',
    position: 'relative',
  },
  cardWrapper: {
    position: 'absolute',
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    left: 0,
    top: 0,
    borderRadius: 24,
  },

  // Card container
  card: {
    width: '100%',
    height: '100%',
    borderRadius: 24,
    borderWidth: 1,
    padding: 8,
    overflow: 'hidden',
  },

  // Image section
  imageSection: {
    flex: 1,
    borderRadius: 18,
    overflow: 'hidden',
    position: 'relative',
  },
  blurredBg: {
    ...StyleSheet.absoluteFillObject,
  },
  whiteOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
  },
  sharpImage: {
    ...StyleSheet.absoluteFillObject,
  },
  imagePlaceholder: {
    width: '100%',
    height: '100%',
    borderRadius: 18,
  },

  // Day pill
  dayPill: {
    position: 'absolute',
    top: 12,
    left: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
  },
  dayPillText: {
    fontSize: 12,
    fontFamily: 'Inter-SemiBold',
  },

  // Content section
  contentSection: {
    paddingHorizontal: 16,
    paddingVertical: 24,
  },
  title: {
    fontSize: 28,
    fontFamily: 'Inter-SemiBold',
    lineHeight: 32,
    marginBottom: 6,
  },
  subline: {
    fontSize: 14,
    fontFamily: 'Inter-Regular',
    marginBottom: 16,
  },
  divider: {
    height: 1,
    width: '100%',
    marginBottom: 16,
  },
  bottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  locationText: {
    fontSize: 12,
    fontFamily: 'Inter-Medium',
    letterSpacing: 0.5,
    flex: 1,
    marginRight: 12,
  },
  moreButton: {
    height: 48,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  moreButtonText: {
    fontSize: 14,
    fontFamily: 'MonaSansSemiCondensed-Bold',
  },

  // Pagination
  pagination: {
    position: 'absolute',
    bottom: -30,
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
  },
  paginationBullet: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(0, 0, 0, 0.2)',
  },
  paginationBulletActive: {
    width: 20,
  },
});
