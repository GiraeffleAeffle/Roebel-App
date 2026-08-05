# Expo Web PWA — Design

**Date:** 2026-08-05
**Status:** Approved design, pending implementation plan
**Goal owner:** Max

## 1. Goal

Make `apps/expo` installable as a fully working PWA so the app can be
distributed **without the App Store or Play Store**. This is the key unlock
for forkability: any community deploying its own instance gets a full app
from a static bundle on any host — no Apple developer account, no EAS
builds, no store review. On iOS a PWA is the *only* store-free path, so the
web target cannot be a second-class surface.

The Expo app gains a third build target alongside native iOS and Android:
a static web export (`expo export --platform web`) served as an installable
PWA. `apps/web` (Next.js) remains the public/SEO site.

## 2. Verified starting point (2026-08-05)

Checked against the real tree, not assumptions:

- `expo export --platform web` **builds today with zero errors** — 57 MB
  total across well-code-split chunks, small entry bundle. (`web` block in
  `app.config.ts`: Metro bundler, `output: 'single'`.)
- Booting the export in headless Chromium fails on exactly **one** error:
  `metro.config.js` aliases `crypto` → `react-native-quick-crypto` via
  `extraNodeModules` for *all* platforms, bypassing the `webExclude` list;
  quick-crypto's import side effect requires the native `QuickCrypto`
  module and throws before first render.
- Existing web groundwork: `app/+html.tsx` shell; Metro `webExclude`
  empties 11 native-only packages on web; seven `.web.ts(x)` platform forks
  (QR scanner, Mapbox placeholder, notifications stub, location, bookmarks,
  color scheme, notification inbox); XMTP is probed via
  `requireOptionalNativeModule('XMTP')` and degrades gracefully;
  `react-native-web` is installed; thirdweb v5 auth (inAppWallet + smart
  account) is web-first and needs no adaptation.
- `expo-secure-store`'s web build is an **empty module** — the bundle
  builds, but all 9 call sites throw at runtime on web
  (`lib/maci.ts`, `lib/bookmarks.ts`, `lib/citizen-commitment.ts`,
  `lib/consent-storage.ts`, `lib/xmtp/client.ts`, `lib/nostr/identity.ts`,
  `lib/nostr/enroll.ts`, `context/ConsentContext.tsx`,
  `context/MaciContext.tsx`). `lib/xmtp/client.ts` is unreachable on web
  (behind the native-module probe); `lib/bookmarks.ts` already has a
  `.web` fork.

## 3. Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Domain | `app.roebel.app` (forks: their own subdomain) | Clean separation from Next.js routes; deep links migrate later |
| SecureStore web fallback | Plain namespaced `localStorage` | All secrets stored there are wallet-derived and re-derivable; XSS defeats any browser storage equally, so encryption-at-rest adds complexity without changing the threat model |
| Service worker | Hand-rolled minimal (~100 lines) | Export chunks are content-hashed → trivial cache strategy; no Workbox dependency bolted onto Metro |
| Web push | Follow-up phase, not initial ship | Ship boot + installable first; push rail lands once the surface is proven |

### Threat-model note (localStorage)

On native, secrets live in Keychain/Keystore. On web they move to
`localStorage`, which any successful XSS can read. Accepted because:
(a) MACI voting keys, the citizen commitment, and the Nostr identity are
all deterministically re-derivable from the thirdweb wallet — loss is
recoverable and theft requires an attack that would equally compromise an
encrypted-at-rest scheme whose key sits in IndexedDB; (b) consent/prompt
state is not secret. This trade-off is surfaced here deliberately; revisit
if any *non-re-derivable* secret ever lands in the storage wrapper.

## 4. Architecture

### Phase 1 — Boot on web

Method: fix-crash → re-export → headless boot test → repeat until done.
A Playwright boot harness exists (loads the static export via request
interception, captures console/page errors and a screenshot) and becomes
the acceptance gate.

1. **Platform-fork the `crypto` alias** in `metro.config.js`: in
   `resolveRequest`, on `platform === 'web'` resolve `crypto` to a
   browser implementation (`crypto-browserify`, or a thinner WebCrypto
   shim if only `randomBytes`/hashes are used — confirm consumers during
   implementation). Native keeps quick-crypto untouched.
