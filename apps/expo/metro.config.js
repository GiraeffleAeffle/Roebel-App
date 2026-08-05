// Learn more https://docs.expo.io/guides/customizing-metro
const { getDefaultConfig } = require("expo/metro-config");
/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// NOTE on the pnpm monorepo: getDefaultConfig() ALREADY auto-configures Metro for
// this workspace — its watchFolders include the root node_modules (.pnpm store,
// where react-native + every dep actually live) and each workspace package
// (incl. @netizen-labs/miniapp-sdk). Do NOT override watchFolders — an earlier override
// either OOM'd (whole-repo crawl) or broke react-native resolution (dropped the
// root store). We only PRUNE the crawl below: the two Next.js mini apps under
// apps/mini-apps/* are workspace members (so getDefaultConfig watches them) but the
// Expo app never imports them, and crawling their source + node_modules bloated the
// bundler heap during `expo export --platform=all`. Excluding them keeps memory at
// the pre-mini-app baseline. The SDK still resolves (it's packages/miniapp-sdk).

// SVG transformer configuration
config.transformer.babelTransformerPath = require.resolve('react-native-svg-transformer');
config.resolver.assetExts = config.resolver.assetExts.filter((ext) => ext !== 'svg');
config.resolver.sourceExts = [...config.resolver.sourceExts, 'svg'];

// Add Node.js polyfills for React Native
config.resolver.extraNodeModules = {
  crypto: require.resolve('react-native-quick-crypto'),
  stream: require.resolve('stream-browserify'),
  buffer: require.resolve('buffer'),
  process: require.resolve('process/browser.js'),
  path: require.resolve('path-browserify'),
  os: require.resolve('os-browserify/browser'),
  http: require.resolve('http-browserify'),
  https: require.resolve('https-browserify'),
  url: require.resolve('url'),
  assert: require.resolve('assert'),
  util: require.resolve('util'),
  querystring: require.resolve('querystring'),
  events: require.resolve('events'),
  net: require.resolve('react-native-tcp-socket'),
  tls: require.resolve('react-native-tcp-socket'),
  ws: require.resolve('isomorphic-ws'),
};

// Ensure these globals are available
config.resolver.platforms = ['ios', 'android', 'native', 'web'];

// Block problematic server modules + the sibling Next.js mini apps (workspace
// members the Expo app never imports — pruned to keep the file map / heap small).
config.resolver.blockList = [
  /ws\/lib\/websocket-server\.js$/,
  /ws\/wrapper\.mjs$/,
  /[/\\]apps[/\\]mini-apps[/\\].*/,
];

// Custom resolver to exclude problematic modules from bundle
config.resolver.resolveRequest = (context, moduleName, platform) => {
  // Web: node's `crypto` must NOT resolve to react-native-quick-crypto — the
  // extraNodeModules alias above applies to every platform and quick-crypto's
  // import side effect requires the native QuickCrypto module (boot crash on
  // web). Route both names to the pure-JS implementation instead.
  if (
    platform === 'web' &&
    (moduleName === 'crypto' ||
      moduleName === 'react-native-quick-crypto' ||
      moduleName.startsWith('react-native-quick-crypto/'))
  ) {
    return context.resolveRequest(context, 'crypto-browserify', platform);
  }

  // Exclude react-native-mmkv (all platforms)
  if (moduleName === 'react-native-mmkv' || moduleName.includes('react-native-mmkv')) {
    return { type: 'empty' };
  }

  // Exclude native-only modules on web
  if (platform === 'web') {
    const webExclude = [
      'react-native-tcp-socket',
      'react-native-quick-crypto',
      'react-native-aes-gcm-crypto',
      'react-native-passkey',
      '@rnmapbox/maps',
      '@coinbase/wallet-mobile-sdk',
      '@walletconnect/react-native-compat',
      'react-native-qrcode-svg',
      'expo-screen-orientation',
      'react-native-web-webview',
      'react-native-pager-view',
    ];
    if (webExclude.some(pkg => moduleName === pkg || moduleName.startsWith(pkg + '/'))) {
      return { type: 'empty' };
    }
  }

  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
