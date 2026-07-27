import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import { useRouter } from 'expo-router';
import { useActiveAccount } from 'thirdweb/react';
import { useTheme } from '@/context/ThemeContext';
import ChevronLeftIcon from '@/assets/icons/chevron-left.svg';
import {
  type NostrIdentity,
  clearIdentity,
  deriveAndStoreIdentity,
  getRegisteredAt,
  loadStoredIdentity,
} from '@/lib/nostr/identity';
import { registerIdentity } from '@/lib/nostr/identity';
import { publishProfile, readFromRelay } from '@/lib/nostr/publish';

/**
 * Nostr-Identität — the Citizen-facing half of the identity bridge.
 *
 * Opt-in on purpose. Publishing to a public, append-only relay is effectively
 * irreversible, so nothing is published until the Citizen asks for it here, and
 * the copy says plainly what that means.
 */

type Status = 'loading' | 'none' | 'registered' | 'active';

export default function NostrIdentityScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const account = useActiveAccount();

  const [status, setStatus] = useState<Status>('loading');
  const [identity, setIdentity] = useState<NostrIdentity | null>(null);
  const [busy, setBusy] = useState(false);
  const [relayCount, setRelayCount] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    const stored = await loadStoredIdentity();
    setIdentity(stored);
    if (!stored) {
      setStatus('none');
      return;
    }
    const registeredAt = await getRegisteredAt();
    setStatus(registeredAt ? 'registered' : 'none');

    // The relay is the authority on whether writing works — if our own events
    // are readable back off it, access is genuinely active.
    const events = await readFromRelay([stored.publicKey]);
    setRelayCount(events.length);
    if (events.length > 0) setStatus('active');
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onCreate = useCallback(async () => {
    if (!account) return;
    setBusy(true);
    try {
      const derived = await deriveAndStoreIdentity(account);
      setIdentity(derived);
      const result = await registerIdentity(account, derived);
      Alert.alert(result.ok ? 'Nostr-Identität erstellt' : 'Registrierung fehlgeschlagen', result.message);
      if (result.ok) await publishProfile({}, derived);
      await refresh();
    } catch {
      Alert.alert('Fehler', 'Die Nostr-Identität konnte nicht erstellt werden.');
    } finally {
      setBusy(false);
    }
  }, [account, refresh]);

  const onRemove = useCallback(() => {
    Alert.alert(
      'Nostr-Identität entfernen?',
      'Der Schlüssel wird von diesem Gerät gelöscht. Bereits veröffentlichte Beiträge bleiben auf dem Relay — eine Löschung kann nur angefragt, nicht erzwungen werden.',
      [
        { text: 'Abbrechen', style: 'cancel' },
        {
          text: 'Entfernen',
          style: 'destructive',
          onPress: async () => {
            await clearIdentity();
            setIdentity(null);
            setRelayCount(null);
            setStatus('none');
          },
        },
      ],
    );
  }, []);

  const statusLabel = {
    loading: 'Wird geladen …',
    none: 'Nicht eingerichtet',
    registered: 'Registriert — wartet auf Relay-Zugang',
    active: 'Aktiv',
  }[status];

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <ChevronLeftIcon width={24} height={24} color={colors.textPrimary} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>Nostr-Identität</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={[styles.card, { backgroundColor: colors.surface }]}>
          <Text style={[styles.label, { color: colors.textSecondary }]}>STATUS</Text>
          <Text style={[styles.value, { color: colors.textPrimary }]}>{statusLabel}</Text>
          {relayCount !== null && (
            <Text style={[styles.hint, { color: colors.textSecondary }]}>
              {relayCount} {relayCount === 1 ? 'Beitrag' : 'Beiträge'} auf dem Röbel-Relay.
            </Text>
          )}
        </View>

        {identity && (
          <Pressable
            style={[styles.card, { backgroundColor: colors.surface }]}
            onPress={async () => {
              await Clipboard.setStringAsync(identity.npub);
              Alert.alert('Kopiert', 'Deine öffentliche Nostr-Adresse wurde kopiert.');
            }}
          >
            <Text style={[styles.label, { color: colors.textSecondary }]}>ÖFFENTLICHE ADRESSE</Text>
            <Text style={[styles.npub, { color: colors.textPrimary }]} numberOfLines={2}>
              {identity.npub}
            </Text>
            <Text style={[styles.hint, { color: colors.textSecondary }]}>Zum Kopieren tippen.</Text>
          </Pressable>
        )}

        <View style={[styles.card, { backgroundColor: colors.surface }]}>
          <Text style={[styles.label, { color: colors.textSecondary }]}>WAS DAS BEDEUTET</Text>
          <Text style={[styles.body, { color: colors.textPrimary }]}>
            Deine Nostr-Identität gehört dir. Der private Schlüssel wird aus deinem Wallet
            abgeleitet und bleibt auf diesem Gerät — Röbel speichert ihn nicht und kann nicht in
            deinem Namen schreiben.
          </Text>
          <Text style={[styles.body, { color: colors.textPrimary, marginTop: 12 }]}>
            Beiträge, die du veröffentlichst, liegen öffentlich und dauerhaft auf dem Röbel-Relay.
            Jede App und jeder Agent kann sie lesen. Eine Löschung lässt sich anfragen, aber nicht
            erzwingen — veröffentliche hier nur, was öffentlich bleiben darf.
          </Text>
          <Text style={[styles.body, { color: colors.textPrimary, marginTop: 12 }]}>
            Schreibrechte haben ausschließlich Bürger mit Bürger-NFT. Nach der Registrierung dauert
            die Freischaltung wenige Minuten.
          </Text>
        </View>

        {status === 'none' && (
          <Pressable
            style={[styles.primaryButton, { backgroundColor: colors.primary, opacity: account && !busy ? 1 : 0.5 }]}
            disabled={!account || busy}
            onPress={onCreate}
          >
            {busy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.primaryButtonText}>Nostr-Identität erstellen</Text>
            )}
          </Pressable>
        )}

        {identity && (
          <Pressable style={styles.secondaryButton} onPress={onRemove}>
            <Text style={[styles.secondaryButtonText, { color: colors.error ?? '#D14343' }]}>
              Identität von diesem Gerät entfernen
            </Text>
          </Pressable>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  headerTitle: { fontFamily: 'Inter-SemiBold', fontSize: 17 },
  content: { padding: 16, gap: 16, paddingBottom: 48 },
  card: { borderRadius: 16, padding: 16 },
  label: { fontFamily: 'Inter-Medium', fontSize: 11, letterSpacing: 0.5, marginBottom: 6 },
  value: { fontFamily: 'Inter-SemiBold', fontSize: 16 },
  npub: { fontFamily: 'GeistMono-Regular', fontSize: 13, lineHeight: 19 },
  body: { fontFamily: 'Inter-Regular', fontSize: 14, lineHeight: 21 },
  hint: { fontFamily: 'Inter-Regular', fontSize: 12, marginTop: 8 },
  primaryButton: { borderRadius: 999, paddingVertical: 15, alignItems: 'center' },
  primaryButtonText: { fontFamily: 'Inter-SemiBold', fontSize: 15, color: '#fff' },
  secondaryButton: { paddingVertical: 12, alignItems: 'center' },
  secondaryButtonText: { fontFamily: 'Inter-Medium', fontSize: 14 },
});
