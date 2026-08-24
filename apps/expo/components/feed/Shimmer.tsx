import React, { createContext, useContext, useEffect, useState } from 'react';
import { StyleSheet, View, useWindowDimensions, type ViewStyle, type StyleProp } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  Easing,
  type SharedValue,
} from 'react-native-reanimated';
import { useTheme } from '@/context/ThemeContext';

const AnimatedGradient = Animated.createAnimatedComponent(LinearGradient);

const SWEEP_DURATION_MS = 1100;
const SWEEP_WIDTH = 96;

// One shared 0→1 loop per <ShimmerGroup> so every block on a skeleton
// screen sweeps in phase (staggered sweeps read as flicker, not loading).
const ShimmerContext = createContext<SharedValue<number> | null>(null);

export function ShimmerGroup({ children }: { children: React.ReactNode }) {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = 0;
    progress.value = withRepeat(
      withTiming(1, { duration: SWEEP_DURATION_MS, easing: Easing.inOut(Easing.ease) }),
      -1,
      false,
    );
    return () => cancelAnimation(progress);
  }, [progress]);

  return <ShimmerContext.Provider value={progress}>{children}</ShimmerContext.Provider>;
}

type BlockProps = {
  style?: StyleProp<ViewStyle>;
};

/**
 * A skeleton block with a light band sweeping across it. Drop-in
 * replacement for the previous static `backgroundColor: colors.skeleton`
 * views. Must render inside a <ShimmerGroup>.
 */
export function ShimmerBlock({ style }: BlockProps) {
  const { colors, isDark } = useTheme();
  const progress = useContext(ShimmerContext);
  const { width: screenWidth } = useWindowDimensions();
  const [blockWidth, setBlockWidth] = useState(0);

  // Sweep across the full screen width so blocks at different x positions
  // still appear lit by one band moving over the whole card.
  const sweepStyle = useAnimatedStyle(() => {
    if (!progress) return { opacity: 0 };
    const travel = screenWidth + SWEEP_WIDTH * 2;
    return {
      opacity: 1,
      transform: [{ translateX: -SWEEP_WIDTH + progress.value * travel }],
    };
  });

  const highlight = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.55)';

  return (
    <View
      style={[styles.block, { backgroundColor: colors.skeleton }, style]}
      onLayout={(e) => {
        const w = e.nativeEvent.layout.width;
        setBlockWidth((prev) => (prev === w ? prev : w));
      }}
    >
      {blockWidth > 0 && (
        <AnimatedGradient
          pointerEvents="none"
          colors={['transparent', highlight, 'transparent']}
          start={{ x: 0, y: 0.4 }}
          end={{ x: 1, y: 0.6 }}
          style={[styles.sweep, sweepStyle]}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    overflow: 'hidden',
  },
  sweep: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    width: SWEEP_WIDTH,
  },
});
