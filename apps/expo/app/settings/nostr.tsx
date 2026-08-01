import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  LayoutAnimation,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  UIManager,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import { Linking } from 'react-native';
import { useRouter } from 'expo-router';
import { useActiveAccount } from 'thirdweb/react';
import { useTheme } from '@/context/ThemeContext';
import { useUser } from '@/context/UserContext';
import { balanceOf } from 'thirdweb/extensions/erc721';
import { citizenNFTGnosisContract } from '@/constants/gnosis';
import { fontFamily } from '@/constants/theme';
import ChevronLeftIcon from '@/assets/icons/chevron-left.svg';
import {
  type NostrIdentity,
  clearIdentity,
  deriveAndStoreIdentity,
  getRegisteredAt,
  loadStoredIdentity,
  registerIdentity,
} from '@/lib/nostr/identity';
import { publishProfile, readFromRelay } from '@/lib/nostr/publish';
import { nsecEncode } from '@netizen-labs/nostr';
import { fetchBuzzWorkspaceEnabled } from '@/lib/supabase-app-settings';

/**
 * Nostr-Identität — onboarding for the identity bridge.
 *
 * Opt-in by design. Publishing to a public, append-only relay is effectively
 * irreversible, so nothing leaves the device until the Citizen asks for it here
 * and has been told, in plain German, what that actually means.
 *
 * The screen is built around the real three-step progression (create → unlock →
 * active) because that sequence is genuine: each step has a distinct state the
 * Citizen is actually waiting on. Everything else stays quiet.
 */

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

type Stage = 'loading' | 'new' | 'waiting' | 'active';

/**
 * How often to re-check relay access while this screen is open.
 *
 * The allow-list syncer on the node runs on its own schedule (~2 min), so there
 * is nothing to poll faster than. It keeps checking for as long as the screen is
 * open rather than giving up after N tries — a spinner that silently stops is
 * worse than one that keeps its promise.
 */
const POLL_INTERVAL_MS = 20_000;

const EXPLAINERS: { question: string; answer: string }[] = [
  {
    question: 'Was ist das überhaupt?',
    answer:
      'Röbel betreibt einen eigenen kleinen Server für öffentliche Beiträge — ein sogenanntes Relay. Deine Nostr-Identität ist dein Ausweis darauf. Beiträge, die du damit unterschreibst, kann jede andere App lesen und überprüfen: Sie stammen nachweisbar von dir und wurden nicht verändert.',
  },
  {
    question: 'Was habe ich davon?',
    answer:
      'Deine Beiträge hängen nicht mehr allein an der Röbel-App. Andere Städte, andere Programme und KI-Assistenten können sie lesen, ohne dass jemand dazwischen sitzt. Wenn du die App irgendwann nicht mehr nutzt, bleiben deine Beiträge trotzdem deine — unterschrieben mit deinem Schlüssel.',
  },
  {
    question: 'Wo liegt mein Schlüssel?',
    answer:
      'Nur auf diesem Gerät, geschützt im sicheren Speicher deines Handys. Er wird aus deinem Wallet berechnet, also bekommst du auf jedem Gerät denselben Ausweis. Röbel speichert ihn nicht und kann deshalb nicht in deinem Namen schreiben.',
  },
  {
    question: 'Wer darf dort schreiben?',
    answer:
      'Nur Bürgerinnen und Bürger mit Bürger-NFT. Lesen darf jeder. Deine Freischaltung wird automatisch geprüft — wenn du deine Mitgliedschaft verlierst, endet auch der Schreibzugriff.',
  },
  {
    question: 'Kann ich Beiträge wieder löschen?',
    answer:
      'Nur eingeschränkt — und das ist der wichtigste Punkt auf dieser Seite. Die App kann eine Löschung anfragen, aber nicht erzwingen: Andere Relays und Apps, die den Beitrag schon geladen haben, dürfen ihn behalten. Veröffentliche hier also nur, was dauerhaft öffentlich bleiben darf.',
  },
];

