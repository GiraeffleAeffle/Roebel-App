import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { useSnackbar } from '@/context/SnackbarContext';
import { useTheme } from '@/context/ThemeContext';
import { useUser } from '@/context/UserContext';
import {
  parseCivicDiscussionRoute,
  prepareCivicDiscussionPost,
} from '@/lib/civic-discussion';
import {
  createCivicDiscussionPost,
  PostingDeniedError,
} from '@/lib/supabase-posts';
import {
  fetchAgentReply,
  publishCitizenSignedSuggestion,
  publishCivicDiscussionDetailed,
  type PublicationStatus,
} from '@/lib/nostr/publish';
import type { PostRecord } from '@/lib/types/feed';
import type { CitizenSignedSuggestionV1, NostrEvent } from '@netizen-labs/nostr';

type RouteParams = {
  municipality?: string | string[];
  case?: string | string[];
  stadtstackCase?: string | string[];
  title?: string | string[];
};

export default function CivicDiscussionScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<RouteParams>();
  const { colors } = useTheme();
  const { user } = useUser();
  const { showSnackbar } = useSnackbar();
  const routeInput = useMemo(
    () => ({
      municipality: params.municipality,
      case: params.case,
      stadtstackCase: params.stadtstackCase,
      title: params.title,
    }),
    [params.case, params.municipality, params.stadtstackCase, params.title],
  );
  const route = useMemo(() => {
    try {
      return parseCivicDiscussionRoute(routeInput);
    } catch {
      return null;
    }
  }, [routeInput]);

  const [question, setQuestion] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [publicationStatus, setPublicationStatus] =
    useState<PublicationStatus | null>(null);
  const [createdPost, setCreatedPost] = useState<PostRecord | null>(null);
  const [discussionEvent, setDiscussionEvent] = useState<NostrEvent | null>(null);
  const [meckyAnswer, setMeckyAnswer] = useState<NostrEvent | null>(null);
  const [checkingAnswer, setCheckingAnswer] = useState(false);
  const [suggestionTitle, setSuggestionTitle] = useState(
    route ? `Vorschlag zu ${route.title}` : '',
  );
  const [suggestionSummary, setSuggestionSummary] = useState('');
  const [signedSuggestion, setSignedSuggestion] =
    useState<CitizenSignedSuggestionV1 | null>(null);
  const [suggestionStatus, setSuggestionStatus] =
    useState<PublicationStatus | null>(null);

  const submit = async () => {
    if (!route || !user?.wallet_address || submitting) return;
    let prepared;
    try {
      prepared = prepareCivicDiscussionPost(routeInput, question.trim());
    } catch {
      showSnackbar({ message: 'Bitte stelle eine konkrete Frage an Mecky.' });
      return;
    }

    setSubmitting(true);
    try {
      const result = await createCivicDiscussionPost({
        wallet_address: user.wallet_address,
        content: prepared.content,
        civicBinding: prepared.binding,
      });
      if (!result.post) {
        showSnackbar({ message: 'Die Diskussion konnte nicht veröffentlicht werden.' });
        return;
      }
      setCreatedPost(result.post);
      setPublicationStatus(result.publicationStatus);
      setDiscussionEvent(result.discussionEvent);
      setSuggestionSummary(question.trim());
    } catch (error) {
      if (error instanceof PostingDeniedError) {
        showSnackbar({ message: postingDeniedMessage(error) });
      } else {
        showSnackbar({ message: 'Die Diskussion konnte nicht veröffentlicht werden.' });
      }
    } finally {
      setSubmitting(false);
    }
  };

  const retrySignedPublication = async () => {
    if (!route || !createdPost || submitting) return;
    setSubmitting(true);
    try {
      const createdAt = Math.floor(Date.parse(createdPost.created_at) / 1_000);
      const publication = await publishCivicDiscussionDetailed(
        createdPost.id,
        createdPost.content,
        route.binding,
        createdAt,
      );
      setPublicationStatus(publication.status);
      setDiscussionEvent(publication.event);
    } finally {
      setSubmitting(false);
    }
  };

  const checkForMeckyAnswer = async () => {
    if (!discussionEvent || checkingAnswer) return;
    const agentPubkey = process.env.EXPO_PUBLIC_MECKY_NOSTR_PUBKEY
      ?.trim()
      .toLowerCase();
    if (!agentPubkey) {
      showSnackbar({ message: 'Die öffentliche Mecky-Identität ist nicht konfiguriert.' });
      return;
    }
    setCheckingAnswer(true);
    try {
      const answer = await fetchAgentReply(discussionEvent.id, agentPubkey);
      if (!answer) {
        showSnackbar({ message: 'Mecky hat noch nicht geantwortet. Bitte versuche es gleich noch einmal.' });
        return;
      }
      setMeckyAnswer(answer);
    } finally {
      setCheckingAnswer(false);
    }
  };

  const signSuggestion = async () => {
    if (!route || !discussionEvent || !meckyAnswer || submitting) return;
    setSubmitting(true);
    try {
      const result = await publishCitizenSignedSuggestion({
        binding: route.binding,
        sourceDiscussion: discussionEvent,
        sourceAnswer: meckyAnswer,
        title: suggestionTitle,
        summary: suggestionSummary,
      });
      setSignedSuggestion(result.suggestion);
      setSuggestionStatus(result.status);
    } catch {
      showSnackbar({ message: 'Die Mecky-Antwort oder Fallbindung konnte nicht sicher geprüft werden.' });
    } finally {
      setSubmitting(false);
    }
  };

  if (!route) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <Stack.Screen options={{ title: 'Diskussion' }} />
        <View style={styles.centered}>
          <Ionicons name="shield-outline" size={34} color={colors.error} />
          <Text style={[styles.errorTitle, { color: colors.textPrimary }]}>Fallbindung ungültig</Text>
          <Text style={[styles.centerCopy, { color: colors.textSecondary }]}>Diese Diskussion wurde nicht geöffnet, weil der Röbel-Fall und die kanonische Stadtstack-ID nicht eindeutig zusammenpassen.</Text>
          <Pressable onPress={() => router.back()} style={[styles.secondaryButton, { borderColor: colors.border }]}>
            <Text style={[styles.secondaryButtonText, { color: colors.textPrimary }]}>Zurück</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ title: 'Mit Mecky diskutieren' }} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={[styles.caseCard, { backgroundColor: colors.primaryLight, borderColor: colors.primary }]}>
          <Text style={[styles.eyebrow, { color: colors.primary }]}>GEPRÜFTER STADTSTACK-FALL</Text>
          <Text style={[styles.caseTitle, { color: colors.textPrimary }]}>{route.title}</Text>
          <Text style={[styles.caseMeta, { color: colors.textSecondary }]}>Röbel/Müritz · {route.binding.sourceCaseId}</Text>
        </View>

        <View style={styles.explanation}>
          <Text style={[styles.heading, { color: colors.textPrimary }]}>Öffentliche Frage, nachvollziehbare Antwort</Text>
          <Text style={[styles.body, { color: colors.textSecondary }]}>Deine Frage erscheint im Röbel-Feed und wird von deinem Gerät als Nostr-Ereignis signiert. Mecky darf nur mit geprüften öffentlichen Belegen antworten und nennt diese Belege in seiner Antwort.</Text>
          <Text style={[styles.boundary, { color: colors.warning, backgroundColor: colors.warningBackground }]}>Das ist noch kein eingereichter Vorschlag, keine Verwaltungsantwort und keine Abstimmung. Erst deine spätere Signatur und die menschliche Aufnahme durch einen Fall-Steward starten den Stadtstack-Ablauf.</Text>
        </View>

        {!createdPost ? (
          <View style={styles.form}>
            <Text style={[styles.label, { color: colors.textPrimary }]}>Was möchtest du Mecky zu diesem Fall fragen?</Text>
            <TextInput
              value={question}
              onChangeText={setQuestion}
              editable={!submitting}
              multiline
              maxLength={1_500}
              placeholder="Welche geprüften Informationen gibt es dazu?"
              placeholderTextColor={colors.textTertiary}
              accessibilityLabel="Frage an Mecky"
              style={[
                styles.input,
                {
                  color: colors.textPrimary,
                  borderColor: colors.border,
                  backgroundColor: colors.surface,
                },
              ]}
            />
            <Text style={[styles.counter, { color: colors.textTertiary }]}>{question.length}/1500</Text>

            {!user?.wallet_address && (
              <Text style={[styles.loginHint, { color: colors.warning, backgroundColor: colors.warningBackground }]}>Bitte verbinde zuerst dein Bürgerkonto. Nur du kannst deine öffentliche Frage signieren.</Text>
            )}

            <Pressable
              onPress={submit}
              disabled={!user?.wallet_address || !question.trim() || submitting}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.primaryButton,
                {
                  backgroundColor:
                    !user?.wallet_address || !question.trim()
                      ? colors.disabled
                      : colors.primary,
                  opacity: pressed ? 0.85 : 1,
                },
              ]}
            >
              {submitting ? (
                <ActivityIndicator color={colors.onPrimary} />
              ) : (
                <Text style={[styles.primaryButtonText, { color: colors.onPrimary }]}>Öffentlich fragen und signieren</Text>
              )}
            </Pressable>
          </View>
        ) : (
          <View style={styles.resultFlow}>
            <PublicationResult
              status={publicationStatus ?? 'pending'}
              busy={submitting || checkingAnswer}
              colors={colors}
              onRetry={retrySignedPublication}
              onCheckMecky={
                publicationStatus === 'published' && discussionEvent
                  ? checkForMeckyAnswer
                  : undefined
              }
              onOpenFeed={() => router.replace('/' as never)}
            />
            {meckyAnswer && (
              <View style={[styles.answerCard, { borderColor: colors.border, backgroundColor: colors.surface }]}>
                <Text style={[styles.eyebrow, { color: colors.primary }]}>PUBLIC MECKY · GEPRÜFTE BELEGE</Text>
                <Text style={[styles.body, { color: colors.textPrimary }]}>{meckyAnswer.content}</Text>
                <Text style={[styles.caseMeta, { color: colors.textSecondary }]}>{meckyAnswer.tags.filter((tag) => tag[0] === 'evidence').length} öffentliche Beleg{meckyAnswer.tags.filter((tag) => tag[0] === 'evidence').length === 1 ? '' : 'e'} in der signierten Antwort</Text>

                {!signedSuggestion ? (
                  <View style={styles.suggestionForm}>
                    <Text style={[styles.heading, { color: colors.textPrimary }]}>Daraus einen Vorschlag formulieren</Text>
                    <Text style={[styles.body, { color: colors.textSecondary }]}>Du kannst Meckys Entwurf ändern. Erst deine neue Signatur macht daraus einen Vorschlagskandidaten; ein menschlicher Steward muss ihn danach noch in den Fall aufnehmen.</Text>
                    <TextInput
                      value={suggestionTitle}
                      onChangeText={setSuggestionTitle}
                      maxLength={240}
                      editable={!submitting}
                      accessibilityLabel="Titel des Vorschlags"
                      style={[styles.singleInput, { color: colors.textPrimary, borderColor: colors.border, backgroundColor: colors.background }]}
                    />
                    <TextInput
                      value={suggestionSummary}
                      onChangeText={setSuggestionSummary}
                      maxLength={2_000}
                      multiline
                      editable={!submitting}
                      accessibilityLabel="Zusammenfassung des Vorschlags"
                      style={[styles.input, { color: colors.textPrimary, borderColor: colors.border, backgroundColor: colors.background }]}
                    />
                    <Pressable
                      onPress={signSuggestion}
                      disabled={!suggestionTitle.trim() || !suggestionSummary.trim() || submitting}
                      style={[styles.primaryButton, { backgroundColor: !suggestionTitle.trim() || !suggestionSummary.trim() ? colors.disabled : colors.primary }]}
                    >
                      {submitting ? <ActivityIndicator color={colors.onPrimary} /> : <Text style={[styles.primaryButtonText, { color: colors.onPrimary }]}>Vorschlagskandidat als Bürger signieren</Text>}
                    </Pressable>
                  </View>
                ) : (
                  <View style={[styles.admissionCard, { backgroundColor: suggestionStatus === 'published' ? colors.successBackground : colors.warningBackground }]}>
                    <Text style={[styles.resultTitle, { color: colors.textPrimary }]}>{suggestionStatus === 'published' ? 'Vorschlagskandidat signiert' : 'Signatur vorbereitet, Relay-Übergabe noch offen'}</Text>
                    <Text style={[styles.body, { color: colors.textSecondary }]}>Status: wartet auf menschliche Fallaufnahme. Keine automatische Verwaltungsvorlage, keine Abstimmung und keine amtliche Wirkung.</Text>
                    <Text selectable style={[styles.receipt, { color: colors.textTertiary }]}>{signedSuggestion.candidateId}</Text>
                  </View>
                )}
              </View>
            )}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function PublicationResult({
  status,
  busy,
  colors,
  onRetry,
  onCheckMecky,
  onOpenFeed,
}: {
  status: PublicationStatus;
  busy: boolean;
  colors: ReturnType<typeof useTheme>['colors'];
  onRetry: () => void;
  onCheckMecky?: () => void;
  onOpenFeed: () => void;
}) {
  const complete = status === 'published';
  return (
    <View style={[styles.resultCard, { borderColor: complete ? colors.success : colors.warning, backgroundColor: complete ? colors.successBackground : colors.warningBackground }]}>
      <Ionicons name={complete ? 'checkmark-circle' : 'time-outline'} size={32} color={complete ? colors.success : colors.warning} />
      <Text style={[styles.resultTitle, { color: colors.textPrimary }]}>{complete ? 'Frage signiert veröffentlicht' : 'Feed-Beitrag veröffentlicht, Signaturnachweis noch offen'}</Text>
      <Text style={[styles.body, { color: colors.textSecondary }]}>{complete ? 'Mecky kann die Frage jetzt mit dem geprüften Fall und seinen öffentlichen Belegen verbinden.' : status === 'rejected' ? 'Das Relay hat die signierte Übergabe abgelehnt. Der Beitrag ist sichtbar, aber noch nicht Teil des Stadtstack-Ablaufs.' : 'Das Relay ist noch nicht erreichbar oder deine öffentliche Nostr-Identität ist noch nicht bereit. Der Beitrag ist sichtbar, aber noch nicht Teil des Stadtstack-Ablaufs.'}</Text>
      {!complete && (
        <Pressable onPress={onRetry} disabled={busy} style={[styles.secondaryButton, { borderColor: colors.warning }]}>
          {busy ? <ActivityIndicator color={colors.warning} /> : <Text style={[styles.secondaryButtonText, { color: colors.warning }]}>Signierte Übergabe erneut versuchen</Text>}
        </Pressable>
      )}
      {complete && onCheckMecky && (
        <Pressable onPress={onCheckMecky} disabled={busy} style={[styles.secondaryButton, { borderColor: colors.primary }]}>
          {busy ? <ActivityIndicator color={colors.primary} /> : <Text style={[styles.secondaryButtonText, { color: colors.primary }]}>Meckys Antwort abrufen</Text>}
        </Pressable>
      )}
      <Pressable onPress={onOpenFeed} style={[styles.primaryButton, { backgroundColor: colors.primary }]}>
        <Text style={[styles.primaryButtonText, { color: colors.onPrimary }]}>Zum Röbel-Feed</Text>
      </Pressable>
    </View>
  );
}

function postingDeniedMessage(error: PostingDeniedError): string {
  switch (error.code) {
    case 'LOCATION_REQUIRED':
      return 'Bitte bestätige zuerst, dass du dich im Röbel/Müritz-Gebiet befindest.';
    case 'ACCOUNT_TOO_YOUNG':
      return 'Öffentliche Beiträge sind erst 24 Stunden nach der Kontoerstellung möglich.';
    case 'RATE_LIMIT_DAY':
      return 'Du hast das Tageslimit für öffentliche Beiträge erreicht.';
    case 'RATE_LIMIT_WEEK':
      return 'Du hast das Wochenlimit für öffentliche Beiträge erreicht.';
    default:
      return 'Die Diskussion konnte nicht veröffentlicht werden.';
  }
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 20, paddingBottom: 48, gap: 22 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 12 },
  centerCopy: { fontSize: 14, lineHeight: 21, textAlign: 'center' },
  errorTitle: { fontSize: 20, fontWeight: '700' },
  caseCard: { borderWidth: 1, borderRadius: 14, padding: 16 },
  eyebrow: { fontSize: 11, fontWeight: '700', letterSpacing: 0.7 },
  caseTitle: { marginTop: 6, fontSize: 21, lineHeight: 27, fontWeight: '700' },
  caseMeta: { marginTop: 5, fontSize: 13 },
  explanation: { gap: 10 },
  heading: { fontSize: 19, lineHeight: 25, fontWeight: '700' },
  body: { fontSize: 14, lineHeight: 21 },
  boundary: { borderRadius: 10, padding: 12, fontSize: 13, lineHeight: 19 },
  form: { gap: 10 },
  label: { fontSize: 15, lineHeight: 21, fontWeight: '600' },
  input: { minHeight: 140, borderWidth: 1, borderRadius: 12, padding: 14, fontSize: 15, lineHeight: 22, textAlignVertical: 'top' },
  counter: { alignSelf: 'flex-end', fontSize: 12 },
  loginHint: { borderRadius: 10, padding: 12, fontSize: 13, lineHeight: 19 },
  primaryButton: { minHeight: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, paddingVertical: 12 },
  primaryButtonText: { fontSize: 14, fontWeight: '700', textAlign: 'center' },
  secondaryButton: { minHeight: 46, borderWidth: 1, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, paddingVertical: 11 },
  secondaryButtonText: { fontSize: 14, fontWeight: '600', textAlign: 'center' },
  resultCard: { borderWidth: 1, borderRadius: 14, padding: 18, gap: 12 },
  resultTitle: { fontSize: 18, lineHeight: 24, fontWeight: '700' },
  resultFlow: { gap: 18 },
  answerCard: { borderWidth: 1, borderRadius: 14, padding: 18, gap: 12 },
  suggestionForm: { marginTop: 6, gap: 10 },
  singleInput: { minHeight: 46, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
  admissionCard: { marginTop: 6, borderRadius: 10, padding: 14, gap: 8 },
  receipt: { fontSize: 10, lineHeight: 15 },
});
