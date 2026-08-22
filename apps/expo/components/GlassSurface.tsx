import React from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { useTheme } from '@/context/ThemeContext';

// High-opacity glass: the surface reads as solid chrome, but content
// scrolling beneath it shimmers through just enough to feel layered.
// iOS gets a real backdrop blur; Android skips the blur (the experimental
// dimezis method costs frames on scroll-heavy screens) and uses a slightly
// more opaque tint instead so text on top stays legible.
const IOS_TINT_ALPHA = 0.85;
const ANDROID_TINT_ALPHA = 0.96;

type Props = {
  /** Blur strength on iOS. Ignored on Android. */
  intensity?: number;
};

/**
 * Absolute-fill glass background. Render as the FIRST child of a container
 * (siblings paint above it). The container itself must stay transparent.
 */
export default function GlassSurface({ intensity = 50 }: Props) {
  const { colors, isDark } = useTheme();

  if (Platform.OS === 'ios') {
    return (
      <BlurView
        pointerEvents="none"
        style={StyleSheet.absoluteFill}
        intensity={intensity}
        tint={isDark ? 'dark' : 'light'}
      >
        <View
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: hexToRgba(colors.background, IOS_TINT_ALPHA) },
          ]}
        />
      </BlurView>
    );
  }

  return (
    <View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFill,
        { backgroundColor: hexToRgba(colors.background, ANDROID_TINT_ALPHA) },
      ]}
    />
  );
}

function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace('#', '');
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  if ([r, g, b].some(Number.isNaN)) return hex;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
