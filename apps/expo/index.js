import { Platform } from "react-native";
import "react-native-get-random-values";

// PWA: register the service worker (web production only — dev would cache
// Metro's ever-changing bundles).
// __SMOKE_TEST__: see scripts/web-smoke.mjs — SW cannot register under route interception.
if (Platform.OS === "web" && !__DEV__ && typeof navigator !== "undefined" && "serviceWorker" in navigator && !globalThis.__SMOKE_TEST__) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((e) => {
      console.warn("Service worker registration failed:", e?.message ?? e);
    });
  });
}

// DISABLED — in-app debug log viewer kept for later. To re-enable, uncomment
// the two lines below AND the <DebugLogOverlay /> mount + import in app/_layout.tsx.
// (Feature code lives in lib/debug-logs.ts + components/DebugLogOverlay.tsx.)
// import { installDebugLogCapture } from "./lib/debug-logs";
// installDebugLogCapture();

// Sentry is initialized lazily inside <ConsentGate /> once the user opts in
// to crash reporting. Until then, errors are buffered locally — see
// lib/sentry-init.ts.

// Suppress thirdweb HMR error in development (Metro/thirdweb incompatibility)
// Thirdweb's native-connector.js dynamically loads modules during auth,
// which triggers Metro's HMR assertion before the client is initialized.
// This is a dev-only issue — production builds are unaffected.
if (__DEV__) {
  // 1. Suppress via global error handler (catches thrown errors)
  const originalHandler = ErrorUtils.getGlobalHandler();
  ErrorUtils.setGlobalHandler((error, isFatal) => {
    if (
      !isFatal &&
      typeof error?.message === "string" &&
      error.message.includes("Expected HMRClient.setup()")
    ) {
      return; // Silently ignore
    }
    originalHandler(error, isFatal);
  });

  // 2. Suppress via console.error (catches React Native LogBox alerts)
  const originalConsoleError = console.error;
  console.error = (...args) => {
    const msg = typeof args[0] === "string" ? args[0] : "";
    if (msg.includes("Expected HMRClient.setup()")) return;
    originalConsoleError(...args);
  };

  // 3. Suppress via LogBox if available
  try {
    const { LogBox } = require("react-native");
    LogBox.ignoreLogs(["Expected HMRClient.setup()"]);
  } catch {}
}

// Add polyfills for Node.js modules
if (typeof global.Buffer === 'undefined') {
  global.Buffer = require('buffer').Buffer;
}

if (typeof global.process === 'undefined') {
  global.process = require('process');
}

// Web only: react-native's own core init (Libraries/Core/setUpGlobals.js,
// pulled in as a side effect of the `react-native` import above) runs BEFORE
// this file's plain statements and unconditionally does
// `global.process = global.process || {}` (+ `.env`) — so by the time the
// guard above runs, global.process is already defined (as that bare `{env}`
// object) and the guard never fires. `process.browser` / `process.version`
// stay undefined, which crashes several browserify-era transitive deps
// (readable-stream et al., pulled in via the stream/crypto polyfills in
// metro.config.js) that do `!process.browser && process.version.slice(...)`
// at module-load time: boot fails with body never rendering. Merge the full
// process/browser.js shim's fields on top, on web only, keeping whatever env
// react-native already populated. Native is untouched (block never runs
// there), and this app never itself relies on `process.browser` semantics.
if (Platform.OS === 'web' && typeof global.process.browser === 'undefined') {
  const browserProcess = require('process');
  Object.assign(global.process, browserProcess, {
    env: { ...browserProcess.env, ...global.process.env },
  });
}

// Import Thirdweb adapter synchronously for non-web platforms
// Wrapped in try-catch so Expo Go doesn't crash (native crypto module unavailable)
if (Platform.OS !== "web") {
  try {
    require("@thirdweb-dev/react-native-adapter");
  } catch (e) {
    console.warn("Thirdweb adapter failed to load (expected in Expo Go):", e.message);
  }
}

import "react-native-reanimated";
import "expo-router/entry";
