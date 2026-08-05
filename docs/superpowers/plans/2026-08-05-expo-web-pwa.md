# Expo Web PWA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `apps/expo` as an installable PWA (static `expo export --platform web` bundle) so the app distributes without app stores — Phases 1–2 of the approved spec [docs/superpowers/specs/2026-08-05-expo-web-pwa-design.md](../specs/2026-08-05-expo-web-pwa-design.md).

**Architecture:** Fix the one known boot blocker (Metro's `crypto` → quick-crypto alias), add a SecureStore wrapper with a localStorage web fork, iterate a headless boot harness to green, then layer manifest + hand-rolled service worker + install UX on top. Everything web-specific uses the codebase's existing `.web.ts(x)` platform-fork convention.

**Tech Stack:** Expo SDK 55 / Metro web export, react-native-web, `@playwright/test` (already a devDependency) for the boot harness, `crypto-browserify` (new dep), plain localStorage, hand-rolled service worker.

## Global Constraints

- **pnpm only** — never npm/yarn. All commands run from `apps/expo/` unless stated.
- **German UI copy primary** (English secondary). Never show "CRC"/Circles jargon.
- **Styling: `StyleSheet.create()` + `useTheme()`** from `@/context/ThemeContext`. NO NativeWind. Fonts via tokens in `constants/theme.ts`.
- **Do NOT run global `tsc`** — the repo has ~431 pre-existing errors (untyped Supabase client). Verify with jest + the smoke script only.
- **Web exports need `NODE_OPTIONS=--max-old-space-size=8192`** (repo norm, already in the `export` script).
- **Never touch `lib/encryption.ts`** (chainId 8453 is a derivation constant).
- **`dist/` is gitignored** — never commit export output.
- Commits: `feat(expo): …` / `chore(expo): …` convention; commit after each task (add specific files only, never `git add .`), push after committing.
- The primary color is `#00498B` (navy); dark background `#18191B`.

---

### Task 1: Web smoke harness

The permanent verification tool for every later task. It must FAIL today (quick-crypto boot crash) — that failure is the baseline.

**Files:**
- Create: `apps/expo/scripts/web-smoke.mjs`
- Modify: `apps/expo/package.json` (two scripts)

**Interfaces:**
- Produces: `pnpm export:web` (builds to `dist/`), `pnpm smoke:web` (boots `dist/` headless; exit 0 = zero page errors + non-empty body; writes screenshot to `.expo/web-smoke.png`). Every later task uses these two commands as its gate.

- [ ] **Step 1: Write the harness**

```js
// apps/expo/scripts/web-smoke.mjs
// Boots the static web export (dist/) in headless Chromium WITHOUT a local
// server: request interception serves files from disk, so it runs inside
// sandboxes that block port binding. Exit 0 = boot OK (no page errors, body
// rendered). Screenshot lands in .expo/web-smoke.png.
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const SHOT = path.join(ROOT, '.expo', 'web-smoke.png');
const MIME = {
  '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
  '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.woff': 'font/woff', '.woff2': 'font/woff2',
};

if (!fs.existsSync(path.join(DIST, 'index.html'))) {
  console.error('dist/index.html missing — run `pnpm export:web` first.');
  process.exit(2);
}

const errors = [];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + String(e).slice(0, 300)));

await page.route('**/*', async (route) => {
  const url = new URL(route.request().url());
  if (url.hostname !== 'app.local') {
    // Real external calls (Supabase, thirdweb, RPC) proceed normally.
    try { await route.continue(); } catch { /* page closed */ }
    return;
  }
  let p = decodeURIComponent(url.pathname);
  if (p === '/') p = '/index.html';
  const file = path.join(DIST, p);
  if (fs.existsSync(file) && fs.statSync(file).isFile()) {
    const ext = path.extname(file).toLowerCase();
    await route.fulfill({ status: 200, contentType: MIME[ext] || 'application/octet-stream', body: fs.readFileSync(file) });
  } else {
    // SPA fallback
    await route.fulfill({ status: 200, contentType: 'text/html', body: fs.readFileSync(path.join(DIST, 'index.html')) });
  }
});

await page.goto('http://app.local/', { waitUntil: 'load', timeout: 30_000 });
await page.waitForTimeout(20_000);
const text = (await page.evaluate(() => document.body.innerText || '')).trim();
fs.mkdirSync(path.dirname(SHOT), { recursive: true });
await page.screenshot({ path: SHOT });
await browser.close();

const unique = [...new Set(errors)];
console.log(`body text: ${text ? text.slice(0, 200).replace(/\n/g, ' | ') : '(EMPTY)'}`);
console.log(`page errors (${unique.length}):`);
console.log(unique.slice(0, 10).join('\n---\n'));
if (unique.length > 0 || !text) {
  console.error('\nSMOKE FAIL');
  process.exit(1);
}
console.log('\nSMOKE PASS');
```

- [ ] **Step 2: Add package scripts**

In `apps/expo/package.json` `"scripts"`, add:

```json
"export:web": "NODE_OPTIONS=--max-old-space-size=8192 expo export --platform web",
"smoke:web": "node scripts/web-smoke.mjs"
```

- [ ] **Step 3: Run the baseline (expect FAIL)**

Run: `pnpm export:web && pnpm smoke:web`
Expected: export succeeds; smoke exits 1 with `PAGEERROR: Error: Failed to install react-native-quick-crypto: The native QuickCrypto Module could not be found.` This confirms the harness detects the known crash.

- [ ] **Step 4: Commit**

```bash
git add scripts/web-smoke.mjs package.json
git commit -m "feat(expo): headless web boot smoke harness (export:web + smoke:web)"
git push
```

---

### Task 2: Fork the crypto alias for web

**Files:**
- Modify: `apps/expo/metro.config.js:54-81` (the `resolveRequest` function)
- Modify: `apps/expo/package.json` (new dependency)

**Interfaces:**
- Consumes: `pnpm export:web` / `pnpm smoke:web` from Task 1.
- Produces: on web, any import of `crypto` or `react-native-quick-crypto` resolves to `crypto-browserify`; native resolution unchanged.

- [ ] **Step 1: Add the dependency**

Run from `apps/expo/`: `pnpm add crypto-browserify@^3.12.1`

- [ ] **Step 2: Add the web fork at the TOP of `resolveRequest`**

In `metro.config.js`, insert as the first statement inside `config.resolver.resolveRequest = (context, moduleName, platform) => {`:

```js
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
```

(Leave the existing `webExclude` entry for `react-native-quick-crypto` in place — it is now unreachable for these names but harmless.)

- [ ] **Step 3: Verify the QuickCrypto error is gone**

Run: `pnpm export:web && pnpm smoke:web`
Expected: the `QuickCrypto` PAGEERROR no longer appears. Smoke may still fail on the NEXT blocker (likely a SecureStore call) — record whatever it prints; Tasks 3–4 consume that list. Native must be untouched: `git diff metro.config.js` shows only the added block.

- [ ] **Step 4: Commit**

```bash
git add metro.config.js package.json ../../pnpm-lock.yaml
git commit -m "fix(expo): resolve crypto to crypto-browserify on web — quick-crypto is native-only"
git push
```

---

### Task 3: SecureStore wrapper with localStorage web fork

**Files:**
- Create: `apps/expo/lib/storage/secureStorage.ts` (native pass-through)
- Create: `apps/expo/lib/storage/secureStorage.web.ts` (localStorage)
- Create: `apps/expo/lib/storage/__tests__/secureStorage.web.test.ts`
- Modify (import swap only): `apps/expo/lib/citizen-commitment.ts:16`, `apps/expo/lib/consent-storage.ts:10`, `apps/expo/lib/nostr/enroll.ts:14`, `apps/expo/lib/nostr/identity.ts:1`, `apps/expo/context/MaciContext.tsx:27`

Do NOT touch `lib/bookmarks.ts` (shadowed by `lib/bookmarks.web.ts`) or `lib/xmtp/client.ts` (unreachable on web behind the native-module probe).

**Interfaces:**
- Produces (both platform files export the identical surface, mirroring expo-secure-store so call-site diffs are import-line-only):

```ts
export type SecureStoreOptions = { keychainService?: string; requireAuthentication?: boolean; /* native file re-exports the real expo-secure-store type */ };
export function getItemAsync(key: string, options?: SecureStoreOptions): Promise<string | null>;
export function setItemAsync(key: string, value: string, options?: SecureStoreOptions): Promise<void>;
export function deleteItemAsync(key: string, options?: SecureStoreOptions): Promise<void>;
```

- [ ] **Step 1: Write the failing web test**

```ts
// apps/expo/lib/storage/__tests__/secureStorage.web.test.ts
import * as SecureStorage from '../secureStorage.web';

function installLocalStorageMock() {
  const store = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
  };
  return store;
}

describe('secureStorage.web', () => {
  let store: Map<string, string>;
  beforeEach(() => { store = installLocalStorageMock(); });

  it('round-trips a value', async () => {
    await SecureStorage.setItemAsync('maci-key', 'secret');
    expect(await SecureStorage.getItemAsync('maci-key')).toBe('secret');
  });

  it('returns null for missing keys', async () => {
    expect(await SecureStorage.getItemAsync('missing')).toBeNull();
  });

  it('namespaces by keychainService so services do not collide', async () => {
    await SecureStorage.setItemAsync('k', 'a', { keychainService: 'roebel-consent' });
    await SecureStorage.setItemAsync('k', 'b');
    expect(await SecureStorage.getItemAsync('k', { keychainService: 'roebel-consent' })).toBe('a');
    expect(await SecureStorage.getItemAsync('k')).toBe('b');
    expect(store.get('roebel.secure.roebel-consent.k')).toBe('a');
    expect(store.get('roebel.secure.default.k')).toBe('b');
  });

  it('deletes values', async () => {
    await SecureStorage.setItemAsync('k', 'v');
    await SecureStorage.deleteItemAsync('k');
    expect(await SecureStorage.getItemAsync('k')).toBeNull();
  });

  it('does not throw when localStorage is unavailable', async () => {
    delete (globalThis as any).localStorage;
    expect(await SecureStorage.getItemAsync('k')).toBeNull();
    await expect(SecureStorage.setItemAsync('k', 'v')).resolves.toBeUndefined();
    await expect(SecureStorage.deleteItemAsync('k')).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec jest lib/storage --watchAll=false`
Expected: FAIL — `Cannot find module '../secureStorage.web'`

- [ ] **Step 3: Implement both platform files**

```ts
// apps/expo/lib/storage/secureStorage.ts
/**
 * Platform-neutral SecureStore facade. Native (this file): pass-through to
 * expo-secure-store (Keychain / EncryptedSharedPreferences). Web
 * (secureStorage.web.ts): namespaced localStorage — acceptable because every
 * secret stored through this wrapper is wallet-derived and re-derivable; see
 * the threat-model note in docs/superpowers/specs/2026-08-05-expo-web-pwa-design.md.
 */
import * as SecureStore from 'expo-secure-store';

export type SecureStoreOptions = SecureStore.SecureStoreOptions;

export function getItemAsync(key: string, options?: SecureStoreOptions): Promise<string | null> {
  return SecureStore.getItemAsync(key, options);
}

export function setItemAsync(key: string, value: string, options?: SecureStoreOptions): Promise<void> {
  return SecureStore.setItemAsync(key, value, options);
}

export function deleteItemAsync(key: string, options?: SecureStoreOptions): Promise<void> {
  return SecureStore.deleteItemAsync(key, options);
}
```

```ts
// apps/expo/lib/storage/secureStorage.web.ts
/**
 * Web fork: namespaced localStorage. expo-secure-store's web build is an
 * empty module, so every call would throw. Secrets stored here are
 * wallet-derived and re-derivable (spec threat-model note). requireAuthentication
 * has no web equivalent and is ignored.
 */
export type SecureStoreOptions = {
  keychainService?: string;
  requireAuthentication?: boolean;
};

const PREFIX = 'roebel.secure.';

function storageKey(key: string, options?: SecureStoreOptions): string {
  return `${PREFIX}${options?.keychainService ?? 'default'}.${key}`;
}

export async function getItemAsync(key: string, options?: SecureStoreOptions): Promise<string | null> {
  try {
    return globalThis.localStorage?.getItem(storageKey(key, options)) ?? null;
  } catch {
    return null;
  }
}

export async function setItemAsync(key: string, value: string, options?: SecureStoreOptions): Promise<void> {
  try {
    globalThis.localStorage?.setItem(storageKey(key, options), value);
  } catch {
    // Quota exceeded / private mode: fail soft like a missing keychain.
  }
}

export async function deleteItemAsync(key: string, options?: SecureStoreOptions): Promise<void> {
  try {
    globalThis.localStorage?.removeItem(storageKey(key, options));
  } catch {
    // ignore
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec jest lib/storage --watchAll=false`
Expected: PASS (5 tests)

- [ ] **Step 5: Rewire the five call sites (import line ONLY)**

In each file, replace the expo-secure-store import with the wrapper — preserve each file's existing quote style and nothing else changes:

- `lib/citizen-commitment.ts:16`: `import * as SecureStore from '@/lib/storage/secureStorage';`
- `lib/consent-storage.ts:10`: `import * as SecureStore from '@/lib/storage/secureStorage';` (its `SecureStore.SecureStoreOptions` type usage keeps compiling — the wrapper exports that name)
- `lib/nostr/enroll.ts:14`: `import * as SecureStore from '@/lib/storage/secureStorage';`
- `lib/nostr/identity.ts:1`: `import * as SecureStore from '@/lib/storage/secureStorage';`
- `context/MaciContext.tsx:27`: `import * as SecureStore from "@/lib/storage/secureStorage";` (double quotes — this file uses them)

- [ ] **Step 6: Verify no remaining reachable imports and smoke moves forward**

Run: `grep -rn "from ['\"]expo-secure-store" lib context hooks app components | grep -v "storage/secureStorage" | grep -v bookmarks.ts | grep -v xmtp/client.ts`
Expected: no output.
Run: `pnpm export:web && pnpm smoke:web`
Expected: no SecureStore-related page errors (smoke may still fail on other boot-path modules — Task 4's input).

- [ ] **Step 7: Commit**

```bash
git add lib/storage lib/citizen-commitment.ts lib/consent-storage.ts lib/nostr/enroll.ts lib/nostr/identity.ts context/MaciContext.tsx
git commit -m "feat(expo): SecureStore facade with localStorage web fork — web-reachable call sites rewired"
git push
```

---

### Task 4: Boot-path audit loop — smoke to green

Exploratory by design: fix whatever the harness surfaces next, one guard per iteration, until `SMOKE PASS`.

**Files:**
- Modify: whatever the harness implicates. Expected suspects and the ONLY three fix patterns to use (matching existing conventions):

**Interfaces:**
- Consumes: `pnpm export:web` / `pnpm smoke:web`.
- Produces: `pnpm smoke:web` exits 0 — the acceptance gate every later task re-runs.

**Fix patterns (pick the least invasive that applies):**

1. **Runtime guard** — for a call inside shared code:
```ts
import { Platform } from 'react-native';
if (Platform.OS !== 'web') {
  // native-only call
}
```
2. **`.web` fork** — for a module whose whole purpose is native (follow `hooks/useNotifications.web.ts` as the model: same exported signature, inert implementation returning safe defaults).
3. **Metro web-exclude** — for a package that must not be bundled at all on web: add its name to the existing `webExclude` array in `metro.config.js:62-74`.

- [ ] **Step 1: Run the loop**

Repeat until PASS, committing after each distinct fix:

```bash
pnpm export:web && pnpm smoke:web
# read the first page error → apply ONE of the three patterns above → re-run
```

Likely suspects, in probable boot order: `expo-updates` checks (guard on web), `expo-notifications` device registration outside the already-forked hooks (guard), `expo-splash-screen` calls (guard — its web behavior is a safe no-op, only touch if the harness names it), Sentry native init in `lib/sentry-init.ts` (guard native-only pieces), `posthog-react-native` autocapture (guard init on web if it errors).

- [ ] **Step 2: Verify final state**

Run: `pnpm export:web && pnpm smoke:web`
Expected: `SMOKE PASS`. Open `.expo/web-smoke.png` — it must show the app's first screen (login or feed), not a blank page.

- [ ] **Step 3: Sanity-check native untouched**

Run: `git diff main --stat -- app components lib hooks context | tail -5`
Every modified shared file must contain only additive `Platform.OS` guards or new `.web` forks — no changed native logic paths.

- [ ] **Step 4: Final commit of the loop (if any uncommitted fix remains)**

```bash
git add <specific files fixed in the last iteration>
git commit -m "fix(expo): guard remaining native-only boot calls on web — smoke green"
git push
```

---

### Task 5: PWA manifest, icons, and HTML head

**Files:**
- Create: `apps/expo/public/manifest.json`
- Create: `apps/expo/public/icons/icon-192.png`, `icon-512.png`, `maskable-192.png`, `maskable-512.png`, `apple-touch-icon.png`
- Modify: `apps/expo/app/+html.tsx`

**Interfaces:**
- Consumes: nothing new; `assets/images/icon.png` + `assets/images/adaptive-icon.png` (both 1024×1024) are the masters.
- Produces: `dist/manifest.json` + `dist/icons/*` in every export (Expo copies `public/` into the web output); head tags Task 6's service worker and install UX rely on.

- [ ] **Step 1: Generate icons (one-time, committed; macOS sips — no new deps)**

```bash
mkdir -p public/icons
sips -z 192 192 assets/images/icon.png --out public/icons/icon-192.png
sips -z 512 512 assets/images/icon.png --out public/icons/icon-512.png
sips -z 180 180 assets/images/icon.png --out public/icons/apple-touch-icon.png
# Maskable: content must sit in the inner ~80% safe zone on a full-bleed
# navy background. Shrink the adaptive foreground, then pad with #00498B:
sips -z 410 410 assets/images/adaptive-icon.png --out /tmp/roebel-mask-fg.png
sips -p 512 512 --padColor 00498B /tmp/roebel-mask-fg.png --out public/icons/maskable-512.png
sips -z 154 154 assets/images/adaptive-icon.png --out /tmp/roebel-mask-fg-192.png
sips -p 192 192 --padColor 00498B /tmp/roebel-mask-fg-192.png --out public/icons/maskable-192.png
```

Then LOOK at the two maskable files (Read tool renders PNGs): the windmill must be centered on solid navy with clear margin. If `icon.png` turns out to have a transparent background, rebuild `icon-*.png` with the same pad technique.

- [ ] **Step 2: Write the manifest**

```json
{
  "name": "Röbel",
  "short_name": "Röbel",
  "description": "Die App für Röbel/Müritz — Nachrichten, Veranstaltungen, Mitbestimmung.",
  "id": "/",
  "start_url": "/",
  "scope": "/",
  "display": "standalone",
  "orientation": "portrait",
  "lang": "de",
  "background_color": "#00498B",
  "theme_color": "#00498B",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any" },
    { "src": "/icons/maskable-192.png", "sizes": "192x192", "type": "image/png", "purpose": "maskable" },
    { "src": "/icons/maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

- [ ] **Step 3: Update `+html.tsx`**

Change `<html lang="en">` to `<html lang="de">`. In the existing `<meta name="viewport">` append `, viewport-fit=cover` to its content. After the `<style>` line add:

```tsx
        <meta name="theme-color" content="#00498B" />
        <link rel="manifest" href="/manifest.json" />
        <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content="Röbel" />
```

Also update the `responsiveBackground` dark-mode color from `#000` to `#18191B` (the app's dark background token) so the pre-hydration flash matches the app.

- [ ] **Step 4: Verify export carries the assets and smoke stays green**

Run: `pnpm export:web && ls dist/manifest.json dist/icons/ && pnpm smoke:web`
Expected: manifest + 5 icons present in `dist/`; `SMOKE PASS`. If `public/` was NOT copied (older export behavior), change the `export:web` script to `"NODE_OPTIONS=--max-old-space-size=8192 expo export --platform web && cp -R public/ dist/"` and re-verify.

- [ ] **Step 5: Commit**

```bash
git add public app/+html.tsx package.json
git commit -m "feat(expo): PWA manifest, icons, and web HTML head (lang=de, theme #00498B)"
git push
```

---

### Task 6: Service worker + offline fallback + registration

**Files:**
- Create: `apps/expo/public/sw.js`
- Create: `apps/expo/public/offline.html`
- Modify: `apps/expo/index.js` (registration block)

**Interfaces:**
- Consumes: `public/` copying verified in Task 5.
- Produces: `/sw.js` served from the export root; cache name `roebel-v1`; registration only on web production builds.

- [ ] **Step 1: Write the service worker**

```js
// apps/expo/public/sw.js
// Hand-rolled per the spec: the export's /_expo/static/* chunks are
// content-hashed (immutable) → cache-first; the HTML shell is
// network-first with cached fallback. Bump VERSION to invalidate.
const VERSION = 'v1';
const CACHE = `roebel-${VERSION}`;
const PRECACHE = ['/', '/offline.html', '/manifest.json'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;

  // Immutable, content-hashed build artifacts: cache-first.
  if (url.pathname.startsWith('/_expo/static/') || url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
            return res;
          })
      )
    );
    return;
  }

  // App navigations: network-first → cached shell → offline page.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('/', copy));
          return res;
        })
        .catch(async () => (await caches.match('/')) || (await caches.match('/offline.html')))
    );
  }
});
```

- [ ] **Step 2: Write the offline page**

```html
<!-- apps/expo/public/offline.html -->
<!doctype html>
<html lang="de">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Röbel — offline</title>
    <style>
      body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
             background: #00498B; color: #fff; font-family: -apple-system, 'Segoe UI', Roboto, sans-serif; text-align: center; }
      main { padding: 24px; }
      h1 { font-size: 22px; margin: 0 0 8px; }
      p { margin: 0; opacity: 0.85; font-size: 15px; }
    </style>
  </head>
  <body>
    <main>
      <h1>Keine Verbindung</h1>
      <p>Die Röbel App braucht Internet. Bitte prüfe deine Verbindung und versuche es erneut.</p>
    </main>
  </body>
</html>
```

- [ ] **Step 3: Register the worker in `index.js`**

Directly after the existing `import { Platform } from "react-native";` block at the top, add:

```js
// PWA: register the service worker (web production only — dev would cache
// Metro's ever-changing bundles).
if (Platform.OS === "web" && !__DEV__ && typeof navigator !== "undefined" && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((e) => {
      console.warn("Service worker registration failed:", e?.message ?? e);
    });
  });
}
```

- [ ] **Step 4: Verify**

Run: `pnpm export:web && ls dist/sw.js dist/offline.html && pnpm smoke:web`
Expected: both files in `dist/`; `SMOKE PASS` (registration failure inside the harness's intercepted origin is caught by the `.catch` and must not fail smoke).

- [ ] **Step 5: Commit**

```bash
git add public/sw.js public/offline.html index.js
git commit -m "feat(expo): hand-rolled service worker, offline page, prod-only registration"
git push
```

---

### Task 7: Install UX (Android prompt + iOS instructions)

**Files:**
- Create: `apps/expo/hooks/useInstallPrompt.ts` (native no-op)
- Create: `apps/expo/hooks/useInstallPrompt.web.ts`
- Create: `apps/expo/components/InstallAppCard.tsx`
- Modify: `apps/expo/app/settings.tsx` (mount the card as the first child inside the `<ScrollView>` at line 118)

**Interfaces:**
- Produces:

```ts
export type InstallPromptState = {
  canPrompt: boolean;      // beforeinstallprompt captured (Android/desktop Chrome)
  isStandalone: boolean;   // already running as installed PWA
  isIosSafari: boolean;    // needs manual "Zum Home-Bildschirm" instructions
  promptInstall: () => Promise<void>;
};
export function useInstallPrompt(): InstallPromptState;
```

`InstallAppCard` renders `null` unless exactly one of `canPrompt`/`isIosSafari` is true and `isStandalone` is false — so it is invisible on native (the no-op hook returns all-false) and after install.

- [ ] **Step 1: Native no-op hook**

```ts
// apps/expo/hooks/useInstallPrompt.ts
// Native platforms: installation happens through app stores / APKs — the
// install card never renders. Web implementation: useInstallPrompt.web.ts.
export type InstallPromptState = {
  canPrompt: boolean;
  isStandalone: boolean;
  isIosSafari: boolean;
  promptInstall: () => Promise<void>;
};

export function useInstallPrompt(): InstallPromptState {
  return { canPrompt: false, isStandalone: false, isIosSafari: false, promptInstall: async () => {} };
}
```

- [ ] **Step 2: Web hook**

```ts
// apps/expo/hooks/useInstallPrompt.web.ts
import { useCallback, useEffect, useRef, useState } from 'react';

// Duplicated from useInstallPrompt.ts on purpose: a relative import of
// './useInstallPrompt' would platform-resolve back to THIS file.
export type InstallPromptState = {
  canPrompt: boolean;
  isStandalone: boolean;
  isIosSafari: boolean;
  promptInstall: () => Promise<void>;
};

export function useInstallPrompt(): InstallPromptState {
  const deferred = useRef<any>(null);
  const [canPrompt, setCanPrompt] = useState(false);

  const isStandalone =
    typeof window !== 'undefined' &&
    (window.matchMedia?.('(display-mode: standalone)').matches || (navigator as any).standalone === true);

  const isIosSafari =
    typeof navigator !== 'undefined' && /iPhone|iPad|iPod/.test(navigator.userAgent);

  useEffect(() => {
    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      deferred.current = e;
      setCanPrompt(true);
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    return () => window.removeEventListener('beforeinstallprompt', onBeforeInstall);
  }, []);

  const promptInstall = useCallback(async () => {
    if (!deferred.current) return;
    deferred.current.prompt();
    await deferred.current.userChoice;
    deferred.current = null;
    setCanPrompt(false);
  }, []);

  return { canPrompt, isStandalone, isIosSafari, promptInstall };
}
```

- [ ] **Step 3: The card component**

```tsx
// apps/expo/components/InstallAppCard.tsx
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useTheme } from '@/context/ThemeContext';
import { useInstallPrompt } from '@/hooks/useInstallPrompt';

export default function InstallAppCard() {
  const { colors } = useTheme();
  const { canPrompt, isStandalone, isIosSafari, promptInstall } = useInstallPrompt();

  if (isStandalone || (!canPrompt && !isIosSafari)) return null;

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Text style={[styles.title, { color: colors.text }]}>App installieren</Text>
      {canPrompt ? (
        <>
          <Text style={[styles.body, { color: colors.textSecondary }]}>
            Installiere die Röbel App auf deinem Startbildschirm — ohne App Store.
          </Text>
          <Pressable
            onPress={promptInstall}
            style={[styles.button, { backgroundColor: colors.primary }]}
            accessibilityRole="button"
          >
            <Text style={styles.buttonLabel}>Jetzt installieren</Text>
          </Pressable>
        </>
      ) : (
        <Text style={[styles.body, { color: colors.textSecondary }]}>
          Tippe in Safari auf das Teilen-Symbol und wähle „Zum Home-Bildschirm", um die Röbel App zu installieren.
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 12, padding: 16, marginHorizontal: 16, marginBottom: 16 },
  title: { fontFamily: 'MonaSans-SemiBold', fontSize: 16, marginBottom: 4 },
  body: { fontFamily: 'MonaSans-Regular', fontSize: 14, lineHeight: 20 },
  button: { marginTop: 12, borderRadius: 8, paddingVertical: 10, alignItems: 'center' },
  buttonLabel: { fontFamily: 'MonaSans-SemiBold', fontSize: 14, color: '#fff' },
});
```

Before writing, check `constants/theme.ts` for the exact token names (`card`, `border`, `textSecondary`, `primary`) and use whatever names actually exist there — adjust the four `colors.*` references accordingly.

- [ ] **Step 4: Mount in settings**

In `app/settings.tsx`, add `import InstallAppCard from '@/components/InstallAppCard';` with the other component imports, and render `<InstallAppCard />` as the first child inside the `<ScrollView style={styles.flex1} …>` (line 118).

- [ ] **Step 5: Verify**

Run: `pnpm exec jest lib/storage --watchAll=false && pnpm export:web && pnpm smoke:web`
Expected: jest PASS, `SMOKE PASS`. Native must not render the card (hook returns all-false — confirm by reading the conditional, no build needed).

- [ ] **Step 6: Commit**

```bash
git add hooks/useInstallPrompt.ts hooks/useInstallPrompt.web.ts components/InstallAppCard.tsx app/settings.tsx
git commit -m "feat(expo): PWA install card — beforeinstallprompt on Android, iOS Safari instructions"
git push
```

---

### Task 8: Deploy configuration + operations doc

**Files:**
- Create: `apps/expo/public/vercel.json` (rides into `dist/` with every export — deploy runs FROM `dist/`)
- Create: `docs/EXPO_WEB_PWA.md`
- Modify: `apps/expo/package.json` (deploy script)

**Interfaces:**
- Consumes: everything prior; `dist/` is a complete deployable after `pnpm export:web`.
- Produces: `pnpm deploy:web` (exports then deploys `dist/` via Vercel CLI, mirroring the circles-inviter standalone-deploy pattern — NOT git-connected).

- [ ] **Step 1: Write `public/vercel.json`**

```json
{
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }],
  "headers": [
    {
      "source": "/_expo/static/(.*)",
      "headers": [{ "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }]
    },
    {
      "source": "/sw.js",
      "headers": [{ "key": "Cache-Control", "value": "no-cache" }]
    }
  ]
}
```

(Vercel serves real files first; the rewrite only catches app routes → SPA fallback. `sw.js` must never be long-cached or updates stall.)

- [ ] **Step 2: Add the deploy script**

In `apps/expo/package.json` `"scripts"`:

```json
"deploy:web": "pnpm export:web && cd dist && npx vercel --prod"
```

- [ ] **Step 3: Write `docs/EXPO_WEB_PWA.md`**

Content (write it out fully, this outline is the required section list):
- **What this is:** the Expo app's third target — static PWA at `app.roebel.app`; spec + plan links.
- **Commands:** `pnpm export:web`, `pnpm smoke:web`, `pnpm deploy:web` — what each does and expected output.
- **First deploy (USER steps):** `npx vercel login`, run `pnpm deploy:web` once to create the project, add `app.roebel.app` as the project domain, set the DNS CNAME at the registrar. Note EXPO_PUBLIC_* / extra env values are baked at export time from `apps/expo/.env`.
- **Updating:** re-run `pnpm deploy:web`; bump `VERSION` in `public/sw.js` when shell-level assets change semantics.
- **Web degrade matrix:** copy the table from the spec §5 verbatim.
- **Storage caveat:** localStorage threat-model note, link to spec §3.
- **Manual install test checklist:** Android Chrome (prompt appears in Einstellungen → card → install → standalone opens), iOS Safari 16.4+ (share sheet → Zum Home-Bildschirm), desktop Chrome (omnibox install icon). Offline check: install, airplane mode, reopen → app shell or offline page renders. Lighthouse: `npx lighthouse https://app.roebel.app --only-categories=pwa --view` after first deploy — installability must pass (spec Phase 2 acceptance).
- **Deferred:** web push (spec Phase 3), XMTP browser rail, mapbox-gl map, CI workflow for smoke (gh token lacks workflow scope — add `.github/workflows/web-smoke.yml` manually when wanted).

- [ ] **Step 4: Verify the deploy artifact locally**

Run: `pnpm export:web && ls dist/vercel.json && pnpm smoke:web`
Expected: `vercel.json` present in `dist/`; `SMOKE PASS`.

- [ ] **Step 5: Commit**

```bash
git add public/vercel.json package.json ../../docs/EXPO_WEB_PWA.md
git commit -m "feat(expo): web deploy config (Vercel SPA + cache headers) and PWA ops doc"
git push
```

---

## Verification (whole plan)

1. `pnpm exec jest lib/storage --watchAll=false` → PASS.
2. `pnpm export:web && pnpm smoke:web` → `SMOKE PASS`, screenshot shows the real first screen.
3. `grep -rn "from ['\"]expo-secure-store" lib context hooks app components | grep -v storage/secureStorage | grep -v bookmarks.ts | grep -v xmtp/client.ts` → empty.
4. Native regression gate: `git diff main --stat` touches no native-only logic paths (only additive guards, new `.web` files, config, docs).
5. USER-gated (cannot be done by the agent): Vercel login + project + `app.roebel.app` DNS; on-device install checks per the doc's checklist.
