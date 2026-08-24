import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Dimensions,
  Animated,
} from 'react-native';
import { PanGestureHandler, State } from 'react-native-gesture-handler';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { decode } from 'base64-arraybuffer';
import Markdown from 'react-native-markdown-display';
import { supabase } from '@/lib/supabase';
import { geocodeLocation } from '@/lib/utils/geocoding';
import { formatDate } from '@/lib/utils';
import PencilIcon from '@/assets/icons/pencil.svg';
import FlyerIcon from '@/assets/icons/flyer.svg';
import UploadIcon from '@/assets/icons/profile/upload.svg';
import CheckIcon from '@/assets/icons/check.svg';
import { useTheme } from '@/context/ThemeContext';
import type { ColorTokens } from '@/constants/theme';
import { useAccount } from '@/context/AccountContext';
import { useUser } from '@/context/UserContext';

// Structured event data used to render the pre-submit recap card.
interface EventRecapData {
  title?: string;
  date?: string;
  dates?: string[];
  is_recurring?: boolean;
  time?: string;
  end_time?: string;
  location?: string;
  category?: string;
  ticket_price?: number;
  max_attendees?: number;
  website_url?: string;
  organizer_name?: string;
  organizer_email?: string;
  organizer_phone?: string;
  image_url?: string | null;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  imageUrl?: string;
  localUri?: string;
  isLoading?: boolean;
  eventRecap?: EventRecapData;
}

// All events are for the current year — force the year of a YYYY-MM-DD date
// string to 2026 so the AI can never pick a stale year (e.g. its training year)
// when the user gives a date without one.
const EVENT_YEAR = '2026';
function forceEventYear(dateStr?: string): string | undefined {
  if (!dateStr) return dateStr;
  const m = dateStr.match(/^\d{4}(-\d{2}-\d{2})$/);
  return m ? `${EVENT_YEAR}${m[1]}` : dateStr;
}

function buildSystemPrompt(params: {
  organizerName: string;
  organizerEmail: string;
  organizerPhone: string;
  accountType: 'personal' | 'organisation';
}): string {
  return `Du bist ein hilfreicher KI-Assistent für die Einreichung von Events in Röbel/Müritz.

Deine Aufgabe ist es, Nutzer durch den Prozess der Event-Einreichung zu führen. Stelle freundliche Fragen und sammle folgende Informationen:

**Pflichtfelder:**
- Event-Titel
- Datum (im Format JJJJ-MM-TT) ODER mehrere Termine für wiederkehrende Events
- Ort/Adresse in Röbel oder Umgebung

**WICHTIG – Jahr:** Wir sind im Jahr ${EVENT_YEAR}. Verwende für ALLE Datumsangaben immer das Jahr ${EVENT_YEAR}, auch wenn der Nutzer nur Tag und Monat nennt (z. B. „20. Juli" → ${EVENT_YEAR}-07-20). Wähle niemals ein anderes Jahr.

**Veranstalter-Informationen (bereits bekannt – NICHT danach fragen):**
- Name: ${params.organizerName || '(nicht angegeben)'}
- E-Mail: ${params.organizerEmail || '(nicht angegeben)'}
${params.organizerPhone ? `- Telefon: ${params.organizerPhone}` : ''}
- Typ: ${params.accountType === 'organisation' ? 'Organisations-Account' : 'Persönlicher Account'}

Zeige dem Nutzer diese Veranstalter-Informationen zu Beginn des Gesprächs und frage: "Stimmen diese Angaben? Oder soll ich sie ändern?" Wenn der Nutzer Änderungen wünscht, übernimm die geänderten Werte. Frage ansonsten NICHT erneut nach Veranstalter-Name, E-Mail oder Telefon.
Verwende diese Daten direkt beim Aufruf des prepare_event_submission Tools.

**Optionale Felder:**
- Beschreibung
- Uhrzeit (Beginn im Format HH:MM)
- Endzeit (im Format HH:MM)
- Kategorie (Musik, Kultur, Sport, Fest, Natur, Mittelalter, Lesung, Sonstiges)
- Webseite
- Eintrittspreis (0 für kostenlos)
- Maximale Teilnehmerzahl

**Bilder/Flyer:**
- Nutzer können Event-Flyer oder Bilder hochladen
- Hochgeladene Bilder werden AUTOMATISCH mit dem Event gespeichert
- Wenn ein Bild hochgeladen wurde, extrahiere die sichtbaren Event-Informationen daraus
- Du musst dich NICHT um das Speichern des Bildes kümmern - das passiert automatisch im Hintergrund
- Erwähne in der Zusammenfassung, dass das hochgeladene Bild mit dem Event gespeichert wird

**Für wiederkehrende Events:**
- Frage ob das Event einmalig oder wiederkehrend ist
- Bei wiederkehrenden Events: Frage nach dem Muster (wöchentlich, zweiwöchentlich, monatlich, jährlich)
- Frage nach Start- und Enddatum für die Serie
- Generiere alle Termine und setze is_recurring auf true
- Übergebe die Termine als dates Array im Format JJJJ-MM-TT

Stelle die Fragen einzeln und natürlich. Bestätige die Eingaben des Nutzers.

**WICHTIG – Ablauf zum Abschluss:**
1. Wenn ALLE Pflichtfelder gesammelt wurden, rufe das prepare_event_submission Tool mit allen gesammelten Daten auf. Dies zeigt dem Nutzer AUTOMATISCH eine übersichtliche Zusammenfassung ("Recap-Karte") mit allen Angaben.
2. Unter der Recap-Karte erscheinen dem Nutzer AUTOMATISCH zwei Buttons: „Ja, einsenden" und „Ändern". Fordere den Nutzer daher NICHT auf, „Ja" zu tippen. Sage danach nur eine kurze, freundliche Zeile wie „Alles bereit – tippe auf ‚Ja, einsenden', wenn es passt." und fasse die Daten NICHT zusätzlich als Text zusammen – die Recap-Karte übernimmt das.
3. Wenn der Nutzer eine Änderung wünscht, übernimm die neuen Werte und rufe prepare_event_submission ERNEUT mit den aktualisierten Daten auf (die Recap-Karte aktualisiert sich, neue Buttons erscheinen).
4. Das Einsenden löst der Nutzer selbst über den „Ja, einsenden"-Button aus – DU musst dafür nichts weiter tun. Rufe confirm_event_submission nur dann auf, wenn der Nutzer AUSDRÜCKLICH im Text bestätigt (z. B. „Ja", „passt", „senden") statt den Button zu nutzen.

Rufe confirm_event_submission NIEMALS auf, bevor die Recap-Karte gezeigt wurde.

Antworte immer auf Deutsch und sei freundlich und hilfsbereit.`;
}

