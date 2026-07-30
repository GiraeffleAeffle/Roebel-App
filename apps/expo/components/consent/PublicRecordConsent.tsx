/**
 * Full-screen consent for the public record (Nostr), shown to verified
 * Citizens who have not enrolled yet.
 *
 * The rules, exactly as decided:
 *  - triggered for every Citizen until accepted;
 *  - accepted once → never appears again (the enrollment IS the stored
 *    acceptance: a timestamped, wallet-signed binding — a stronger DSGVO
 *    consent artifact than any checkbox log, because the user's own key
 *    attests to it);
 *  - "Später" defers to the next app launch. Deliberately "later", never a
 *    hard "no": consent must stay freely given, so declining costs nothing
 *    and the question simply returns another day.
 *
 * On accept everything is invisible: one silent smart-account signature,
 * derivation, registration, then the historic backfill starts. No keys, no
 * npub, no protocol vocabulary.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useActiveAccount } from 'thirdweb/react';
import { useRouter } from 'expo-router';
import { useTheme } from '@/context/ThemeContext';
import { useUser } from '@/context/UserContext';
import { fontFamily } from '@/constants/theme';

/** One prompt per app launch — "Später" means later, not "ask again now". */
let promptedThisLaunch = false;

const POINTS: { title: string; body: string }[] = [
  {
    title: 'Von dir unterschrieben',
    body: 'Deine öffentlichen Beiträge werden mit deinem persönlichen Schlüssel signiert — sie stammen nachweisbar von dir und können nicht verändert werden.',
  },
  {
    title: 'Offen für alle',
    body: 'Beiträge werden Teil des öffentlichen Datenbestands von Röbel. Auch andere Apps und Städte können sie lesen — unabhängig von der Röbel App.',
  },
  {
    title: 'Dauerhaft öffentlich',
    body: 'Eine Löschung kann angefragt, aber nicht überall erzwungen werden. Veröffentliche nur, was dauerhaft öffentlich bleiben darf.',
  },
];

export function PublicRecordConsent() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useUser();
  const account = useActiveAccount();

  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (promptedThisLaunch || visible) return;
    if (!user?.is_verified_citizen || !account?.address) return;
    let cancelled = false;
    // Give startup (auth hydration, other gates) a moment before taking the screen.
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const { getRegisteredAt } = await import('@/lib/nostr/identity');
          if (await getRegisteredAt()) return; // accepted before — never again
          if (!cancelled && !promptedThisLaunch) {
            promptedThisLaunch = true;
            setVisible(true);
          }
        } catch {
          // cannot determine state — do not block the user
        }
      })();
    }, 2500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [user?.is_verified_citizen, account?.address, visible]);

  const onAccept = useCallback(async () => {
    if (busy || !account) return;
    setBusy(true);
    try {
      const { ensureIdentitySilently, getRegisteredAt } = await import('@/lib/nostr/identity');
      await ensureIdentitySilently(account);
      if (await getRegisteredAt()) {
        // Enrollment succeeded — start migrating their history onto the record.
        const { retryPendingPublications } = await import('@/lib/nostr/publish');
        void retryPendingPublications(account.address).catch(() => {});
      }
      // If enrollment failed (offline, relay down) the registration is absent,
      // so the prompt simply returns next launch. No error screen needed.
    } catch {
      // same: next launch retries
    } finally {
      setBusy(false);
      setVisible(false);
    }
  }, [busy, account]);

  const onLater = useCallback(() => {
    if (busy) return;
    setVisible(false);
  }, [busy]);

  if (!visible) return null;

  return (
    <Modal visible transparent={false} animationType="slide" onRequestClose={onLater}>
      <View
        style={[
          styles.container,
          { backgroundColor: colors.background, paddingTop: insets.top + 32, paddingBottom: insets.bottom + 16 },
        ]}
      >
        <View style={styles.content}>
          <Text style={[styles.kicker, { color: colors.textSecondary }]}>NEU IN RÖBEL</Text>
          <Text style={[styles.title, { color: colors.textPrimary }]}>
            Dein öffentlicher Datenbestand
          </Text>
          <Text style={[styles.lede, { color: colors.textSecondary }]}>
            Röbel betreibt einen eigenen, offenen Datenbestand für öffentliche Beiträge. Als
            Bürger:in kannst du Teil davon werden.
          </Text>

          {POINTS.map((point) => (
            <View key={point.title} style={styles.point}>
              <Text style={[styles.pointTitle, { color: colors.textPrimary }]}>{point.title}</Text>
              <Text style={[styles.pointBody, { color: colors.textSecondary }]}>{point.body}</Text>
            </View>
          ))}

          <Pressable
            onPress={() => {
              setVisible(false);
              router.push('/settings/nostr' as never);
            }}
            disabled={busy}
          >
            <Text style={[styles.detailsLink, { color: colors.primary }]}>
              Mehr Details und Einstellungen
            </Text>
          </Pressable>
        </View>

        <View style={styles.actions}>
          <Pressable
            onPress={onAccept}
            disabled={busy}
            style={[styles.primaryButton, { backgroundColor: colors.primary, opacity: busy ? 0.7 : 1 }]}
          >
            {busy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.primaryText}>Einverstanden</Text>
            )}
          </Pressable>
          <Pressable onPress={onLater} disabled={busy} style={styles.secondaryButton}>
            <Text style={[styles.secondaryText, { color: colors.textSecondary }]}>Später</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 24, justifyContent: 'space-between' },
  content: { flex: 1, justifyContent: 'center', gap: 14 },
  kicker: { fontFamily: fontFamily.medium, fontSize: 12, letterSpacing: 1 },
  title: { fontFamily: fontFamily.heading, fontSize: 30, lineHeight: 35 },
  lede: { fontFamily: fontFamily.regular, fontSize: 15, lineHeight: 22, marginBottom: 8 },
  point: { gap: 2, marginTop: 6 },
  pointTitle: { fontFamily: fontFamily.semiBold, fontSize: 15 },
  pointBody: { fontFamily: fontFamily.regular, fontSize: 14, lineHeight: 20 },
  detailsLink: { fontFamily: fontFamily.medium, fontSize: 14, marginTop: 14 },
  actions: { gap: 10, marginTop: 16 },
  primaryButton: {
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: { color: '#fff', fontFamily: fontFamily.semiBold, fontSize: 16 },
  secondaryButton: { paddingVertical: 12, alignItems: 'center' },
  secondaryText: { fontFamily: fontFamily.medium, fontSize: 15 },
});
