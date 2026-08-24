import 'dotenv/config';
import type { ExpoConfig } from 'expo/config';

const config: ExpoConfig = {
  name: 'Röbel',
  slug: 'roebel-onchain',
  scheme: 'roebel',
  // 3.5.0 = first XMTP-era runtime. runtimeVersion follows appVersion, so this
  // bump FENCES old 3.4.0 builds from ever receiving XMTP-era JS via OTA
  // (2026-07-10: a main-tip preview update onto the 3.4.0 runtime crash-looped
  // a device — never publish post-XMTP JS to pre-XMTP builds).
  version: '3.5.0',
  orientation: 'portrait',
  icon: './assets/images/icon.png',
  userInterfaceStyle: 'automatic',
  owner: 'max.brych',
  splash: {
    image: './assets/images/splash.png',
    resizeMode: 'contain',
    backgroundColor: '#00498B'
  },
  extra: {
    eas: {
      projectId: 'cb460582-e228-4a96-8235-92eb13006239'
    },
    SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
    THIRDWEB_CLIENT_ID: process.env.EXPO_PUBLIC_THIRDWEB_CLIENT_ID || '',
    EXPO_PUBLIC_GOOGLE_MAPS_API_KEY: process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || '',
    IRYS_UPLOAD_PRIVATE_KEY: process.env.IRYS_UPLOAD_PRIVATE_KEY || '',
    EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN: process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN || '',
    MINIAPP_API_BASE: process.env.EXPO_PUBLIC_MINIAPP_API_BASE || 'https://www.roebel.app',
    posthogApiKey: process.env.EXPO_PUBLIC_POSTHOG_KEY || '',
    posthogHost: process.env.EXPO_PUBLIC_POSTHOG_HOST || 'https://eu.i.posthog.com',
    sentryDsn: process.env.EXPO_PUBLIC_SENTRY_DSN || ''
  },
  experiments: {
    typedRoutes: true,
    reactCompiler: true
  },
  plugins: [
    [
      'expo-router',
      {
        asyncRoutes: { android: false, ios: false, default: 'development' }
      }
    ],
    [
      '@rnmapbox/maps',
      {
        RNMapboxMapsVersion: '11.16.2',
      }
    ],
    'expo-secure-store',
    'expo-font',
    'expo-web-browser',
    [
      'expo-location',
      {
        locationWhenInUsePermission:
          'Röbel nutzt deinen Standort, (1) um zu prüfen, dass du dich im Röbel/Müritz-Gebiet befindest — Voraussetzung für Beiträge im lokalen Bürger-Feed — und (2) um die Karte automatisch auf deine aktuelle Position zu zentrieren. — Röbel uses your location to (1) verify you are within the Röbel/Müritz area before allowing you to post in the local citizen feed, and (2) center the map on your current position when you open the Karte tab.',
        isIosBackgroundLocationEnabled: false,
        isAndroidBackgroundLocationEnabled: false,
      },
    ],
    [
      'expo-camera',
      {
        cameraPermission: 'Allow $(PRODUCT_NAME) to access your camera to scan verification QR codes.'
      }
    ],
    [
      'expo-image-picker',
      {
        photosPermission: 'Die App benötigt Zugriff auf deine Fotos um Event-Flyer hochzuladen.'
      }
    ],
    [
      'expo-notifications',
      {
        icon: './assets/images/notification-icon.png',
        color: '#00498B'
      }
    ],
    [
      'expo-calendar',
      {
        calendarPermission: 'Die App benötigt Zugriff auf deinen Kalender um Veranstaltungen zu speichern.',
      }
    ],
    'expo-updates',
    '@react-native-community/datetimepicker',
    'expo-image',
    'expo-localization',
    [
      'expo-video',
      {
        supportsBackgroundPlayback: false,
        supportsPictureInPicture: true,
      },
    ],
    'expo-audio',
    [
      '@sentry/react-native/expo',
      {
        organization: 'robel-labs',
        project: 'react-native',
      }
    ],
    './plugins/withExcludeBouncyCastle',
    './plugins/withRemoveJcenter',
    // XMTP pulls SQLCipher — switch expo-updates off the system SQLite3
    // module or the iOS build fails (see plugin header).
    './plugins/withXmtpThirdPartySQLite',
    // Strips `audio` from UIBackgroundModes that expo-audio adds by default.
    // Story audio is foreground-only — Apple review 2.5.4 rejects the entry
    // otherwise. MUST run after expo-audio above.
    './plugins/withRemoveAudioBackgroundMode',
    [
      'expo-build-properties',
      {
        android: {
          minSdkVersion: 26,
          compileSdkVersion: 36,
          targetSdkVersion: 35,
          buildToolsVersion: '35.0.0',
          newArchEnabled: true,
          unstable_networkInspector: false,
          useLegacyPackaging: false,
          extraProguardRules: '-keep class androidx.** { *; }',
          androidGradlePluginVersion: '8.7.3',
          ndkVersion: '27.1.12297006',
          extraCMakeArgs: ['-DANDROID_SUPPORT_FLEXIBLE_PAGE_SIZES=ON']
        },
        ios: {
          newArchEnabled: true,
          deploymentTarget: '16.0',
          extraPods: [
            {
              name: 'OpenSSL-Universal',
              configurations: ['Release', 'Debug'],
              modular_headers: true,
              version: '3.3.2000'
            }
          ]
        }
      }
    ],
  ],
  ios: {
    bundleIdentifier: 'com.maxbrych.roebelonchain',
    googleServicesFile: process.env.GOOGLE_SERVICES_PLIST ?? './keys/GoogleService-Info.plist',
    buildNumber: '31',
    supportsTablet: true,
    associatedDomains: [
      'webcredentials:thirdweb.com',
      'applinks:thirdweb.com',
      'applinks:roebel.app',
      'applinks:www.roebel.app'
    ],
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
      NSCalendarsUsageDescription: 'Die App benötigt Zugriff auf deinen Kalender um Veranstaltungen zu speichern.',
      NSLocationWhenInUseUsageDescription:
        'Röbel nutzt deinen Standort, (1) um zu prüfen, dass du dich im Röbel/Müritz-Gebiet befindest — Voraussetzung für Beiträge im lokalen Bürger-Feed — und (2) um die Karte automatisch auf deine aktuelle Position zu zentrieren. — Röbel uses your location to (1) verify you are within the Röbel/Müritz area before allowing you to post in the local citizen feed, and (2) center the map on your current position when you open the Karte tab.',
    }
  },
  android: {
    package: 'com.maxbrych.roebelonchain',
    googleServicesFile: process.env.GOOGLE_SERVICES_JSON ?? './keys/google-services.json',
    versionCode: 37,
    adaptiveIcon: {
      foregroundImage: './assets/images/adaptive-icon.png',
      backgroundColor: '#00498B'
    },
    permissions: [
      'android.permission.POST_NOTIFICATIONS',
      'android.permission.READ_CALENDAR',
      'android.permission.WRITE_CALENDAR',
    ],
    intentFilters: [
      {
        autoVerify: true,
        action: 'VIEW',
        data: {
          scheme: 'https',
          host: 'thirdweb.com'
        },
        category: ['BROWSABLE', 'DEFAULT']
      },
      // Smart Event QR (/e/<id>) deep links — attendance reward
      {
        autoVerify: true,
        action: 'VIEW',
        data: { scheme: 'https', host: 'roebel.app', pathPrefix: '/e/' },
        category: ['BROWSABLE', 'DEFAULT']
      },
      {
        autoVerify: true,
        action: 'VIEW',
        data: { scheme: 'https', host: 'www.roebel.app', pathPrefix: '/e/' },
        category: ['BROWSABLE', 'DEFAULT']
      },
      // Event deep links
      {
        autoVerify: true,
        action: 'VIEW',
        data: { scheme: 'https', host: 'roebel.app', pathPrefix: '/event' },
        category: ['BROWSABLE', 'DEFAULT']
      },
      {
        autoVerify: true,
        action: 'VIEW',
        data: { scheme: 'https', host: 'roebel.app', pathPrefix: '/events' },
        category: ['BROWSABLE', 'DEFAULT']
      },
      {
        autoVerify: true,
        action: 'VIEW',
        data: { scheme: 'https', host: 'www.roebel.app', pathPrefix: '/event' },
        category: ['BROWSABLE', 'DEFAULT']
      },
      {
        autoVerify: true,
        action: 'VIEW',
        data: { scheme: 'https', host: 'www.roebel.app', pathPrefix: '/events' },
        category: ['BROWSABLE', 'DEFAULT']
      },
      // News deep links
      {
        autoVerify: true,
        action: 'VIEW',
        data: { scheme: 'https', host: 'roebel.app', pathPrefix: '/news' },
        category: ['BROWSABLE', 'DEFAULT']
      },
      {
        autoVerify: true,
        action: 'VIEW',
        data: { scheme: 'https', host: 'www.roebel.app', pathPrefix: '/news' },
        category: ['BROWSABLE', 'DEFAULT']
      },
      // Proposals
      {
        autoVerify: true,
        action: 'VIEW',
        data: { scheme: 'https', host: 'roebel.app', pathPrefix: '/proposals' },
        category: ['BROWSABLE', 'DEFAULT']
      },
      {
        autoVerify: true,
        action: 'VIEW',
        data: { scheme: 'https', host: 'www.roebel.app', pathPrefix: '/proposals' },
        category: ['BROWSABLE', 'DEFAULT']
      },
      // Restaurant table ordering (QR codes)
      {
        autoVerify: true,
        action: 'VIEW',
        data: { scheme: 'https', host: 'roebel.app', pathPrefix: '/order' },
        category: ['BROWSABLE', 'DEFAULT']
      },
      {
        autoVerify: true,
        action: 'VIEW',
        data: { scheme: 'https', host: 'www.roebel.app', pathPrefix: '/order' },
        category: ['BROWSABLE', 'DEFAULT']
      },
      // User profiles
      {
        autoVerify: true,
        action: 'VIEW',
        data: { scheme: 'https', host: 'roebel.app', pathPrefix: '/profile' },
        category: ['BROWSABLE', 'DEFAULT']
      },
      {
        autoVerify: true,
        action: 'VIEW',
        data: { scheme: 'https', host: 'www.roebel.app', pathPrefix: '/profile' },
        category: ['BROWSABLE', 'DEFAULT']
      },
      // Invite deep links
      {
        autoVerify: true,
        action: 'VIEW',
        data: { scheme: 'https', host: 'roebel.app', pathPrefix: '/invite' },
        category: ['BROWSABLE', 'DEFAULT']
      },
      {
        autoVerify: true,
        action: 'VIEW',
        data: { scheme: 'https', host: 'www.roebel.app', pathPrefix: '/invite' },
        category: ['BROWSABLE', 'DEFAULT']
      },
      // Authenticated web routes (/app/*)
      {
        autoVerify: true,
        action: 'VIEW',
        data: { scheme: 'https', host: 'roebel.app', pathPrefix: '/app/events' },
        category: ['BROWSABLE', 'DEFAULT']
      },
      {
        autoVerify: true,
        action: 'VIEW',
        data: { scheme: 'https', host: 'roebel.app', pathPrefix: '/app/news' },
        category: ['BROWSABLE', 'DEFAULT']
      },
      {
        autoVerify: true,
        action: 'VIEW',
        data: { scheme: 'https', host: 'roebel.app', pathPrefix: '/app/posts' },
        category: ['BROWSABLE', 'DEFAULT']
      },
      {
        autoVerify: true,
        action: 'VIEW',
        data: { scheme: 'https', host: 'roebel.app', pathPrefix: '/app/proposals' },
        category: ['BROWSABLE', 'DEFAULT']
      },
      {
        autoVerify: true,
        action: 'VIEW',
        data: { scheme: 'https', host: 'roebel.app', pathPrefix: '/app/gewerbe' },
        category: ['BROWSABLE', 'DEFAULT']
      },
      {
        autoVerify: true,
        action: 'VIEW',
        data: { scheme: 'https', host: 'roebel.app', pathPrefix: '/app/angebote' },
        category: ['BROWSABLE', 'DEFAULT']
      },
      {
        autoVerify: true,
        action: 'VIEW',
        data: { scheme: 'https', host: 'roebel.app', pathPrefix: '/app/marktplatz' },
        category: ['BROWSABLE', 'DEFAULT']
      },
      {
        autoVerify: true,
        action: 'VIEW',
        data: { scheme: 'https', host: 'www.roebel.app', pathPrefix: '/app/events' },
        category: ['BROWSABLE', 'DEFAULT']
      },
      {
        autoVerify: true,
        action: 'VIEW',
        data: { scheme: 'https', host: 'www.roebel.app', pathPrefix: '/app/news' },
        category: ['BROWSABLE', 'DEFAULT']
      },
      {
        autoVerify: true,
        action: 'VIEW',
        data: { scheme: 'https', host: 'www.roebel.app', pathPrefix: '/app/posts' },
        category: ['BROWSABLE', 'DEFAULT']
      },
      {
        autoVerify: true,
        action: 'VIEW',
        data: { scheme: 'https', host: 'www.roebel.app', pathPrefix: '/app/proposals' },
        category: ['BROWSABLE', 'DEFAULT']
      },
      {
        autoVerify: true,
        action: 'VIEW',
        data: { scheme: 'https', host: 'www.roebel.app', pathPrefix: '/app/gewerbe' },
        category: ['BROWSABLE', 'DEFAULT']
      },
      {
        autoVerify: true,
        action: 'VIEW',
        data: { scheme: 'https', host: 'www.roebel.app', pathPrefix: '/app/angebote' },
        category: ['BROWSABLE', 'DEFAULT']
      },
      {
        autoVerify: true,
        action: 'VIEW',
        data: { scheme: 'https', host: 'www.roebel.app', pathPrefix: '/app/marktplatz' },
        category: ['BROWSABLE', 'DEFAULT']
      },
    ]
  },
  updates: {
    url: 'https://u.expo.dev/cb460582-e228-4a96-8235-92eb13006239',
  },
  runtimeVersion: {
    policy: 'appVersion',
  },
  web: {
    bundler: 'metro',
    output: 'single',
    favicon: './assets/images/favicon.png'
  }
};

export default config;