// Tools definition for Claude to prepare event submission
const TOOLS = [
  {
    name: 'prepare_event_submission',
    description: 'Call this when you have collected ALL required fields (title, date, location, organizer_name, organizer_email), and again whenever the user requests a change. This renders a structured recap card of the event for the user to review. It does NOT submit — after calling it, ask the user to confirm.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Event title' },
        date: { type: 'string', description: 'Single event date in YYYY-MM-DD format (for non-recurring events)' },
        dates: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of dates in YYYY-MM-DD format for recurring events'
        },
        is_recurring: {
          type: 'boolean',
          description: 'Set to true if the event occurs on multiple dates'
        },
        location: { type: 'string', description: 'Event location/address in Röbel or surrounding area' },
        organizer_name: { type: 'string', description: 'Name of the event organizer' },
        organizer_email: { type: 'string', description: 'Email address of the organizer' },
        description: { type: 'string', description: 'Event description (optional)' },
        time: { type: 'string', description: 'Start time in HH:MM format (optional)' },
        end_time: { type: 'string', description: 'End time in HH:MM format (optional)' },
        organizer_phone: { type: 'string', description: 'Organizer phone number (optional)' },
        category: {
          type: 'string',
          enum: ['Kultur', 'Musik', 'Essen & Trinken', 'Kirchliches', 'Ausstellungen', 'Stadt', 'Sport', 'Sonstige'],
          description: 'Event category (optional)',
        },
        website_url: { type: 'string', description: 'Event website URL (optional)' },
        ticket_price: { type: 'number', description: 'Ticket price in euros, use 0 for free events (optional)' },
        max_attendees: { type: 'number', description: 'Maximum number of attendees (optional)' },
      },
      required: ['title', 'location', 'organizer_name', 'organizer_email'],
    },
  },
  {
    name: 'confirm_event_submission',
    description: 'Call this ONLY after prepare_event_submission has been called AND the user has confirmed the recap is correct (e.g. "Ja", "passt", "senden", "einsenden"). This reveals the final swipe-to-submit control to the user. Never call it before the recap has been shown and confirmed.',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
];

// Direct Anthropic API call with tools support
async function callAnthropicAPI(
  apiKey: string,
  systemPrompt: string,
  messages: Array<{ role: string; content: string }>,
  tools: any[]
): Promise<any> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: systemPrompt,
      tools: tools,
      messages: messages,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || 'API call failed');
  }

  return response.json();
}

// Helper function to compress and convert image to base64 JPEG for API
async function imageToBase64(uri: string): Promise<{ base64: string; mediaType: string } | null> {
  try {
    // Compress and convert to JPEG to ensure Anthropic API compatibility
    // (raw HEIC or oversized images cause "Could not process image")
    const { compressImageForVisionAPI } = require('@/lib/utils/image-compression');
    const compressedUri = await compressImageForVisionAPI(uri);

    const base64 = await FileSystem.readAsStringAsync(compressedUri, {
      encoding: FileSystem.EncodingType.Base64,
    });

    // Compression always outputs JPEG
    return { base64, mediaType: 'image/jpeg' };
  } catch (error) {
    console.error('Error converting image to base64:', error);
    return null;
  }
}

// Hoisted out of MessageBubbleInner so this style object isn't rebuilt on
// every render (this bubble is re-rendered per streamed token while the AI
// response is typing out).
function createMarkdownStyles(colors: ColorTokens) {
  return StyleSheet.create({
    body: {
      color: colors.textPrimary,
      fontSize: 15,
      lineHeight: 22,
    },
    strong: {
      fontFamily: 'Inter-SemiBold',
      color: colors.textPrimary,
    },
    em: {
      fontStyle: 'italic',
    },
    paragraph: {
      marginVertical: 4,
    },
    bullet_list: {
      marginVertical: 4,
    },
    ordered_list: {
      marginVertical: 4,
    },
    list_item: {
      marginVertical: 2,
    },
  });
}

// Message bubble component with image and markdown support
function MessageBubbleInner({
  role,
  content,
  imageUrl,
  localUri,
  isLoading
}: {
  role: 'user' | 'assistant';
  content: string;
  imageUrl?: string;
  localUri?: string;
  isLoading?: boolean;
}) {
  const { colors } = useTheme();
  const isUser = role === 'user';
  const displayUri = localUri || imageUrl;

  const markdownStyles = useMemo(() => createMarkdownStyles(colors), [colors]);

  return (
    <View style={[
      styles.messageBubble,
      isUser
        ? [styles.userBubble, { backgroundColor: colors.primary }]
        : [styles.assistantBubble, { backgroundColor: colors.surface }],
    ]}>
      {displayUri && (
        <View style={styles.imageContainer}>
          <Image
            source={{ uri: displayUri }}
            style={styles.messageImage}
            resizeMode="cover"
          />
          {isLoading && (
            <View style={styles.imageLoadingOverlay}>
              <ActivityIndicator size="small" color={colors.textInverted} />
            </View>
          )}
        </View>
      )}
      {content ? (
        isUser ? (
          <Text style={[styles.messageText, { color: colors.onPrimary }]}>{content}</Text>
        ) : (
          <Markdown style={markdownStyles}>{content}</Markdown>
        )
      ) : null}
    </View>
  );
}

