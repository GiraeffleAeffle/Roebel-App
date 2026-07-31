/**
 * DSGVO/GDPR consent — single source of truth for category metadata,
 * policy version, and SecureStore key names.
 */

export const PRIVACY_POLICY_VERSION = '1.1.0';

export const CONSENT_STORAGE_KEYS = {
  preferences: 'consent.v1.preferences',
  policyVersion: 'consent.v1.policyVersion',
  deviceId: 'consent.v1.deviceId',
  promptState: 'consent.v1.promptState',
  grandfatherBannerDismissed: 'consent.v1.grandfatherBannerDismissed',
  walletReconciled: 'consent.v1.walletReconciled',
} as const;

export type ConsentCategoryId =
  | 'essential'
  | 'analytics'
  | 'crash'
  | 'ai_assistant'
  | 'maps_location'
  | 'push';

export type ConsentPreferences = Record<ConsentCategoryId, boolean>;

export type ConsentSource =
  | 'first_launch'
  | 'customize_screen'
  | 'reconsent'
  | 'banner'
  | 'banner_dismissed'
  | 'migration'
  | 'reconcile'
  | 'welcome_terms';

export type ConsentCategory = {
  id: ConsentCategoryId;
  title: string;
  oneLineDe: string;
  processors: { name: string; region: 'EU' | 'USA' | 'Multi' | 'Device' }[];
  retention: string;
  isLocked: boolean;
  legalBasis: string;
  detailDe: string;
};

export const CONSENT_CATEGORIES: ConsentCategory[] = [
  {
    id: 'essential',
    title: 'Notwendig',
    oneLineDe:
      'Für die App-Funktion erforderlich. Speichert dein Profil und ermöglicht den Login.',
    processors: [
      { name: 'Supabase', region: 'EU' },
      { name: 'Thirdweb', region: 'Multi' },
    ],
    retention: 'Solange dein Konto besteht',
    isLocked: true,
    legalBasis: 'Art. 6 Abs. 1 lit. b DSGVO (Vertragserfüllung)',
    detailDe:
      'Diese Dienste werden für den Betrieb der App benötigt. Ohne sie können wir dir keine Funktionen zur Verfügung stellen — Login, Profil und Speicherung deiner Daten wären nicht möglich.',
  },
  {
    id: 'analytics',
    title: 'Statistik & Verbesserung',
    oneLineDe:
      'Hilft uns, die App durch anonymisierte Nutzungsdaten zu verbessern.',
    processors: [{ name: 'PostHog Cloud (AWS Frankfurt)', region: 'EU' }],
    retention: '90 Tage',
    isLocked: false,
    legalBasis: 'Art. 6 Abs. 1 lit. a DSGVO (Einwilligung)',
    detailDe:
      'Wir messen anonymisiert, welche Bildschirme genutzt werden und wo Nutzer hängenbleiben — damit wir die App gezielt verbessern können. Keine Session-Aufzeichnung. Verarbeitung auf AWS-Servern in Frankfurt.',
  },
  {
    id: 'crash',
    title: 'Fehlerprotokollierung',
    oneLineDe:
      'Erkennt und meldet Fehler automatisch, damit wir sie schneller beheben.',
    processors: [{ name: 'Sentry', region: 'USA' }],
    retention: '90 Tage',
    isLocked: false,
    legalBasis: 'Art. 6 Abs. 1 lit. a DSGVO (Einwilligung)',
    detailDe:
      'Bei einem Absturz senden wir den Stack-Trace an Sentry, damit wir das Problem reproduzieren können. Zur besseren Fehleranalyse werden außerdem deine IP-Adresse, dein Geräte- und App-Kontext (z. B. Betriebssystem, App-Version, Sprache) und deine pseudonyme Wallet-Adresse übermittelt — keine Inhalte deiner Nachrichten oder Eingaben. Übermittlung in die USA auf Basis der Standardvertragsklauseln (SCCs) und des EU-US Data Privacy Framework (DPF).',
  },
  {
    id: 'ai_assistant',
    title: 'Mecky-KI Assistent',
    oneLineDe: 'Mecky beantwortet deine Fragen auf Deutsch.',
    processors: [{ name: 'Anthropic', region: 'USA' }],
    retention: '30 Tage (Anthropic-Standard)',
    isLocked: false,
    legalBasis: 'Art. 6 Abs. 1 lit. a DSGVO (Einwilligung)',
    detailDe:
      'Deine Nachrichten werden an Anthropics Claude-Modell in den USA übermittelt, um eine Antwort zu generieren. Übermittlung auf Basis von SCCs und DPF. Anthropic nutzt deine Daten nicht zum Modelltraining.',
  },
  {
    id: 'maps_location',
    title: 'Karten & Standort',
    oneLineDe: 'Zeigt Karten und nahegelegene Veranstaltungen.',
    processors: [
      { name: 'Mapbox', region: 'USA' },
      { name: 'Geräte-Standort', region: 'Device' },
    ],
    retention: 'Nur während der Nutzung',
    isLocked: false,
    legalBasis: 'Art. 6 Abs. 1 lit. a DSGVO (Einwilligung)',
    detailDe:
      'Mapbox rendert die Karten und übermittelt dabei Kartenausschnitt-Anfragen in die USA (SCCs/DPF). Dein präziser Standort verlässt das Gerät nur, wenn du eine Suche „in meiner Nähe" startest.',
  },
  {
    id: 'push',
    title: 'Push-Benachrichtigungen',
    oneLineDe: 'Sendet dir Benachrichtigungen, wenn etwas wichtig ist.',
    processors: [
      { name: 'Expo Push', region: 'USA' },
      { name: 'Apple APNs / Google FCM', region: 'Multi' },
    ],
    retention: 'Bis du den Token widerrufst',
    isLocked: false,
    legalBasis: 'Art. 6 Abs. 1 lit. a DSGVO (Einwilligung)',
    detailDe:
      'Wir registrieren ein Gerätetoken bei Expo, um dir Push-Benachrichtigungen zu Veranstaltungen, Nachrichten und Belohnungen zu senden. Der Token wird beim Widerruf gelöscht.',
  },
];

export const DEFAULT_PREFERENCES: ConsentPreferences = {
  essential: true,
  analytics: false,
  crash: false,
  ai_assistant: false,
  maps_location: false,
  push: false,
};

export const ACCEPT_ALL_PREFERENCES: ConsentPreferences = {
  essential: true,
  analytics: true,
  crash: true,
  ai_assistant: true,
  maps_location: true,
  push: true,
};

export const POLICY_CHANGELOG: Record<string, string[]> = {
  '1.1.0': [
    'Neu: der öffentliche Datenbestand von Röbel. Öffentliche Beiträge von Bürger:innen werden mit deinem persönlichen Schlüssel signiert und dauerhaft öffentlich — auch für andere Apps lesbar.',
    'Eine Löschung kann angefragt, aber nicht überall erzwungen werden. Details in den Einstellungen unter „Nostr-Identität".',
    'Neu: Kennzeichnung von KI-Inhalten (Mecky, generierte Bilder und Texte).',
  ],
  '1.0.0': [
    'Erste Version unserer feingranularen Datenschutz-Einstellungen.',
    'Du kannst Statistik, Fehlerprotokollierung, Mecky-KI, Karten und Push einzeln steuern.',
  ],
};

export const SMART_REPROMPT = {
  /** Max contextual dismissals per category before we stop auto-prompting forever. */
  maxDismissals: 2,
  /** Rolling window for dismissal counting, in ms. */
  windowMs: 30 * 24 * 60 * 60 * 1000, // 30 days
} as const;
