import React, { useEffect, useRef } from 'react';
import { Animated, Dimensions, Easing, StyleSheet } from 'react-native';
import { SvgXml } from 'react-native-svg';

const NAVY = '#00498B';

// The official Röbel windmill mark (master: apps/web/public/favicon.svg), with
// the navy backdrop + metadata stripped so only the white ring + windmill render.
// Kept as vector (SvgXml) so the logo is razor-sharp at any density or scale.
const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" fill="none"><rect x="73.084" y="73.086" width="365.829" height="365.829" rx="182.914" stroke="white" stroke-width="36.4571"/><path d="M139.084 277.371H91.3125C96.5506 332.056 136.947 441.428 256.627 441.428C376.307 441.428 414.189 344.628 418.17 296.228L392.398 290.571L360.97 163.599L334.57 290.571V332.685H291.827C289.941 325.352 286.044 310.308 285.541 308.799C285.038 307.291 285.751 307.333 286.17 307.542L294.341 315.714L314.455 296.228L277.998 261.028L313.827 225.199L293.713 205.085L262.913 234.628C261.865 233.999 259.141 232.742 256.627 232.742C254.113 232.742 250.97 233.999 249.713 234.628L220.17 205.085L197.541 225.199L235.255 260.399L198.17 296.228L219.541 316.971C221.846 314.456 226.707 309.302 227.713 308.799C228.718 308.296 228.97 309.009 228.97 309.428L223.312 332.685H181.198C179.187 303.519 174.074 246.361 171.77 221.428L157.312 162.971L143.484 221.428L139.084 277.371Z" fill="white"/></svg>`;

// Screen-width-relative so the logo lands at roughly the native splash size at
// scale 1 (seamless hand-off), then the animation grows it "a bit bigger".
const { width: SCREEN_W } = Dimensions.get('window');
const LOGO_SIZE = Math.round(SCREEN_W * 0.5);

/**
 * AnimatedSplash — a full-screen overlay that renders on top of (and seamlessly
 * continues from) the native expo-splash-screen. Same navy background + the same
 * white windmill mark, so there is no visible jump when the native splash hides.
 * Then it:
 *   1. gently scales the logo up a touch (a bit bigger than the native splash),
 *   2. fades in "Röbel App" at the centered bottom in small text,
 *   3. fades the whole overlay out to reveal the app.
 *
 * `onFinish` fires once the exit fade completes so the parent can unmount it.
 */
export default function AnimatedSplash({ onFinish }: { onFinish: () => void }) {
  // Start at 1.0 so the logo matches the native splash size at mount, then grow.
  const logoScale = useRef(new Animated.Value(1)).current;
  const textOpacity = useRef(new Animated.Value(0)).current;
  const textShift = useRef(new Animated.Value(8)).current;
  const overlayOpacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    // Forced total kept to 600ms (350 logo fade + 0 dwell + 250 fade-out) —
    // the text fade-in shares the 350ms window (60ms delay + 220ms duration,
    // finishing before the logo step ends) so it never extends the sequence.
    Animated.sequence([
      Animated.parallel([
        Animated.timing(logoScale, {
          toValue: 1.12,
          duration: 350,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(textOpacity, {
          toValue: 1,
          duration: 220,
          delay: 60,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(textShift, {
          toValue: 0,
          duration: 220,
          delay: 60,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
      Animated.timing(overlayOpacity, {
        toValue: 0,
        duration: 250,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (finished) onFinish();
    });
  }, [logoScale, textOpacity, textShift, overlayOpacity, onFinish]);

  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.overlay, { opacity: overlayOpacity }]}
    >
      <Animated.View style={{ transform: [{ scale: logoScale }] }}>
        <SvgXml xml={LOGO_SVG} width={LOGO_SIZE} height={LOGO_SIZE} />
      </Animated.View>
      <Animated.Text
        style={[
          styles.wordmark,
          { opacity: textOpacity, transform: [{ translateY: textShift }] },
        ]}
      >
        Röbel App
      </Animated.Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: NAVY,
    alignItems: 'center',
    justifyContent: 'center',
  },
  wordmark: {
    position: 'absolute',
    bottom: 64,
    fontFamily: 'MonaSans-Medium',
    fontSize: 15,
    letterSpacing: 0.5,
    color: 'rgba(255, 255, 255, 0.92)',
  },
});