2. **Storage wrapper** `lib/storage/secureStorage.ts` with the
   expo-secure-store API surface (`getItemAsync`/`setItemAsync`/
   `deleteItemAsync`, options ignored on web). Native delegates to
   expo-secure-store; `secureStorage.web.ts` uses namespaced
   `localStorage` (`roebel.secure.<keychainService>.<key>`). Rewire the
   5 web-reachable call sites: `lib/citizen-commitment.ts`,
   `lib/consent-storage.ts`, `lib/nostr/enroll.ts`,
   `lib/nostr/identity.ts`, `context/MaciContext.tsx`. (Of the 9 files
   matching a broad grep, `lib/maci.ts` and `context/ConsentContext.tsx`
   mention the package in comments only, `lib/xmtp/client.ts` is
   unreachable behind the native probe, and `lib/bookmarks.ts` is already
   shadowed by its `.web` fork.)
3. **Boot-path audit**: no-op or guard remaining native touches on web
   (expo-updates checks, splash screen, haptics, any module the boot
   harness surfaces next).

**Acceptance:** boot harness shows the login screen with zero page
errors; thirdweb inAppWallet login completes in a real browser; feed
renders with live Supabase data.

### Phase 2 — PWA layer

1. **Manifest** (`public/manifest.json`, copied into the export):
   name "Röbel", German lang, `display: standalone`, theme/background
   `#00498B`, icons generated from the existing master
   (`apps/web/public/favicon.svg` per the icon pipeline) at 192/512 +
   maskable.
2. **`+html.tsx` additions:** manifest link, `apple-touch-icon`,
   `apple-mobile-web-app-capable`, theme-color, viewport-fit.
3. **Service worker** (`public/sw.js`, hand-rolled): precache the entry
   HTML on install; cache-first for `/_expo/static/*` (content-hashed →
   immutable); network-first with cache fallback for `index.html`;
   versioned cache purge on activate; minimal offline fallback page
   (German). Registered from the web branch of the app entry.
4. **Install UX:** capture `beforeinstallprompt` (Android/desktop) and
   offer an install button; iOS Safari gets a German "Zum
   Home-Bildschirm hinzufügen" hint. Detect standalone display-mode to
   hide prompts once installed.
5. **Hosting:** static deploy of the export at `app.roebel.app` with SPA
   rewrite (all routes → `index.html`). Export runs with
   `NODE_OPTIONS=--max-old-space-size=8192` (already the repo norm).

**Acceptance:** Lighthouse PWA installability passes; app installs to
home screen on Android Chrome and iOS Safari; cold reload works offline
to the shell/offline page.

### Phase 3 — Web push rail (follow-up)

- VAPID keypair; push subscription flow in `useNotifications.web.ts`
  (replacing the stub); subscription JSON stored in the existing
  `push_tokens` table with `platform='web'`.
- `send-notification` edge function gains a web-push sender (VAPID)
  alongside Expo push.
- iOS constraint documented in-app: web push requires the PWA installed
  to the home screen (iOS 16.4+).

### Phase 4 — Deferred (explicitly out of scope now)

- XMTP browser SDK rail (web DMs stay on the Supabase Realtime rail).
- Real map on web (mapbox-gl fork replacing the placeholder).
- Deeper offline (data caching beyond the app shell).
- Migrating `/app/*` universal links from `roebel.app` to the PWA.

## 5. Web degrade matrix

| Capability | Web behavior |
|---|---|
| Login / smart account / gasless tx | Full (thirdweb web-first) |
| Feed, events, news, proposals, voting | Full (Supabase + chain reads) |
| DMs | Supabase Realtime rail only; XMTP rail native-only |
| Push | None until Phase 3; then web push (iOS: installed PWA only) |
| Map | Placeholder view (Phase 4: mapbox-gl) |
| QR scan | Existing web fork (getUserMedia) |
| Camera/image upload | expo-image-picker web (file input) |
| Calendar, haptics, sensors | No-op |
| Secure storage | localStorage (see threat-model note) |

## 6. Testing

- The Playwright **boot harness** graduates into the repo as a web smoke
  test (`apps/expo` already depends on `@playwright/test`): export, boot,
  assert zero page errors + login screen visible. Run in CI on PRs that
  touch `apps/expo`.
- Storage wrapper unit tests (jest-expo) for both platforms.
- Manual matrix for install UX: Android Chrome, iOS Safari, desktop
  Chrome.

## 7. Non-goals

- No NativeWind, no styling changes — web rendering uses the existing
  StyleSheet + useTheme system via react-native-web.
- No changes to native distribution (EAS builds continue unchanged).
- APK sideloading distribution is complementary and unaffected.
