/**
 * Full-screen first-launch DSGVO consent modal.
 * Mounted in the root stack with `presentation: 'fullScreenModal'`,
 * `animation: 'fade'`, `gestureEnabled: false`.
 *
 * Three CTAs: "Alle akzeptieren" (recommended), "Anpassen" (deep-link to
 * customize screen), "Nur Notwendig". Copy is motivational but DSGVO-honest:
 * we lead with EU residency, transparency and one-tap reversibility.
 */

import React from 'react';
import {
  Image,
  Linking,
  Pressable,
  ScrollView,
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

const AGB_URL = 'https://www.roebel.app/agb';
const DATENSCHUTZ_URL = 'https://www.roebel.app/datenschutz';

export default function ConsentModalScreen() {
  const { colors } = useTheme();
  const { acceptAll, acceptEssential } = useConsent();
  const router = useRouter();
  const account = useActiveAccount();
  const { user } = useUser();

  const handleAcceptAll = async () => {
    await acceptAll('first_launch');
    // Accepting the policy IS the public-record consent (the changelog names
    // it). Remember it, and enroll verified Citizens silently in the
    // background; everyone else enrolls via self-heal once verified.
    void import('@/lib/nostr/enroll')
      .then(async ({ markPublicRecordConsent, enrollNow }) => {
        await markPublicRecordConsent();
        if (user?.is_verified_citizen && account) await enrollNow(account);
      })
      .catch(() => {});
    if (router.canGoBack()) router.back();
    else router.replace('/' as any);
  };

  const handleEssentialOnly = async () => {
    await acceptEssential('first_launch');
    if (router.canGoBack()) router.back();
    else router.replace('/' as any);
  };

  const handleCustomize = () => {
    router.push('/settings/consent' as any);
  };

  const openUrl = (url: string) => {
    Linking.openURL(url).catch(() => {
      // ignore
    });
  };

  return (
    <SafeAreaView
      style={[styles.safeArea, { backgroundColor: colors.background }]}
      edges={['top', 'left', 'right', 'bottom']}
    >
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.illustrationFrame}>
          <Image
            source={require('../assets/illustration/consent/consent.png')}
            style={styles.illustration}
            resizeMode="contain"
            accessibilityIgnoresInvertColors
          />
        </View>

        <Text style={[styles.eyebrow, { color: colors.textSecondary }]}>Datenschutz</Text>
        <Text style={[styles.headline, { color: colors.textPrimary }]}>
          Du behältst die Kontrolle.
        </Text>
        <Text style={[styles.lede, { color: colors.textSecondary }]}>
          Wir bauen Röbel als gemeinnützige Plattform für deine Stadt — und wir möchten dir
          transparent zeigen, wie wir mit deinen Daten umgehen.
        </Text>

        <View style={styles.bullets}>
          <Bullet color={colors.primary} text="Deine Daten bleiben in der EU, wann immer möglich." />
          <Bullet color={colors.primary} text="Du kannst jede Einstellung jederzeit ändern — mit einem Tipp." />
          <Bullet color={colors.primary} text="Nichts wird ohne deine Zustimmung weitergegeben." />
        </View>

        <Text style={[styles.subnote, { color: colors.textTertiary }]}>
          Mit „Alle akzeptieren" hilfst du uns, die App für dich und deine Stadt zu verbessern —
          durch anonymisierte Statistik, schnellere Bugfixes, einen klügeren Mecky und Karten, die
          dir Veranstaltungen in deiner Nähe zeigen.
        </Text>

        <View style={styles.linksRow}>
          <Pressable onPress={() => openUrl(AGB_URL)} accessibilityRole="link">
            <Text style={[styles.link, { color: colors.textSecondary }]}>AGB</Text>
          </Pressable>
          <Text style={[styles.linkSep, { color: colors.textTertiary }]}>·</Text>
          <Pressable onPress={() => openUrl(DATENSCHUTZ_URL)} accessibilityRole="link">
            <Text style={[styles.link, { color: colors.textSecondary }]}>Datenschutzerklärung</Text>
          </Pressable>
        </View>
      </ScrollView>

      <View style={[styles.footer, { borderTopColor: colors.border }]}>
        <Pressable
          onPress={handleAcceptAll}
          style={[styles.primaryButton, { backgroundColor: colors.primary }]}
          accessibilityRole="button"
        >
          <Text style={[styles.primaryLabel, { color: colors.onPrimary }]}>
            Alle akzeptieren
          </Text>
        </Pressable>
        <Pressable
          onPress={handleCustomize}
          style={[styles.secondaryButton, { borderColor: colors.borderSecondary }]}
          accessibilityRole="button"
        >
          <Text style={[styles.secondaryLabel, { color: colors.textPrimary }]}>Anpassen</Text>
        </Pressable>
        <Pressable
          onPress={handleEssentialOnly}
          style={styles.tertiaryButton}
          accessibilityRole="button"
        >
          <Text style={[styles.tertiaryLabel, { color: colors.textSecondary }]}>
            Nur Notwendige
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

function Bullet({ text, color }: { text: string; color: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.bulletRow}>
      <View style={[styles.bulletDot, { backgroundColor: color }]} />
      <Text style={[styles.bulletText, { color: colors.textPrimary }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 24,
  },
  illustrationFrame: {
    width: '100%',
    borderRadius: 24,
    backgroundColor: '#E4F2FF',
    overflow: 'hidden',
    marginBottom: 24,
  },
  illustration: {
    width: '100%',
    height: 220,
  },
  eyebrow: {
    fontSize: 13,
    fontFamily: 'Inter-Medium',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  headline: {
    fontSize: 28,
    fontFamily: 'Inter-Bold',
    lineHeight: 34,
    marginBottom: 12,
  },
  lede: {
    fontSize: 15,
    fontFamily: 'Inter-Regular',
    lineHeight: 22,
    marginBottom: 24,
  },
  bullets: {
    gap: 12,
    marginBottom: 24,
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  bulletDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginTop: 8,
  },
  bulletText: {
    flex: 1,
    fontSize: 15,
    fontFamily: 'Inter-Medium',
    lineHeight: 22,
  },
  subnote: {
    fontSize: 13,
    fontFamily: 'Inter-Regular',
    lineHeight: 19,
  },
  footer: {
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  primaryButton: {
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
  },
  primaryLabel: {
    fontSize: 15,
    fontFamily: 'Inter-SemiBold',
  },
  secondaryButton: {
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  secondaryLabel: {
    fontSize: 15,
    fontFamily: 'Inter-Medium',
  },
  tertiaryButton: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  tertiaryLabel: {
    fontSize: 14,
    fontFamily: 'Inter-Medium',
  },
  linksRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 16,
  },
  link: {
    fontSize: 13,
    fontFamily: 'Inter-Medium',
    textDecorationLine: 'underline',
  },
  linkSep: {
    fontSize: 13,
  },
});