export default function NostrIdentityScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const account = useActiveAccount();
  const { user } = useUser();

  const [stage, setStage] = useState<Stage>('loading');
  const [identity, setIdentity] = useState<NostrIdentity | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<'npub' | 'hex' | null>(null);
  const [openExplainer, setOpenExplainer] = useState<number | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  /** null = not looked up yet. Read straight off Gnosis, so it resolves in a second. */
  const [hasCitizenNft, setHasCitizenNft] = useState<boolean | null>(null);
  /** Pilot gate for the Netizen Workspace export — off unless app_settings says 'true'. */
  const [workspaceEnabled, setWorkspaceEnabled] = useState(false);
  const [exportedAt, setExportedAt] = useState<number | null>(null);

  const profileMetadata = useCallback(
    () => ({
      name: user?.username || undefined,
      about: user?.bio || undefined,
      picture: user?.profile_picture_url || undefined,
    }),
    [user],
  );

  /**
   * Ask the relay whether we may write. Publishing the kind 0 profile is the
   * authoritative probe — and it is idempotent, since a profile event is
   * replaceable, so re-checking never leaves clutter behind.
   */
  const probeAccess = useCallback(
    async (current: NostrIdentity) => {
      const result = await publishProfile(profileMetadata(), current);
      return result === 'published';
    },
    [profileMetadata],
  );

  /**
   * Read before writing. If our own events are already on the relay, access is
   * proven without sending anything — so simply opening this screen does not
   * publish. The write probe is only the fallback for the gap right after being
   * allow-listed, when there is nothing to read yet.
   */
  const detectStage = useCallback(
    async (current: NostrIdentity): Promise<Stage> => {
      const existing = await readFromRelay([current.publicKey], [0, 1], 1);
      if (existing.length > 0) return 'active';
      return (await probeAccess(current)) ? 'active' : 'waiting';
    },
    [probeAccess],
  );

  const load = useCallback(async () => {
    const stored = await loadStoredIdentity();
    setIdentity(stored);
    if (!stored) {
      setStage('new');
      return;
    }
    if (!(await getRegisteredAt())) {
      setStage('new');
      return;
    }
    setStage(await detectStage(stored));
  }, [detectStage]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void fetchBuzzWorkspaceEnabled().then(setWorkspaceEnabled);
  }, []);

  // Membership is an on-chain fact — read it directly instead of inferring it
  // from whether the relay has admitted us yet. One RPC call, about a second,
  // and it separates "you are not a Citizen" (actionable) from "you are, the
  // relay just has not caught up" (nothing to do but wait).
  useEffect(() => {
    if (!account?.address) return;
    let cancelled = false;
    void (async () => {
      try {
        const balance = await balanceOf({
          contract: citizenNFTGnosisContract(),
          owner: account.address,
        });
        if (!cancelled) setHasCitizenNft(balance > 0n);
      } catch {
        if (!cancelled) setHasCitizenNft(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [account?.address]);

  // While waiting for the allow-list to catch up, keep checking quietly instead of
  // making the Citizen come back and tap something.
  useEffect(() => {
    if (stage !== 'waiting' || !identity) return;
    const timer = setInterval(async () => {
      if (await probeAccess(identity)) {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        setStage('active');
        clearInterval(timer);
      }
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [stage, identity, probeAccess]);

  const onCreate = useCallback(async () => {
    if (!account || busy) return;
    setBusy(true);
    try {
      const derived = await deriveAndStoreIdentity(account);
      setIdentity(derived);
      const result = await registerIdentity(account, derived);
      if (!result.ok) {
        Alert.alert('Das hat nicht geklappt', result.message);
        return;
      }
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setStage((await probeAccess(derived)) ? 'active' : 'waiting');
    } catch {
      Alert.alert('Das hat nicht geklappt', 'Die Identität konnte nicht erstellt werden. Bitte versuche es später noch einmal.');
    } finally {
      setBusy(false);
    }
  }, [account, busy, probeAccess]);

  const copy = useCallback(async (value: string, which: 'npub' | 'hex') => {
    await Clipboard.setStringAsync(value);
    setCopied(which);
    setTimeout(() => setCopied(null), 1800);
  }, []);

  /**
   * Hand the citizen their own secret key, for import into the Workspace app.
   *
   * Custody-preserving on purpose: the key is derived and stored on this device,
   * the node never sees it, and export happens only on an explicit, warned tap.
   * The clipboard is the transfer channel — imperfect, but it is the citizen's
   * own device and the standard import path every Nostr client understands.
   */
  const onExportWorkspaceKey = useCallback(() => {
    if (!identity) return;
    Alert.alert(
      'Schlüssel exportieren?',
      'Dieser geheime Schlüssel IST deine Identität. Wer ihn hat, kann in deinem Namen schreiben.\n\n• Füge ihn nur in der Workspace-App (Buzz) ein\n• Schicke ihn niemandem — auch nicht dem Röbel-Team\n• Röbel speichert ihn nicht und kann ihn nicht wiederherstellen',
      [
        { text: 'Abbrechen', style: 'cancel' },
        {
          text: 'In Zwischenablage kopieren',
          onPress: async () => {
            await Clipboard.setStringAsync(nsecEncode(identity.secretKey));
            setExportedAt(Date.now());
            setTimeout(() => setExportedAt(null), 60_000);
          },
        },
      ],
    );
  }, [identity]);

  const onRemove = useCallback(() => {
    Alert.alert(
      'Identität entfernen?',
      'Der Schlüssel wird von diesem Gerät gelöscht und die App veröffentlicht nichts mehr für dich. Bereits veröffentlichte Beiträge bleiben auf dem Relay.',
      [
        { text: 'Abbrechen', style: 'cancel' },
        {
          text: 'Entfernen',
          style: 'destructive',
          onPress: async () => {
            await clearIdentity();
            LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
            setIdentity(null);
            setStage('new');
          },
        },
      ],
    );
  }, []);

  // Two genuinely different things were hidden behind one "Mitgliedschaft prüfen"
  // step: an on-chain fact we can read instantly, and a wait on the node's
  // allow-list. Separating them means the screen never shows a spinner for
  // something already known.
  const membershipDetail =
    hasCitizenNft === true
      ? 'Bürger-NFT bestätigt.'
      : hasCitizenNft === false
        ? 'Kein Bürger-NFT gefunden. Schreibrechte haben nur verifizierte Bürgerinnen und Bürger.'
        : 'Wird auf der Blockchain nachgesehen …';

  const steps: { title: string; detail: string }[] = [
    {
      title: 'Identität erstellen',
      detail: 'Dein Wallet erzeugt deinen Ausweis. Ein Tipp genügt.',
    },
    { title: 'Bürger-NFT', detail: membershipDetail },
    {
      title: 'Freischaltung auf dem Relay',
      detail:
        stage === 'active'
          ? 'Aktiv. Neue Beiträge erscheinen automatisch auch auf dem Relay.'
          : 'Röbel trägt dich in die Schreibliste ein. Das läuft im Hintergrund und dauert meist ein paar Minuten.',
    },
  ];

  // Step 2 is complete as soon as the chain says so — it does not wait on step 3.
  const nftDone = hasCitizenNft === true;
  const currentStep = stage === 'active' ? 2 : hasCitizenNft === null ? 1 : stage === 'waiting' ? 2 : 0;
  const completedThrough = stage === 'active' ? 3 : nftDone && stage === 'waiting' ? 2 : nftDone ? 1 : 0;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <ChevronLeftIcon width={24} height={24} color={colors.textPrimary} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>Nostr-Identität</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={[styles.lede, { color: colors.textPrimary }]}>
          Ein eigener Ausweis für Röbels eigenen Server.
        </Text>
        <Text style={[styles.subLede, { color: colors.textSecondary }]}>
          Damit gehören deine öffentlichen Beiträge dir — nachweisbar, und lesbar auch außerhalb
          dieser App.
        </Text>

        {/* The progression. Genuinely sequential, so it earns the vertical rail. */}
        <View style={[styles.card, { backgroundColor: colors.surface }]}>
          {steps.map((step, index) => {
            const done = index < completedThrough;
            const active = index === currentStep && stage !== 'loading' && !done;
            const dotColor = done ? colors.success : active ? colors.primary : colors.borderSecondary;
            return (
              <View key={step.title} style={styles.step}>
                <View style={styles.stepRail}>
                  <View style={[styles.stepDot, { backgroundColor: dotColor }]}>
                    {done && <Text style={styles.stepDotMark}>✓</Text>}
                  </View>
                  {index < steps.length - 1 && (
                    <View
                      style={[
                        styles.stepLine,
                        { backgroundColor: index < completedThrough - 1 ? colors.success : colors.borderSecondary },
                      ]}
                    />
                  )}
                </View>
                <View style={styles.stepBody}>
                  <Text
                    style={[
                      styles.stepTitle,
                      { color: done || active ? colors.textPrimary : colors.textTertiary },
                    ]}
                  >
                    {step.title}
                  </Text>
                  <Text style={[styles.stepDetail, { color: colors.textSecondary }]}>{step.detail}</Text>
                  {active && index === 2 && stage === 'waiting' && (
                    <View style={styles.inlineStatus}>
                      <ActivityIndicator size="small" color={colors.primary} />
                      <Text style={[styles.inlineStatusText, { color: colors.primary }]}>
                        Wird automatisch geprüft …
                      </Text>
                    </View>
                  )}
                </View>
              </View>
            );
          })}
        </View>

        {stage === 'new' && (
          <>
            <Pressable
              style={[
                styles.primaryButton,
                { backgroundColor: colors.primary, opacity: account && !busy ? 1 : 0.5 },
              ]}
              disabled={!account || busy}
              onPress={onCreate}
            >
              {busy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.primaryButtonText}>
                  {identity ? 'Registrierung wiederholen' : 'Identität erstellen'}
                </Text>
              )}
            </Pressable>
            <Text style={[styles.buttonNote, { color: colors.textSecondary }]}>
              {identity
                ? 'Dein Ausweis liegt bereits auf diesem Gerät. Es fehlt nur noch die Anmeldung beim Relay.'
                : 'Kostenlos, kein zusätzliches Passwort. Du kannst sie jederzeit wieder entfernen.'}
            </Text>
          </>
        )}

        {stage === 'waiting' && (
          // No "check now" button: the screen already polls on its own, and a
          // button that duplicates automatic behaviour just implies the automatic
          // part cannot be trusted.
          <Text style={[styles.buttonNote, { color: colors.textSecondary, marginTop: 0 }]}>
            Du kannst die Seite verlassen — die Freischaltung läuft weiter.
          </Text>
        )}

        {identity && (
          <View style={[styles.card, { backgroundColor: colors.surface }]}>
            <Text style={[styles.cardLabel, { color: colors.textSecondary }]}>Deine Adresse</Text>
            <Pressable onPress={() => copy(identity.npub, 'npub')}>
              <Text style={[styles.npub, { color: colors.textPrimary }]} numberOfLines={2}>
                {identity.npub}
              </Text>
              <Text style={[styles.copyHint, { color: copied === 'npub' ? colors.success : colors.textSecondary }]}>
                {copied === 'npub' ? 'Kopiert' : 'Zum Kopieren tippen'}
              </Text>
            </Pressable>

            <Pressable
              onPress={() => {
                LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                setShowDetails((v) => !v);
              }}
              style={styles.detailsToggle}
            >
              <Text style={[styles.detailsToggleText, { color: colors.textSecondary }]}>
                Technische Details {showDetails ? '−' : '+'}
              </Text>
            </Pressable>
            {showDetails && (
              <Pressable onPress={() => copy(identity.publicKey, 'hex')}>
                <Text style={[styles.cardLabel, { color: colors.textSecondary, marginTop: 4 }]}>
                  Öffentlicher Schlüssel (hex)
                </Text>
                <Text style={[styles.hex, { color: colors.textSecondary }]} numberOfLines={2}>
                  {identity.publicKey}
                </Text>
                <Text style={[styles.copyHint, { color: copied === 'hex' ? colors.success : colors.textSecondary }]}>
                  {copied === 'hex' ? 'Kopiert' : 'Zum Kopieren tippen'}
                </Text>
              </Pressable>
            )}
          </View>
        )}

        {stage === 'active' && (
          <View style={[styles.card, { backgroundColor: colors.surface }]}>
            <Text style={[styles.cardLabel, { color: colors.textSecondary }]}>ALLES BEREIT</Text>
            <Text style={[styles.body, { color: colors.textSecondary }]}>
              Deine Beiträge werden jetzt automatisch signiert und Teil des öffentlichen
              Datenbestands — poste einfach ganz normal im Feed. Auch ältere eigene Beiträge
              werden nach und nach übernommen.
            </Text>
          </View>
        )}

        {workspaceEnabled && identity && (
          <>
            <Text style={[styles.sectionHeading, { color: colors.textSecondary }]}>
              NETIZEN WORKSPACE
            </Text>
            <View style={[styles.card, { backgroundColor: colors.surface }]}>
              <Text style={[styles.body, { color: colors.textSecondary }]}>
                Röbels Arbeitsraum (Buzz) nutzt denselben Ausweis wie das Relay. Exportiere
                deinen Schlüssel und füge ihn in der Buzz-App ein — dann bist du dort dieselbe
                Person wie hier. Der Schlüssel bleibt dabei auf deinen eigenen Geräten; Röbel
                sieht ihn nie.
              </Text>
              <Pressable
                style={[styles.secondaryButton, { borderColor: colors.borderSecondary, marginTop: 14 }]}
                onPress={onExportWorkspaceKey}
              >
                <Text style={[styles.secondaryButtonText, { color: colors.textPrimary }]}>
                  {exportedAt ? 'Kopiert — jetzt in Buzz einfügen' : 'Schlüssel für Buzz exportieren'}
                </Text>
              </Pressable>
              {exportedAt != null && (
                <Text style={[styles.buttonNote, { color: colors.textSecondary, marginTop: 10 }]}>
                  Tipp: Nach dem Einfügen die Zwischenablage leeren (etwas anderes kopieren).
                </Text>
              )}
            </View>
          </>
        )}

        <Text style={[styles.sectionHeading, { color: colors.textSecondary }]}>GUT ZU WISSEN</Text>
        <View style={[styles.card, styles.explainerCard, { backgroundColor: colors.surface }]}>
          {EXPLAINERS.map((item, index) => {
            const open = openExplainer === index;
            return (
              <View
                key={item.question}
                style={
                  index < EXPLAINERS.length - 1
                    ? { borderBottomWidth: 1, borderBottomColor: colors.borderSecondary }
                    : undefined
                }
              >
                <Pressable
                  style={styles.explainerRow}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: open }}
                  onPress={() => {
                    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                    setOpenExplainer(open ? null : index);
                  }}
                >
                  <Text style={[styles.explainerQuestion, { color: colors.textPrimary }]}>
                    {item.question}
                  </Text>
                  <Text style={[styles.explainerSign, { color: colors.textTertiary }]}>
                    {open ? '−' : '+'}
                  </Text>
                </Pressable>
                {open && (
                  <Text style={[styles.explainerAnswer, { color: colors.textSecondary }]}>
                    {item.answer}
                  </Text>
                )}
              </View>
            );
          })}
        </View>

        {identity && (
          <Pressable style={styles.removeButton} onPress={onRemove}>
            <Text style={[styles.removeButtonText, { color: colors.error }]}>
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
  headerTitle: { fontFamily: fontFamily.semiBold, fontSize: 17 },
  content: { padding: 16, paddingBottom: 56, gap: 14 },

  lede: { fontFamily: fontFamily.heading, fontSize: 26, lineHeight: 31 },
  subLede: { fontFamily: fontFamily.regular, fontSize: 15, lineHeight: 22, marginTop: -6 },

  card: { borderRadius: 16, padding: 16 },
  cardLabel: { fontFamily: fontFamily.medium, fontSize: 11, letterSpacing: 0.6, marginBottom: 6 },
  body: { fontFamily: fontFamily.regular, fontSize: 14, lineHeight: 21 },
  sectionHeading: {
    fontFamily: fontFamily.medium,
    fontSize: 11,
    letterSpacing: 0.6,
    marginTop: 6,
    marginLeft: 4,
  },

  step: { flexDirection: 'row', gap: 14 },
  stepRail: { alignItems: 'center', width: 22 },
  stepDot: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  stepDotMark: { color: '#fff', fontSize: 12, fontFamily: fontFamily.bold },
  stepLine: { width: 2, flex: 1, marginVertical: 4, borderRadius: 1 },
  stepBody: { flex: 1, paddingBottom: 18 },
  stepTitle: { fontFamily: fontFamily.semiBold, fontSize: 15 },
  stepDetail: { fontFamily: fontFamily.regular, fontSize: 13, lineHeight: 19, marginTop: 2 },
  inlineStatus: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  inlineStatusText: { fontFamily: fontFamily.medium, fontSize: 13 },

  npub: { fontFamily: fontFamily.mono, fontSize: 13, lineHeight: 19 },
  hex: { fontFamily: fontFamily.mono, fontSize: 12, lineHeight: 18 },
  copyHint: { fontFamily: fontFamily.regular, fontSize: 12, marginTop: 6 },
  detailsToggle: { marginTop: 14 },
  detailsToggleText: { fontFamily: fontFamily.medium, fontSize: 13 },

  explainerCard: { paddingVertical: 0 },
  explainerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 15,
    gap: 12,
  },
  explainerQuestion: { fontFamily: fontFamily.medium, fontSize: 15, flex: 1 },
  explainerSign: { fontFamily: fontFamily.regular, fontSize: 18 },
  explainerAnswer: {
    fontFamily: fontFamily.regular,
    fontSize: 14,
    lineHeight: 21,
    paddingBottom: 16,
    paddingRight: 24,
  },

  primaryButton: { borderRadius: 999, paddingVertical: 16, alignItems: 'center' },
  primaryButtonText: { fontFamily: fontFamily.semiBold, fontSize: 15, color: '#fff' },
  buttonNote: { fontFamily: fontFamily.regular, fontSize: 12, textAlign: 'center', marginTop: -6 },
  secondaryButton: {
    borderRadius: 999,
    paddingVertical: 15,
    alignItems: 'center',
    borderWidth: 1,
  },
  secondaryButtonText: { fontFamily: fontFamily.semiBold, fontSize: 15 },
  testInput: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 72,
    fontFamily: fontFamily.regular,
    fontSize: 14,
    textAlignVertical: 'top',
  },
  proofLink: { fontFamily: fontFamily.semiBold, fontSize: 14, marginTop: 2 },
  removeButton: { paddingVertical: 14, alignItems: 'center', marginTop: 4 },
  removeButtonText: { fontFamily: fontFamily.medium, fontSize: 14 },
});
