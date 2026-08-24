# Expo Native-Feel Phase 0 — Quick Wins

**Spec:** The "Röbel Native Playbook" audit (2026-08-22). Phase 0 = restore native navigation feel, cut cold-start waste, stop app-wide re-renders, add tactile feedback to core actions. JS/config-only; no native rebuilds required beyond what EAS already does.

## Global Constraints

- Work directly on `main`. **Pathspec-only commits** (`git add <file1> <file2>`, never `git add .`/`-A`). Commit per task, conventional messages (`perf(expo): …`, `fix(expo): …`, `feat(expo): …`).
- Code identifiers and comments in English. UI text stays German. No UI copy changes expected.
- Styling stays `StyleSheet.create()` + `useTheme()`. NO NativeWind. No new styling systems.
- The repo has ~431 pre-existing TypeScript errors. Do NOT use full `tsc --noEmit` as a pass/fail gate. Verify with `npx eslint <changed files>` (from `apps/expo/`) plus the task-specific checks named below.
- Never run `eas update` or any deploy. Done = code + commit.
- Do NOT remove the `Inter-*` / `GeistMono-*` font alias entries in `hooks/useFonts.ts` — they are load-bearing for legacy hardcoded `fontFamily` strings (see `apps/expo/CLAUDE.md`).
- No changes that require `expo prebuild` (bare `ios/`/`android/` dirs are checked in). JS, TS, and `app.config.ts` bundler-level config only.
- Only new dependency allowed in this plan: `babel-plugin-react-compiler` (Task 2). Use `pnpm` from `apps/expo/`.
- Preserve existing behavior semantics: deep links must land where they land today; OTA updates must still be checked and applied (may be deferred off the critical path, never removed).
- All file paths below are relative to `apps/expo/`.

## Task 1: Restore native screen transitions (keep pseudo-tab switches as cuts)

**Problem:** `app/_layout.tsx:244` sets `screenOptions={{ headerShown: false, animation: 'none' }}` on the root `TransitionStack` — every push/pop in the app is a hard cut and iOS edge-swipe-back is disabled. Five wizard layouts repeat it: `app/create-deal/_layout.tsx:51`, `app/welcome/_layout.tsx:33`, `app/create-listing/_layout.tsx:51`, `app/create-org/_layout.tsx:51`, `app/roebel-card/partner-register/_layout.tsx:60`.

**Why the global 'none' probably exists:** the app has no tab navigator — 12 top-level screens act as tabs via `router.push/replace` (`app/index.tsx`, `app/explore.tsx`, `app/profile.tsx`, `app/events.tsx`, `app/calendar.tsx`, `app/governance.tsx`, `app/tours/index.tsx`, `app/transit/index.tsx`, `app/blog/index.tsx`, `app/wildlife/index.tsx`, `app/news/index.tsx`, plus feed home at `/`). A global slide animation would make tab switches slide sideways, which looks broken. The fix must keep tab-level switches as instant cuts while giving everything else the native default.

**Changes:**
1. In `app/_layout.tsx`: change root `screenOptions` to `{ headerShown: false }` (default animation restored, gestures enabled).
2. In the same layout, add per-screen `animation: 'none'` for exactly the pseudo-tab route names listed above (the routes reachable from `components/BottomNavigation.tsx` — read that file to confirm the exact route list; `index` and `explore` are among them). Use the existing per-screen pattern already used for the 4 game screens at `app/_layout.tsx:249-252`.
3. Remove `animation: 'none'` from the 5 wizard layouts so wizard steps slide natively.
4. Do not touch the 4 game screens using `noTransition()`.

**Verify:** eslint on changed files; grep confirms no remaining `animation: 'none'` outside the root layout's pseudo-tab screen entries.

## Task 2: Enable React Compiler; drop dead blur dependency

1. In `app.config.ts` (`experiments` at :37-39): add `reactCompiler: true` alongside `typedRoutes`.
2. `pnpm add -D babel-plugin-react-compiler` in `apps/expo/` (required by babel-preset-expo when the experiment is on).
3. Remove `@react-native-community/blur` from `package.json` dependencies (zero imports repo-wide) and run `pnpm install` to update the lockfile.
4. Also delete the stale duplicated experiment/asyncRoutes keys from `app.json` ONLY if `app.json` is not referenced anywhere (check `app.config.ts` — if it spreads/imports app.json, leave app.json alone and note it).