// Structured, highlighted recap of the collected event data, shown before
// the user confirms and the swipe-to-submit control appears.
function EventRecapCard({ data }: { data: EventRecapData }) {
  const { colors } = useTheme();

  const stripSeconds = (t?: string) => (t ? t.slice(0, 5) : '');

  const rows: { label: string; value: string }[] = [];
  if (data.title) rows.push({ label: 'Titel', value: data.title });

  const isRecurring = data.is_recurring || (data.dates && data.dates.length > 1);
  if (isRecurring && data.dates && data.dates.length > 0) {
    rows.push({ label: 'Termine', value: data.dates.map((d) => formatDate(d)).join(', ') });
  } else if (data.date) {
    rows.push({ label: 'Datum', value: formatDate(data.date) });
  }

  if (data.time) {
    rows.push({
      label: 'Zeit',
      value: data.end_time
        ? `${stripSeconds(data.time)}–${stripSeconds(data.end_time)}`
        : stripSeconds(data.time),
    });
  }
  if (data.location) rows.push({ label: 'Ort', value: data.location });
  if (data.category) rows.push({ label: 'Kategorie', value: data.category });
  if (typeof data.ticket_price === 'number') {
    rows.push({ label: 'Preis', value: data.ticket_price > 0 ? `${data.ticket_price} €` : 'kostenlos' });
  }
  if (typeof data.max_attendees === 'number') {
    rows.push({ label: 'Max. Teilnehmer', value: String(data.max_attendees) });
  }
  if (data.website_url) rows.push({ label: 'Webseite', value: data.website_url });
  if (data.organizer_name) rows.push({ label: 'Veranstalter', value: data.organizer_name });
  if (data.organizer_email) rows.push({ label: 'E-Mail', value: data.organizer_email });
  if (data.organizer_phone) rows.push({ label: 'Telefon', value: data.organizer_phone });
  if (data.image_url) rows.push({ label: 'Bild', value: 'angehängt' });

  return (
    <View style={[recapStyles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Text style={[recapStyles.header, { color: colors.primary }]}>Deine Veranstaltung</Text>
      <View style={[recapStyles.divider, { backgroundColor: colors.border }]} />
      {rows.map((row) => (
        <View key={row.label} style={recapStyles.row}>
          <Text style={[recapStyles.label, { color: colors.textSecondary }]}>{row.label}</Text>
          <Text style={[recapStyles.value, { color: colors.textPrimary }]}>{row.value}</Text>
        </View>
      ))}
    </View>
  );
}

const recapStyles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
  },
  header: {
    fontSize: 15,
    fontFamily: 'MonaSansSemiCondensed-Bold',
  },
  divider: {
    height: 1,
    marginTop: 12,
    marginBottom: 4,
  },
  row: {
    flexDirection: 'row',
    marginTop: 8,
    alignItems: 'flex-start',
  },
  label: {
    width: 104,
    fontSize: 13,
    fontFamily: 'Inter-Medium',
  },
  value: {
    flex: 1,
    fontSize: 15,
    fontFamily: 'Inter-Regular',
  },
});

// Typing indicator component with animated dots
function TypingIndicator() {
  const { colors } = useTheme();
  const dot1Opacity = useRef(new Animated.Value(0.4)).current;
  const dot2Opacity = useRef(new Animated.Value(0.4)).current;
  const dot3Opacity = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const animateDot = (dotAnim: Animated.Value, delay: number) => {
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(dotAnim, { toValue: 1, duration: 400, useNativeDriver: true }),
          Animated.timing(dotAnim, { toValue: 0.4, duration: 400, useNativeDriver: true }),
        ])
      ).start();
    };

    animateDot(dot1Opacity, 0);
    animateDot(dot2Opacity, 150);
    animateDot(dot3Opacity, 300);
  }, []);

  return (
    <View style={styles.typingIndicator}>
      <Animated.View style={[styles.typingDot, { opacity: dot1Opacity, backgroundColor: colors.textSecondary }]} />
      <Animated.View style={[styles.typingDot, { opacity: dot2Opacity, backgroundColor: colors.textSecondary }]} />
      <Animated.View style={[styles.typingDot, { opacity: dot3Opacity, backgroundColor: colors.textSecondary }]} />
    </View>
  );
}

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// Fullscreen image preview component (WhatsApp-style)
function FullScreenImagePreviewInner({
  visible,
  imageUri,
  onClose,
  onSend,
  isSending,
}: {
  visible: boolean;
  imageUri: string | null;
  onClose: () => void;
  onSend: (message: string) => void;
  isSending?: boolean;
}) {
  const { colors } = useTheme();
  const [caption, setCaption] = useState('');

  // Reset caption when modal opens with new image
  useEffect(() => {
    if (visible) {
      setCaption('');
    }
  }, [visible, imageUri]);

  const handleSend = () => {
    onSend(caption);
    setCaption('');
  };

  if (!imageUri) return null;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      <SafeAreaView style={previewStyles.container}>
        {/* Header */}
        <View style={previewStyles.header}>
          <TouchableOpacity onPress={onClose} style={previewStyles.closeButton}>
            <Ionicons name="close" size={28} color={colors.textInverted} />
          </TouchableOpacity>
          <Text style={[previewStyles.headerTitle, { color: colors.textInverted }]}>Bild anhängen</Text>
          <View style={previewStyles.headerSpacer} />
        </View>

        {/* Image */}
        <View style={previewStyles.imageContainer}>
          <Image
            source={{ uri: imageUri }}
            style={previewStyles.image}
            resizeMode="contain"
          />
        </View>

        {/* Caption input and send */}
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={previewStyles.bottomContainer}
        >
          <View style={previewStyles.inputContainer}>
            <TextInput
              style={previewStyles.captionInput}
              value={caption}
              onChangeText={setCaption}
              placeholder="Nachricht hinzufügen..."
              placeholderTextColor={colors.textTertiary}
              multiline
              maxLength={500}
              editable={!isSending}
            />
            <TouchableOpacity
              style={[previewStyles.sendButton, { backgroundColor: colors.primary }, isSending && previewStyles.sendButtonDisabled]}
              onPress={handleSend}
              disabled={isSending}
            >
              {isSending ? (
                <ActivityIndicator size="small" color={colors.onPrimary} />
              ) : (
                <Ionicons name="send" size={22} color={colors.onPrimary} />
              )}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

const previewStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  closeButton: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontFamily: 'MonaSansSemiCondensed-SemiBold',
  },
  headerSpacer: {
    width: 44,
  },
  imageContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  image: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT * 0.6,
  },
  bottomContainer: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 12,
    backgroundColor: '#1f1f1f',
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  captionInput: {
    flex: 1,
    fontSize: 16,
    color: '#ffffff',
    maxHeight: 100,
    paddingVertical: 8,
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendButtonDisabled: {
    opacity: 0.5,
  },
});

