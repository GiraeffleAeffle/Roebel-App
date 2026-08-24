import React, { useRef } from 'react';
import { Pressable, Text, StyleSheet, Animated as RNAnimated } from 'react-native';
import { useRouter } from 'expo-router';
import ReanimatedAnimated, {
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withTiming,
  Easing,
  type SharedValue,
} from 'react-native-reanimated';
import { useTheme } from '@/context/ThemeContext';
import { LocationIcon } from '@/components/Icons';
import { BOTTOM_NAV_HEIGHT } from '@/components/BottomNavigation';

type Props = {
  /**
   * Reanimated shared value driving show/hide-on-scroll (true = visible).
   * Pass a shared value written from a `useAnimatedScrollHandler` so
   * show/hide runs entirely on the UI thread with zero JS re-renders.
   * Defaults to always-visible when omitted.
   */
  visible?: SharedValue<boolean>;
  label?: string;
  href?: string;
  icon?: React.ReactNode;
  accessibilityLabel?: string;
};

export default function MapFAB({
  visible,
  label = 'Karte',
  href = '/location',
  icon,
  accessibilityLabel,
}: Props) {
  const router = useRouter();
  const { colors } = useTheme();
  const scaleAnim = useRef(new RNAnimated.Value(1)).current;
  // Fallback for callers that don't drive show/hide — created unconditionally
  // to satisfy the rules of hooks, only actually used when `visible` is omitted.
  const alwaysVisible = useSharedValue(true);
  const visibleShared = visible ?? alwaysVisible;

  const fabTranslateY = useDerivedValue(() =>
    withTiming(visibleShared.value ? 0 : 80, {
      duration: 400,
      easing: visibleShared.value ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
    })
  );
  const fabOpacity = useDerivedValue(() =>
    withTiming(visibleShared.value ? 1 : 0, {
      duration: 350,
      easing: visibleShared.value ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
    })
  );

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: fabTranslateY.value }],
    opacity: fabOpacity.value,
    pointerEvents: visibleShared.value ? 'auto' : 'none',
  }));

  const handlePressIn = () => {
    RNAnimated.spring(scaleAnim, {
      toValue: 0.95,
      useNativeDriver: true,
    }).start();
  };

  const handlePressOut = () => {
    RNAnimated.spring(scaleAnim, {
      toValue: 1,
      useNativeDriver: true,
    }).start();
  };

  return (
    <ReanimatedAnimated.View style={[styles.container, animatedStyle]}>
      <RNAnimated.View style={{ transform: [{ scale: scaleAnim }] }}>
        <Pressable
          onPress={() => router.push(href as any)}
          onPressIn={handlePressIn}
          onPressOut={handlePressOut}
          style={[styles.pill, { backgroundColor: colors.background }]}
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel ?? `${label} öffnen`}
        >
          {icon ?? <LocationIcon size={16} color={colors.textPrimary} />}
          <Text style={[styles.label, { color: colors.textPrimary }]}>{label}</Text>
        </Pressable>
      </RNAnimated.View>
    </ReanimatedAnimated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: BOTTOM_NAV_HEIGHT + 40,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 10,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 6,
  },
  label: {
    fontSize: 15,
    fontFamily: 'Inter-Medium',
  },
});