**Verify:** From `apps/expo/`: `NODE_OPTIONS=--max-old-space-size=8192 npx expo export --platform ios` completes successfully (proves the compiler-enabled babel pipeline bundles the whole app). This can take several minutes — allow a long timeout. If export fails on compiler errors in specific files, do NOT patch app code; report BLOCKED with the error.

## Task 3: Memoize top-of-tree context provider values

**Problem:** Providers near the top of the 27-provider stack pass fresh object identities every render, re-rendering the whole app below them on every theme change, DM, or notification poll.

Fix (wrap the provider `value` in `useMemo`, and wrap functions included in the value in `useCallback` where they are currently re-created per render):
- `context/ThemeContext.tsx:43` — value `{ preference, effectiveTheme, colors, isDark, setPreference }`; 549 consumer files.
- `context/MessagingContext.tsx:393-401` — inline value driven by XMTP subscription + Supabase realtime.
- `context/NotificationsContext.tsx:44-56` — inline `{ ...notifications, inbox, userNotifs, ... }`.
- `context/SnackbarContext.tsx:35` — `{ showSnackbar, hideSnackbar }`.
- `context/AuthGateContext.tsx:50`
- `context/DeveloperModeContext.tsx:44`
- `context/GovernanceTestContext.tsx:43`
- `context/ExtendedModeContext.tsx:42`
- `context/CreatePostContext.tsx` (no useMemo present — find the value)

Rules: dependency arrays must be exact (no `[]` cheating — a stale `colors` would freeze theming). Do not restructure contexts, split them, or change their public API. Do not touch contexts that already memoize (Rewards, Account, Location, RoebelTaler).

**Verify:** eslint on changed files (exhaustive-deps must be clean for the new hooks).

## Task 4: Startup diet

1. **Splash:** `components/AnimatedSplash.tsx:36-66` currently forces ~1620ms (650 + 520 delay + 450). Reduce to ≤600ms total (e.g. 350ms logo fade, no dwell delay, 250ms fade-out). Keep the component and its API; only timings change.
2. **Boot route:** `app/_layout.tsx:164-177` (`InitialRouteRedirect`) lets the router mount `/` (the 792-LOC feed) then `router.replace('/explore')`. Read the current implementation carefully (it may guard deep links). Replace the mount-then-replace with a redirect that avoids ever mounting FeedHome at cold start — e.g. a module-level `hasRedirected` flag in `app/index.tsx` returning `<Redirect href="/explore" />` on the first cold-start render only, OR an equivalent that preserves these semantics exactly: (a) cold start with no deep link → lands on `/explore`; (b) cold start via deep link to any route including `/` → honors the deep link exactly as today; (c) in-session navigation to `/` (feed tab) → renders the feed normally.
3. **Update check:** `app/_layout.tsx:61` runs `Updates.checkForUpdateAsync()` at module scope (network on the JS critical path, and `Updates.reloadAsync()` can restart mid-boot). Move the check so it runs after the first screen has mounted and interactions settled (e.g. inside a `useEffect` + `InteractionManager.runAfterInteractions` or a short timeout). Behavior must remain: update found → fetched → applied (reload) — just no longer racing cold start. Keep any existing error handling.

**Verify:** eslint; state in the report the new total forced splash time and the boot path for cases (a)/(b)/(c).

## Task 5: Feed list performance

`components/feed/FeedList.tsx` + `components/feed/FeedPostCard.tsx`:
1. Remove `visibleVideoIds` from the `renderItem` useCallback deps (`FeedList.tsx:408`). Instead pass a primitive `isVisible: boolean` per item into the cell and add `extraData={visibleVideoIds}` on the FlatList so visibility changes re-render the list shell while memoized cells bail out.
2. Wrap `FeedPostCard` in `React.memo`.
3. Make the per-cell callbacks stable so memo works: hoist `onLike`/`onShare`/`onMore`/`onRepost` etc. to stable callbacks that take the post (id) as argument, or curry via a memoized map — no fresh closures per render pass (`FeedList.tsx:258-278`).
4. Hoist `ItemSeparatorComponent` (`:472-474`), `ListFooterComponent`, `ListEmptyComponent` (`:491-510`) to module-level or memoized components — never inline anonymous components.
5. Add conservative windowing props to this FlatList: `windowSize={7}`, `maxToRenderPerBatch={5}`, `removeClippedSubviews` (Android-safe default: leave true on Android only if nothing breaks measurement; if in doubt, omit removeClippedSubviews and say so).
6. Do not change visual output, ordering, or the viewability logic itself.

