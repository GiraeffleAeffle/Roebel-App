import React, { createContext, useContext, useRef, type RefObject } from 'react';
import { Platform, StyleSheet, View, type ViewProps } from 'react-native';
import { BlurView, BlurTargetView } from 'expo-blur';
import { requireOptionalNativeModule } from 'expo';
import { useTheme } from '@/context/ThemeContext';

// Real frosted glass, not lowered opacity: a backdrop blur with the iOS
// "chrome" material tint (the material system bars use — heavily frosted
// yet ~80-90% opaque) and a light hairline edge where the glass meets the
// content. iOS blurs the layer beneath natively; Android (SDK 55+ stable
// blur) samples a BlurTargetView that must wrap the scrolling content —
// see <GlassBackdrop>. Android < 12 gracefully degrades to the tinted
// semi-transparent fill inside expo-blur itself.

// An EAS Update could ship this JS into a binary built without the
// expo-blur native module — same guard pattern as PagerView in FeedHome.
const BLUR_AVAILABLE = (() => {
  try {
    return requireOptionalNativeModule('ExpoBlur') != null;
  } catch {
    return false;
  }
})();

const GlassTargetContext = createContext<RefObject<View | null> | null>(null);

/**
 * Wraps the scrollable content that glass chrome floats over. On Android
 * this is the surface the frost samples its pixels from; on iOS and web
 * it's a plain View passthrough. Every screen using <GlassSurface /> must
 * render its content inside one of these — and the glass bars OUTSIDE it,
 * after it in JSX order.
 */
export function GlassBackdrop({ children, style, ...rest }: ViewProps) {
  const ref = useRef<View>(null);
  // Android: plain View — no BlurTargetView RenderNode capture while the
  // backdrop blur is disabled (see the platform branch in GlassSurface).
  if (Platform.OS !== 'ios') {
    return (
      <View style={style} {...rest}>
        {children}
      </View>
    );
  }
  return (
    <GlassTargetContext.Provider value={ref}>
      <BlurTargetView ref={ref} style={style} {...rest}>
        {children}
      </BlurTargetView>
    </GlassTargetContext.Provider>
  );
}

/** The light rim where a glass edge catches light — also usable as a borderColor. */
export function glassEdgeColor(isDark: boolean): string {
  return isDark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.09)';
}

type Props = {
  /** Blur strength 1-100. 100 = the authentic system material. */
  intensity?: number;
  /** Which edge of the bar meets the content — draws the light hairline there. */
  edge?: 'top' | 'bottom' | 'none';
};

/**
 * Absolute-fill frosted-glass background. Render as the FIRST child of a
 * bar/pill (siblings paint above it); the container itself must stay
 * transparent and, for rounded shapes, clip with overflow:'hidden'.
 */
export default function GlassSurface({ intensity = 100, edge = 'none' }: Props) {
  const { colors, isDark } = useTheme();
  const target = useContext(GlassTargetContext);

  const edgeLine =
    edge === 'none' ? null : (
      <View
        pointerEvents="none"
        style={[
          styles.edge,
          edge === 'top' ? styles.edgeTop : styles.edgeBottom,
          { backgroundColor: glassEdgeColor(isDark) },
        ]}
      />
    );

  const tint = isDark ? 'systemChromeMaterialDark' : 'systemChromeMaterial';

  // Android backdrop blur is disabled: the RenderNode snapshot of a
  // BlurTargetView full of expo-image/video surfaces crashes the feed on
  // physical devices (Pixel confirmed 2026-08-23) while emulators render it
  // fine — same class as expo/expo#24572. Android keeps the tinted fill +
  // edge line below until the blur can be gated per-device safely.
  if (BLUR_AVAILABLE && Platform.OS === 'ios') {
    return (
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <BlurView
          style={StyleSheet.absoluteFill}
          intensity={intensity}
          tint={tint}
          // Android-only props; ignored on iOS. Blurs the GlassBackdrop
          // beneath via RenderNode on Android 12+, tinted fill below that.
          blurMethod="dimezisBlurViewSdk31Plus"
          blurTarget={target ?? undefined}
        />
        {edgeLine}
      </View>
    );
  }

  // No native blur available (old binary, web, Android outside a
  // GlassBackdrop): translucent solid keeps the chrome legible.
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <View
        style={[
          StyleSheet.absoluteFill,
          { backgroundColor: hexToRgba(colors.background, 0.96) },
        ]}
      />
      {edgeLine}
    </View>
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

const styles = StyleSheet.create({
  edge: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
  },
  edgeTop: {
    top: 0,
  },
  edgeBottom: {
    bottom: 0,
  },
});