export function MinimalAIChat() {
  const { colors } = useTheme();
  const { activeAccount } = useAccount();
  const { user } = useUser();
  const scrollViewRef = useRef<ScrollView>(null);
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content: 'Hallo! Ich helfe dir dabei, dein Event in Röbel/Müritz einzureichen. Erzähl mir von deinem Event oder sende einen Flyer ein.',
    },
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmittingEvent, setIsSubmittingEvent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stagedImageUri, setStagedImageUri] = useState<string | null>(null);
  const [lastUploadedImageUrl, setLastUploadedImageUrl] = useState<string | null>(null);
  const [showImagePreview, setShowImagePreview] = useState(false);
  const [isSendingFromPreview, setIsSendingFromPreview] = useState(false);

  // New state for submission flow
  const [isReadyToSubmit, setIsReadyToSubmit] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showSuccessScreen, setShowSuccessScreen] = useState(false);
  const [pendingEventData, setPendingEventData] = useState<any>(null);
  // Id of the newest recap message — only that card shows the Ja/Ändern buttons.
  const [activeRecapId, setActiveRecapId] = useState<string | null>(null);
  const inputRef = useRef<TextInput>(null);
  const translateY = useRef(new Animated.Value(0)).current;
  const iconBounceAnim = useRef(new Animated.Value(0)).current;
  const iconBounceAnimRef = useRef<Animated.CompositeAnimation | null>(null);
  const isReadyToSubmitRef = useRef(false);
  const pendingEventDataRef = useRef<any>(null);

  // Keep refs in sync with state for gesture handler
  useEffect(() => {
    isReadyToSubmitRef.current = isReadyToSubmit;
  }, [isReadyToSubmit]);

  useEffect(() => {
    pendingEventDataRef.current = pendingEventData;
  }, [pendingEventData]);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    scrollViewRef.current?.scrollToEnd({ animated: true });
  }, [messages]);

  // Bounce animation for submit button icon only
  const startIconBounceAnimation = () => {
    const bounce = () => {
      iconBounceAnimRef.current = Animated.sequence([
        Animated.timing(iconBounceAnim, { toValue: -8, duration: 150, useNativeDriver: true }),
        Animated.timing(iconBounceAnim, { toValue: 0, duration: 150, useNativeDriver: true }),
        Animated.timing(iconBounceAnim, { toValue: -8, duration: 150, useNativeDriver: true }),
        Animated.timing(iconBounceAnim, { toValue: 0, duration: 150, useNativeDriver: true }),
        Animated.delay(1000),
      ]);
      iconBounceAnimRef.current.start(() => bounce());
    };
    bounce();
  };

  const stopIconBounceAnimation = () => {
    if (iconBounceAnimRef.current) {
      iconBounceAnimRef.current.stop();
    }
    iconBounceAnim.setValue(0);
  };

  // PanGestureHandler event for swipe-to-submit
  const onGestureEvent = Animated.event(
    [{ nativeEvent: { translationY: translateY } }],
    { useNativeDriver: true }
  );

  const onHandlerStateChange = async (event: any) => {
    if (event.nativeEvent.oldState === State.ACTIVE) {
      const { translationY: gestureTranslationY } = event.nativeEvent;

      if (gestureTranslationY < -150 && pendingEventDataRef.current) {
        // Stop bounce animation
        stopIconBounceAnimation();

        // Animate chat off screen
        Animated.timing(translateY, {
          toValue: -SCREEN_HEIGHT,
          duration: 300,
          useNativeDriver: true,
        }).start();

        // Show loading state and submit
        setIsSubmitting(true);
        const success = await submitEventToSupabase(pendingEventDataRef.current);
        setIsSubmitting(false);

        if (success) {
          setShowSuccessScreen(true);
        } else {
          // Snap back on error
          Animated.spring(translateY, {
            toValue: 0,
            useNativeDriver: true,
          }).start();
          startIconBounceAnimation();
        }
      } else {
        // Snap back if not enough swipe
        Animated.spring(translateY, {
          toValue: 0,
          useNativeDriver: true,
        }).start();
      }
    }
  };

  // Reveal the final swipe-to-submit control. Shared by the "Ja, einsenden"
  // button and the confirm_event_submission tool fallback.
  const revealSwipeToSubmit = () => {
    if (!pendingEventDataRef.current) return false;
    setActiveRecapId(null); // hide the Ja/Ändern buttons
    setIsReadyToSubmit(true);
    startIconBounceAnimation();
    return true;
  };

  // "Ja, einsenden" button under the recap card → reveal swipe-to-submit.
  const handleConfirmSubmit = () => {
    if (revealSwipeToSubmit()) {
      const confirmMessage: Message = {
        id: `confirm-${Date.now()}`,
        role: 'assistant',
        content: 'Super! Wische nach oben, um dein Event einzureichen.',
      };
      setMessages((prev) => [...prev, confirmMessage]);
    }
  };

  // "Ändern" button under the recap card → let the user type what to change.
  const handleRequestChange = () => {
    inputRef.current?.focus();
  };

  // Handle describe button tap
  const handleDescribe = () => {
    // Send a message to the AI to start the describe flow
    sendMessageWithImage('Ich möchte mein Event beschreiben.', null);
  };

  // Handle go to home
  const handleGoHome = () => {
    router.replace('/');
  };

  // Handle go to my events
  const handleGoToMyEvents = () => {
    router.replace('/my-events');
  };

  // Submit event to Supabase
  const submitEventToSupabase = async (eventData: any): Promise<boolean> => {
    setIsSubmittingEvent(true);

    try {
      // 1. Geocode location
      const googleApiKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;
      let placeData = null;

      if (googleApiKey) {
        placeData = await geocodeLocation(eventData.location, googleApiKey);
        if (!placeData) {
          console.warn('Geocoding failed, using raw location');
        }
      } else {
        console.warn('Google Maps API key not configured, skipping geocoding');
      }

      // 2. Determine dates to submit
      const isRecurring = eventData.is_recurring || (eventData.dates && eventData.dates.length > 1);
      const datesToSubmit = eventData.dates && eventData.dates.length > 0
        ? eventData.dates
        : [eventData.date];
      const primaryDate = datesToSubmit[0];

      // 3. Insert into Supabase with geocoded data
      const { data, error } = await supabase.from('events').insert({
        title: eventData.title,
        date: primaryDate,
        time: eventData.time || null,
        end_time: eventData.end_time || null,
        location: placeData?.formatted_address || eventData.location,
        latitude: placeData?.latitude || null,
        longitude: placeData?.longitude || null,
        place_id: placeData?.place_id || null,
        formatted_address: placeData?.formatted_address || null,
        address_components: placeData?.address_components || null,
        description: eventData.description || null,
        organizer_name: eventData.organizer_name,
        organizer_email: eventData.organizer_email,
        organizer_phone: eventData.organizer_phone || null,
        category: eventData.category || null,
        website_url: eventData.website_url || null,
        ticket_price: eventData.ticket_price || 0,
        max_attendees: eventData.max_attendees || null,
        image_url: eventData.image_url || null,
        status: 'pending',
        is_recurring: isRecurring,
        account_id: activeAccount?.id || null,
      }).select().single();

      if (error) {
        console.error('Supabase insert error:', error);
        throw error;
      }

      // Insert all dates into event_dates table
      if (data) {
        const eventDates = datesToSubmit.map((date: string) => ({
          event_id: data.id,
          date: date,
        }));

        const { error: datesError } = await supabase.from('event_dates').insert(eventDates);

        if (datesError) {
          console.error('Error inserting event dates:', datesError);
        }
      }

      // Show success message
      const dateCount = datesToSubmit.length;
      const successMessage: Message = {
        id: `success-${Date.now()}`,
        role: 'assistant',
        content: isRecurring
          ? `🎉 **Perfekt!** Dein wiederkehrendes Event mit ${dateCount} Terminen wurde erfolgreich zur Überprüfung eingereicht. Du erhältst eine Benachrichtigung, sobald es freigegeben wurde.`
          : '🎉 **Perfekt!** Dein Event wurde erfolgreich zur Überprüfung eingereicht. Du erhältst eine Benachrichtigung, sobald es freigegeben wurde.',
      };

      setMessages((prev) => [...prev, successMessage]);
      return true;
    } catch (err: any) {
      console.error('Event submission error:', err);

      let errorMessage = '❌ Ein Fehler ist aufgetreten. ';
      if (err.message?.includes('email')) {
        errorMessage += 'Bitte überprüfe die E-Mail-Adresse.';
      } else if (err.message?.includes('date')) {
        errorMessage += 'Das Datum scheint ungültig zu sein.';
      } else {
        errorMessage += 'Bitte versuche es erneut.';
      }

      const errorMsg: Message = {
        id: `error-${Date.now()}`,
        role: 'assistant',
        content: errorMessage,
      };

      setMessages((prev) => [...prev, errorMsg]);
      return false;
    } finally {
      setIsSubmittingEvent(false);
    }
  };

  // Handle image selection - opens fullscreen preview
  const handleSelectImage = async () => {
    try {
      const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permissionResult.granted) {
        Alert.alert('Berechtigung erforderlich', 'Bitte erlaube den Zugriff auf deine Fotobibliothek.');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
        quality: 0.8,
      });

      if (result.canceled || !result.assets[0]) return;

      setStagedImageUri(result.assets[0].uri);
      setShowImagePreview(true); // Open fullscreen preview
    } catch (error) {
      console.error('Image selection error:', error);
      Alert.alert('Fehler', 'Bild konnte nicht ausgewählt werden.');
    }
  };

  // Handle sending from fullscreen preview
  const handleSendFromPreview = async (caption: string) => {
    const localUri = stagedImageUri;
    setIsSendingFromPreview(true);
    setShowImagePreview(false);
    setStagedImageUri(null);

    // Call sendMessage with the caption and image
    await sendMessageWithImage(caption, localUri);
    setIsSendingFromPreview(false);
  };

  // Close preview without sending
  const handleClosePreview = () => {
    setShowImagePreview(false);
    setStagedImageUri(null);
  };

  // Core message sending logic - used by both regular send and preview send
  const sendMessageWithImage = async (messageText: string, imageUri: string | null) => {
    const trimmedInput = messageText.trim();
    const hasImage = !!imageUri;

    // Allow sending if there's text OR an image
    if (!trimmedInput && !hasImage) return;

    setIsLoading(true);
    setError(null);

    const userMessageId = `user-${Date.now()}`;

    // Create user message with image if present
    const userMessage: Message = {
      id: userMessageId,
      role: 'user',
      content: trimmedInput || (hasImage ? 'Ich habe ein Bild hochgeladen.' : ''),
      localUri: imageUri || undefined,
      isLoading: hasImage,
    };

    setMessages((prev) => [...prev, userMessage]);

    let uploadedImageUrl: string | null = null;

    try {
      // Get API key from env
      const apiKey = process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY;
      if (!apiKey) {
        throw new Error('Anthropic API key is not configured');
      }

      // Upload image to Supabase if present
      if (imageUri) {
        console.log('Uploading image to Supabase...');
        const base64Data = await FileSystem.readAsStringAsync(imageUri, {
          encoding: FileSystem.EncodingType.Base64,
        });

        const arrayBuffer = decode(base64Data);
        const fileExtension = imageUri.split('.').pop()?.toLowerCase() || 'jpg';
        const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExtension}`;
        const filePath = `event-images/${fileName}`;

        let contentType = 'image/jpeg';
        if (fileExtension === 'png') contentType = 'image/png';
        else if (fileExtension === 'webp') contentType = 'image/webp';
        else if (fileExtension === 'gif') contentType = 'image/gif';

        const { error: uploadError } = await supabase.storage
          .from('images')
          .upload(filePath, arrayBuffer, { contentType, cacheControl: '3600', upsert: false });

        if (uploadError) throw uploadError;

        const { data: urlData } = supabase.storage.from('images').getPublicUrl(filePath);
        if (!urlData?.publicUrl) throw new Error('Failed to get public URL');

        uploadedImageUrl = urlData.publicUrl;
        setLastUploadedImageUrl(uploadedImageUrl);
        console.log('Image uploaded:', uploadedImageUrl);

        // Update message with uploaded URL
        setMessages((prev) => prev.map(msg =>
          msg.id === userMessageId ? { ...msg, imageUrl: uploadedImageUrl || undefined } : msg
        ));
      }

      // Prepare message history for API with image support
      const filteredMessages = messages
        .filter((msg) => msg.id !== 'welcome')
        .concat([userMessage]);

      const apiMessages = await Promise.all(
        filteredMessages.map(async (msg) => {
          const uriToConvert = msg.localUri || msg.imageUrl;
          if (uriToConvert) {
            const imageData = await imageToBase64(uriToConvert);
            if (imageData) {
              return {
                role: msg.role,
                content: [
                  { type: 'text' as const, text: msg.content || 'Ich habe ein Bild hochgeladen.' },
                  {
                    type: 'image' as const,
                    source: {
                      type: 'base64' as const,
                      media_type: imageData.mediaType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
                      data: imageData.base64,
                    },
                  },
                ],
              };
            }
          }
          return { role: msg.role, content: msg.content || ' ' };
        })
      );

      // Organizer email follows the active account: an organisation account uses
      // its own contact email (falling back to the user's if it has none); a
      // personal account uses the user's email.
      const isOrgAccount = activeAccount?.account_type === 'organisation';
      const organizerEmail =
        (isOrgAccount ? activeAccount?.contact_email : user?.email) || user?.email || '';

      // Call Anthropic API with tools
      const systemPrompt = buildSystemPrompt({
        organizerName: activeAccount?.name ?? '',
        organizerEmail,
        organizerPhone: user?.phone_number ?? '',
        accountType: activeAccount?.account_type ?? 'personal',
      });
      const response = await callAnthropicAPI(apiKey, systemPrompt, apiMessages, TOOLS);

      // Check if Claude wants to use a tool
      const toolUseBlock = response.content.find((block: any) => block.type === 'tool_use');

      // The AI's text (summary / question) accompanying this response.
      const assistantContent = response.content
        .filter((block: any) => block.type === 'text')
        .map((block: any) => ('text' in block ? block.text : ''))
        .join('\n');

      if (toolUseBlock && toolUseBlock.name === 'prepare_event_submission') {
        const eventData = toolUseBlock.input;
        console.log('Event data extracted via tool:', eventData);

        // Force every date to the current year so a stale AI-picked year can
        // never reach the recap card or the submission.
        const normalizedData = {
          ...eventData,
          date: forceEventYear(eventData.date),
          dates: Array.isArray(eventData.dates)
            ? eventData.dates.map((d: string) => forceEventYear(d))
            : eventData.dates,
        };

        // Store event data and render the recap card. Do NOT enable the
        // swipe-to-submit yet — the user must confirm via the Ja button first.
        const imageUrlToSubmit = uploadedImageUrl || lastUploadedImageUrl;
        const recap: EventRecapData = { ...normalizedData, image_url: imageUrlToSubmit };
        setPendingEventData(recap);
        // Re-preparing after a correction: hide any previously shown swipe control.
        setIsReadyToSubmit(false);
        stopIconBounceAnimation();

        const recapId = `recap-${Date.now()}`;
        const recapMessage: Message = {
          id: recapId,
          role: 'assistant',
          content:
            assistantContent ||
            'Alles bereit. Tippe auf „Ja, einsenden", wenn es passt – oder auf „Ändern".',
          eventRecap: recap,
        };
        // Only the newest recap card shows the Ja/Ändern buttons.
        setActiveRecapId(recapId);

        setMessages((prev) => prev.map(msg =>
          msg.id === userMessageId ? { ...msg, isLoading: false } : msg
        ).concat([recapMessage]));
      } else if (toolUseBlock && toolUseBlock.name === 'confirm_event_submission') {
        // Only reveal the swipe-to-submit if we actually have prepared data.
        const hasPreparedData = revealSwipeToSubmit();

        const confirmMessage: Message = {
          id: `confirm-${Date.now()}`,
          role: 'assistant',
          content:
            assistantContent ||
            (hasPreparedData
              ? 'Super! Wische nach oben, um dein Event einzureichen.'
              : 'Mir fehlen noch ein paar Angaben, bevor wir einsenden können.'),
        };

        setMessages((prev) => prev.map(msg =>
          msg.id === userMessageId ? { ...msg, isLoading: false } : msg
        ).concat([confirmMessage]));
      } else {
        const assistantMessage: Message = {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: assistantContent || 'Entschuldigung, ich konnte keine Antwort generieren.',
        };

        setMessages((prev) => prev.map(msg =>
          msg.id === userMessageId ? { ...msg, isLoading: false } : msg
        ).concat([assistantMessage]));
      }
    } catch (err: any) {
      console.error('Error calling Anthropic API:', err);
      setError(err.message || 'Ein Fehler ist aufgetreten. Bitte versuche es erneut.');
      // Clear loading state on error
      setMessages((prev) => prev.map(msg =>
        msg.isLoading ? { ...msg, isLoading: false } : msg
      ));
    } finally {
      setIsLoading(false);
    }
  };

  // Regular send from text input (no image from preview)
  const sendMessage = async () => {
    if (isLoading) return;
    const trimmedInput = input.trim();
    if (!trimmedInput) return;

    setInput('');
    await sendMessageWithImage(trimmedInput, null);
  };

  // Check if we should show action buttons (only on initial state)
  const showActionButtons = messages.length === 1 && !isLoading && !isReadyToSubmit;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Blue background - ALWAYS rendered, revealed by swipe */}
      <View style={[styles.submissionScreen, { backgroundColor: colors.primary }]}>
        <ActivityIndicator size="large" color={colors.onPrimary} style={{ marginBottom: 24 }} />
        <Text style={[styles.loadingTitle, { color: colors.onPrimary }]}>Wird eingesendet</Text>
        <Text style={styles.loadingSubtitle}>Daten werden übermittelt</Text>
      </View>

      {/* Main chat content (animated) - wrapped in PanGestureHandler */}
      <PanGestureHandler
        enabled={isReadyToSubmit}
        onGestureEvent={onGestureEvent}
        onHandlerStateChange={onHandlerStateChange}
        activeOffsetY={[-10, 10]}
      >
        <Animated.View style={[styles.chatContainer, { backgroundColor: colors.background }, { transform: [{ translateY }] }]}>
          <SafeAreaView style={styles.safeArea} edges={['bottom']}>
            <KeyboardAvoidingView
              behavior="padding"
              style={styles.keyboardView}
              keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 20}
            >
              {/* Messages */}
              <ScrollView
                ref={scrollViewRef}
                style={styles.messagesContainer}
                contentContainerStyle={styles.messagesContent}
                showsVerticalScrollIndicator={false}
              >
                {messages.map((message) =>
                  message.eventRecap ? (
                    <View key={message.id}>
                      <EventRecapCard data={message.eventRecap} />
                      {message.content ? (
                        <MessageBubbleInner role="assistant" content={message.content} />
                      ) : null}
                      {message.id === activeRecapId && !isReadyToSubmit && !isSubmitting && (
                        <View style={styles.recapButtonsRow}>
                          <TouchableOpacity
                            style={[styles.recapConfirmButton, { backgroundColor: colors.primary }]}
                            onPress={handleConfirmSubmit}
                            disabled={isLoading}
                          >
                            <Text style={[styles.recapConfirmText, { color: colors.onPrimary }]}>Ja, einsenden</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[styles.recapChangeButton, { borderColor: colors.border }]}
                            onPress={handleRequestChange}
                            disabled={isLoading}
                          >
                            <Text style={[styles.recapChangeText, { color: colors.textPrimary }]}>Ändern</Text>
                          </TouchableOpacity>
                        </View>
                      )}
                    </View>
                  ) : (
                    <MessageBubbleInner
                      key={message.id}
                      role={message.role}
                      content={message.content}
                      imageUrl={message.imageUrl}
                      localUri={message.localUri}
                      isLoading={message.isLoading}
                    />
                  )
                )}

                {isSubmittingEvent && (
                  <View style={styles.loadingContainer}>
                    <ActivityIndicator size="small" color={colors.primary} />
                    <Text style={[styles.loadingText, { color: colors.textSecondary }]}>Reiche Event ein...</Text>
                  </View>
                )}

                {isLoading && (
                  <View style={[styles.messageBubble, styles.assistantBubble, { backgroundColor: colors.surface }, styles.typingBubble]}>
                    <TypingIndicator />
                  </View>
                )}

                {error && (
                  <View style={[styles.errorContainer, { backgroundColor: colors.errorBackground }]}>
                    <Text style={[styles.errorText, { color: colors.error }]}>Fehler: {error}</Text>
                  </View>
                )}
              </ScrollView>

              {/* Action buttons (initial state only) */}
              {showActionButtons && (
                <View style={styles.actionButtonsContainer}>
                  <TouchableOpacity style={[styles.actionButton, { backgroundColor: colors.pressedOverlay }]} onPress={handleDescribe}>
                    <PencilIcon width={20} height={20} color={colors.textPrimary} />
                    <Text style={[styles.actionButtonTitle, { color: colors.textPrimary }]}>Beschreiben</Text>
                    <Text style={[styles.actionButtonSubtitle, { color: colors.textSecondary }]}>Gebe Name, Ort, Zeit und Veranstalter an.</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.actionButton, { backgroundColor: colors.pressedOverlay }]} onPress={handleSelectImage}>
                    <FlyerIcon width={20} height={20} color={colors.textPrimary} />
                    <Text style={[styles.actionButtonTitle, { color: colors.textPrimary }]}>Flyer einsenden</Text>
                    <Text style={[styles.actionButtonSubtitle, { color: colors.textSecondary }]}>Sende ganz einfach ein Bild von deinem Flyer</Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* Input Area OR Submit Button at BOTTOM */}
              {isReadyToSubmit ? (
                <View style={[styles.submitButtonContainer, { backgroundColor: colors.background, borderTopColor: colors.border }]}>
                  <Animated.View style={{ transform: [{ translateY: iconBounceAnim }] }}>
                    <UploadIcon width={24} height={24} color={colors.primary} />
                  </Animated.View>
                  <Text style={[styles.submitButtonTitle, { color: colors.textPrimary }]}>Jetzt einsenden</Text>
                  <Text style={[styles.submitButtonSubtitle, { color: colors.textSecondary }]}>Wischen Sie einfach hoch</Text>
                </View>
              ) : (
                <View style={[styles.inputContainer, { backgroundColor: colors.background }]}>
                  <View style={styles.inputRow}>
                    {/* Image picker button */}
                    <TouchableOpacity
                      style={styles.attachButton}
                      onPress={handleSelectImage}
                      disabled={isLoading || isSubmittingEvent}
                    >
                      <Ionicons name="image-outline" size={24} color={colors.textPrimary} />
                    </TouchableOpacity>

                    <TextInput
                      ref={inputRef}
                      style={[styles.textInput, { backgroundColor: colors.pressedOverlay, color: colors.textPrimary }]}
                      value={input}
                      onChangeText={setInput}
                      placeholder="Schreibe eine Nachricht..."
                      placeholderTextColor={colors.textTertiary}
                      multiline
                      maxLength={500}
                      editable={!isLoading && !isSubmittingEvent}
                      onSubmitEditing={() => sendMessage()}
                    />

                    <TouchableOpacity
                      style={[
                        styles.sendButton,
                        { backgroundColor: colors.primary },
                        (!input.trim() || isLoading || isSubmittingEvent) && styles.sendButtonDisabled,
                      ]}
                      onPress={() => sendMessage()}
                      disabled={!input.trim() || isLoading || isSubmittingEvent}
                    >
                      <Ionicons name="arrow-up" size={20} color={colors.onPrimary} />
                    </TouchableOpacity>
                  </View>
                </View>
              )}
            </KeyboardAvoidingView>
          </SafeAreaView>
        </Animated.View>
      </PanGestureHandler>

      {/* Fullscreen Image Preview Modal */}
      <FullScreenImagePreviewInner
        visible={showImagePreview}
        imageUri={stagedImageUri}
        onClose={handleClosePreview}
        onSend={handleSendFromPreview}
        isSending={isSendingFromPreview}
      />

      {/* Full-screen loading overlay - covers entire screen including header */}
      {isSubmitting && !showSuccessScreen && (
        <View style={[styles.fullScreenLoading, { backgroundColor: colors.primary }]}>
          <ActivityIndicator size="large" color={colors.onPrimary} style={{ marginBottom: 24 }} />
          <Text style={[styles.loadingTitle, { color: colors.onPrimary }]}>Wird eingesendet</Text>
          <Text style={styles.loadingSubtitle}>Daten werden übermittelt</Text>
        </View>
      )}

      {/* Full-screen success overlay - covers entire screen including header */}
      {showSuccessScreen && (
        <View style={[styles.fullScreenSuccess, { backgroundColor: colors.primary }]}>
          <CheckIcon width={48} height={48} color={colors.onPrimary} style={{ marginBottom: 24 }} />
          <Text style={[styles.successTitle, { color: colors.onPrimary }]}>Veranstaltung eingesendet</Text>
          <Text style={styles.successSubtitle}>
            Ihre Veranstaltung wird nun von uns überprüft und erscheint in den nächsten Tagen in der App.
          </Text>
          <View style={styles.successButtonsContainer}>
            <TouchableOpacity style={[styles.homeButton, { backgroundColor: colors.background }]} onPress={handleGoHome}>
              <Text style={[styles.homeButtonText, { color: colors.primary }]}>Zur Startseite</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.myEventsButton, { borderColor: colors.onPrimary }]} onPress={handleGoToMyEvents}>
              <Text style={[styles.myEventsButtonText, { color: colors.onPrimary }]}>Meine Veranstaltungen</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  keyboardView: {
    flex: 1,
  },
  messagesContainer: {
    flex: 1,
  },
  messagesContent: {
    paddingVertical: 16,
    paddingHorizontal: 12,
  },
  messageBubble: {
    maxWidth: '80%',
    padding: 12,
    borderRadius: 16,
    marginBottom: 12,
  },
  userBubble: {
    alignSelf: 'flex-end',
  },
  assistantBubble: {
    alignSelf: 'flex-start',
  },
  messageText: {
    fontSize: 15,
    lineHeight: 20,
  },
  loadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
  },
  loadingText: {
    fontSize: 14,
  },
  errorContainer: {
    padding: 12,
    marginBottom: 12,
    borderRadius: 8,
  },
  errorText: {
    fontSize: 14,
  },
  inputContainer: {
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
  },
  textInput: {
    flex: 1,
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 15,
    maxHeight: 100,
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendButtonDisabled: {
    opacity: 0.5,
  },
  attachButton: {
    padding: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  imageContainer: {
    marginBottom: 8,
    borderRadius: 12,
    overflow: 'hidden',
  },
  messageImage: {
    width: 200,
    height: 200,
    borderRadius: 12,
  },
  imageLoadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 12,
  },
  // New styles for redesigned chat
  chatContainer: {
    ...StyleSheet.absoluteFillObject,
  },
  safeArea: {
    flex: 1,
  },
  // Submission screen (loading + success)
  submissionScreen: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  loadingTitle: {
    fontSize: 16,
    fontFamily: 'Inter-Medium',
    textAlign: 'center',
  },
  loadingSubtitle: {
    fontSize: 14,
    fontFamily: 'Inter-Regular',
    color: 'rgba(255, 255, 255, 0.7)',
    textAlign: 'center',
    marginTop: 8,
  },
  fullScreenLoading: {
    position: 'absolute',
    top: -100,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    paddingTop: 132,
  },
  fullScreenSuccess: {
    position: 'absolute',
    top: -100,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    paddingTop: 132,
  },
  successIconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  successTitle: {
    fontSize: 16,
    fontFamily: 'Inter-Medium',
    marginBottom: 12,
    textAlign: 'center',
  },
  successSubtitle: {
    fontSize: 14,
    fontFamily: 'Inter-Regular',
    color: 'rgba(255, 255, 255, 0.8)',
    textAlign: 'center',
    lineHeight: 22,
  },
  successButtonsContainer: {
    position: 'absolute',
    bottom: 48,
    left: 24,
    right: 24,
    gap: 12,
  },
  homeButton: {
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  homeButtonText: {
    fontSize: 16,
    fontFamily: 'MonaSansSemiCondensed-Bold',
  },
  myEventsButton: {
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  myEventsButtonText: {
    fontSize: 16,
    fontFamily: 'MonaSansSemiCondensed-Bold',
  },
  // Submit button (at bottom, replacing input bar)
  submitButtonContainer: {
    alignItems: 'center',
    paddingVertical: 24,
    paddingBottom: 32,
    borderTopWidth: 1,
  },
  submitButtonTitle: {
    fontSize: 16,
    fontFamily: 'MonaSansSemiCondensed-Bold',
    marginTop: 12,
  },
  submitButtonSubtitle: {
    fontSize: 12,
    fontFamily: 'MonaSansSemiCondensed-Bold',
    marginTop: 4,
  },
  // Recap confirm/change buttons (under the recap card)
  recapButtonsRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 12,
  },
  recapConfirmButton: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recapConfirmText: {
    fontSize: 15,
    fontFamily: 'MonaSansSemiCondensed-Bold',
  },
  recapChangeButton: {
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recapChangeText: {
    fontSize: 15,
    fontFamily: 'MonaSansSemiCondensed-Bold',
  },
  // Action buttons
  actionButtonsContainer: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  actionButton: {
    flex: 1,
    borderRadius: 12,
    padding: 16,
    alignItems: 'flex-start',
  },
  actionButtonTitle: {
    fontSize: 14,
    fontFamily: 'MonaSansSemiCondensed-Bold',
    marginTop: 8,
  },
  actionButtonSubtitle: {
    fontSize: 12,
    fontFamily: 'MonaSansSemiCondensed-Bold',
    marginTop: 4,
  },
  // Typing indicator styles
  typingIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
  },
  typingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  typingBubble: {
    paddingVertical: 16,
    paddingHorizontal: 16,
  },
});