**Verify:** eslint on changed files. In the report, explain why `FeedPostCard` now only re-renders when its own `isVisible` or data changes.

## Task 6: Hoist per-render StyleSheet/config creation in text renderers

1. `components/MarkdownRenderer.tsx:13` — `StyleSheet.create()` with ~150 keys runs inside the component body (used per chat bubble in Mecky's inverted FlatList). Hoist: build the style object in a module-level factory keyed by theme, memoized with `useMemo` on the theme colors object (pattern: `const styles = useMemo(() => createMarkdownStyles(colors), [colors])`).
2. `components/ai/MinimalAIChat.tsx:255` — same bug (`markdownStyles` created per bubble per streaming token). Same fix.
3. `components/RichTextRenderer.tsx:15,25` — `systemFonts` array and `tagsStyles` object created inline and passed to `RenderHTML` (documented re-parse footgun). Hoist `systemFonts` to module scope; `useMemo` the `tagsStyles` on its theme inputs. Also check `components/ai/ChatMessage.tsx:64` for the same in-render `StyleSheet.create` and fix if present.

No visual changes. **Verify:** eslint on changed files.

## Task 7: Haptics and press feedback on core actions

`expo-haptics` is installed. All additions follow the pattern already used in `app/rewards/index.tsx`. Wrap haptic calls so failures are silent (haptics can throw on some devices/emulators).

1. `components/VoteButtons.tsx` (Pressables at :648, :696, :770, :797, :838, :854, :870): `Haptics.impactAsync(ImpactFeedbackStyle.Medium)` when a vote choice is pressed; `Haptics.notificationAsync(NotificationFeedbackType.Success)` when a vote is successfully cast (find the success path in the submit handler). Add `({ pressed })` visual feedback (opacity 0.7 or scale) to these Pressables.
2. `components/BottomNavigation.tsx`: `Haptics.selectionAsync()` on tab press; add `({ pressed })` opacity feedback; replace the fixed `height: 72` + `paddingBottom: 8` (:91-93) with `useSafeAreaInsets()` bottom inset (`paddingBottom: Math.max(insets.bottom, 8)`) so labels clear the home indicator (`react-native-safe-area-context` is installed).
3. `components/QRScanner.tsx:217`: `Haptics.notificationAsync(Success)` when a barcode is successfully scanned (once per scan, not per frame — guard with the existing scanned-state if present).
4. Feed like + repost handlers (in `components/feed/FeedList.tsx` / `FeedPostCard.tsx` or the hooks they call — locate `toggleLike`/repost): `Haptics.impactAsync(Light)` on tap.
5. Chat send (Mecky `app/messages/mecky.tsx` composer and DM composer `app/messages/[conversationId].tsx`): `Haptics.impactAsync(Light)` on send.

Keep German UI text untouched. **Verify:** eslint on changed files.

## Task 8: Erkunden scroll performance

`app/explore.tsx`:
1. Replace the JS-thread `handleScroll` (`:199-207`, `NativeSyntheticEvent` + `setFabVisible` at `scrollEventThrottle={16}`) with Reanimated: `useAnimatedScrollHandler` writing scroll direction into a shared value, FAB visibility driven by `useAnimatedStyle` (translate/opacity) — zero `setState` during scroll. The ScrollView must become `Animated.ScrollView` from `react-native-reanimated`.
2. Wrap the three unmemoized `.filter()` computations (`:210-214` — `futurePopularEvents`, `futureEvents`, `nearbyEvents`) in `useMemo` with exact deps.
3. `components/SearchModal.tsx` is mounted unconditionally at `:309` — mount it only when open (`{searchOpen && <SearchModal …/>}`) IF its internal state/animation allows (read the component first; if it needs to stay mounted for its open animation, leave it and note why).

No visual behavior change: the FAB must appear/disappear on the same scroll gestures as today. **Verify:** eslint on changed files.
