/**
 * Bottom sheet shown when the stored policy version differs from the current
 * PRIVACY_POLICY_VERSION. Lists the diff from POLICY_CHANGELOG and asks the
 * user to either confirm or open the customize screen to review.
 */

import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '@/context/ThemeContext';
import { useConsent } from '@/context/ConsentContext';
import { useActiveAccount } from 'thirdweb/react';
import { useUser } from '@/context/UserContext';
import { POLICY_CHANGELOG, PRIVACY_POLICY_VERSION } from '@/constants/consent';

export function ConsentReconsentSheet() {
  const { needsReconsent, confirmReconsent } = useConsent();
  const { colors } = useTheme();
  const router = useRouter();
  const account = useActiveAccount();
  const { user } = useUser();

  // Confirming the new policy version IS the public-record consent — the
  // changelog bullet names it. Enrollment runs silently after.
  const chainPublicRecord = () => {
    void import('@/lib/nostr/enroll')
      .then(async ({ markPublicRecordConsent, enrollNow }) => {
        await markPublicRecordConsent();
        if (user?.is_verified_citizen && account) await enrollNow(account);
      })
      .catch(() => {});
  };
  const fade = useRef(new Animated.Value(0)).current;
  const translate = useRef(new Animated.Value(40)).current;

  useEffect(() => {
    if (!needsReconsent) return;
    Animated.parallel([
      Animated.timing(fade, { toValue: 1, duration: 220, useNativeDriver: true }),
      Animated.timing(translate, { toValue: 0, duration: 240, useNativeDriver: true }),
    ]).start();
  }, [needsReconsent, fade, translate]);

  const bullets = POLICY_CHANGELOG[PRIVACY_POLICY_VERSION] ?? [];

  if (!needsReconsent) return null;

  const handleConfirm = async () => {
    await confirmReconsent();
    chainPublicRecord();
  };

  const handleCustomize = async () => {
    await confirmReconsent();
    chainPublicRecord();
    router.push('/settings/consent' as any);
  };

  return (
    <Modal visible animationType="none" transparent statusBarTranslucent>
      <Animated.View style={[styles.backdrop, { opacity: fade }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={handleConfirm} />
        <Animated.View
          style={[
            styles.sheet,
            { backgroundColor: colors.background, transform: [{ translateY: translate }] },
          ]}
        >
          <SafeAreaView edges={['bottom']}>
            <View style={[styles.handle, { backgroundColor: colors.border }]} />
            <Text style={[styles.eyebrow, { color: colors.textSecondary }]}>Update</Text>
            <Text style={[styles.headline, { color: colors.textPrimary }]}>
              Wir haben unseren Datenschutz aktualisiert.
            </Text>
            <Text style={[styles.intro, { color: colors.textSecondary }]}>
              Was sich in Version {PRIVACY_POLICY_VERSION} geändert hat:
            </Text>
            <View style={styles.bullets}>
              {bullets.map((b, i) => (
                <View key={i} style={styles.bulletRow}>
                  <Text style={[styles.bulletDot, { color: colors.primary }]}>•</Text>
                  <Text style={[styles.bulletText, { color: colors.textPrimary }]}>{b}</Text>
                </View>
              ))}
            </View>
            <Pressable
              onPress={handleConfirm}
              style={[styles.primary, { backgroundColor: colors.primary }]}
              accessibilityRole="button"
            >
              <Text style={[styles.primaryLabel, { color: colors.onPrimary }]}>
                Bestätigen
              </Text>
            </Pressable>
            <Pressable
              onPress={handleCustomize}
              style={styles.secondary}
              accessibilityRole="button"
            >
              <Text style={[styles.secondaryLabel, { color: colors.textSecondary }]}>
                Einstellungen anpassen
              </Text>
            </Pressable>
          </SafeAreaView>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1,
    shadowRadius: 16,
    elevation: 16,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    marginBottom: 20,
  },
  eyebrow: {
    fontSize: 13,
    fontFamily: 'Inter-Medium',
    marginBottom: 6,
  },
  headline: {
    fontSize: 22,
    fontFamily: 'Inter-SemiBold',
    lineHeight: 28,
    marginBottom: 12,
  },
  intro: {
    fontSize: 14,
    fontFamily: 'Inter-Regular',
    lineHeight: 20,
    marginBottom: 12,
  },
  bullets: {
    gap: 8,
    marginBottom: 24,
  },
  bulletRow: {
    flexDirection: 'row',
    gap: 8,
  },
  bulletDot: {
    fontSize: 16,
    lineHeight: 20,
  },
  bulletText: {
    flex: 1,
    fontSize: 14,
    fontFamily: 'Inter-Regular',
    lineHeight: 20,
  },
  primary: {
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
    marginBottom: 8,
  },
  primaryLabel: {
    fontSize: 15,
    fontFamily: 'Inter-Medium',
  },
  secondary: {
    paddingVertical: 14,
    alignItems: 'center',
  },
  secondaryLabel: {
    fontSize: 14,
    fontFamily: 'Inter-Medium',
  },
});
