# K2 — Nostr read fallback in the app

**Date:** 2026-08-11 · **Status:** kickoff, not yet designed · **Owner:** unassigned agent

## 1. Mission

Make the app able to **read** its content from the sovereign Nostr record, so a
fork can run without our Supabase project and so Röbel survives a Supabase
outage in read-only mode. Today the record is a one-way mirror: the app signs
and pushes, and reads nothing back.

This is the cheapest of the three tracks to prove sovereignty end-to-end,
because it does not wait on the account layer ([K1](2026-08-11_K1_NETIZEN_ACCOUNTS_REPLACES_THIRDWEB.md)).

## 2. Verified current state (2026-08-11)

**The read library already exists and is already in production — just not in the app.**

- [`packages/record-client`](../../packages/record-client) exports a full read API: `RecordClient`, `RecordUnavailableError`, and dataset helpers `listEvents`, `getEventById`, `listMovies`, `listNews`, `getNewsBySlug`, `listArticles`, `listOrgs`, `getOrgBySlug`, `listPosts`, `getThread`, `listListings`, `listDeals`, `getMenu`, `getMenuBySlug`, `listProposals`, `listNotices`.
- **`apps/web` consumes it today** — `src/app/page.tsx`, `app/news`, `app/blog`, `app/orgs/[slug]`, and others.
- **`apps/expo` does not depend on it at all** (`grep -c record-client apps/expo/package.json` → `0`). The PWA therefore goes dark if Supabase does.
- Write path: [`apps/expo/lib/nostr/publish.ts`](../../apps/expo/lib/nostr/publish.ts) — its header states the current contract plainly: *"Supabase remains the app's source of truth for this slice; the relay is a parallel, signed, portable copy."* Relay: `wss://relay.roebel.app`.
- The only read-ish reference in the app is an outbound link to `https://index.roebel.app` in [`components/feed/PostOptionsDrawer.tsx:9`](../../apps/expo/components/feed/PostOptionsDrawer.tsx#L9).
- Nostr is fully web-compatible: `@netizen-labs/nostr` has no native deps (`@noble/curves`, `@noble/hashes`, `@scure/base`) and uses the global `WebSocket`; identity persists through the SecureStore facade, which on web is localStorage.

So this task is **wiring and coverage**, not building a read stack from scratch.

## 3. Scope

**In scope**
1. Add `@netizen-labs/record-client` to `apps/expo` and introduce a data-source seam so read paths can resolve from Supabase (primary) or the record (fallback).
2. A coverage audit: for each screen the app renders, does the record actually carry the data? Project memory flags gaps in `news_articles`, menus, and proposal metadata — verify against the live relay/index rather than trusting the note, and fix the **publisher** side where a gap is real.
3. A visible, honest degraded state in German when running on the record (stale/limited data is fine; pretending it is live is not).

**Out of scope**
- Writing to Supabase from the record, or making the record writable by unauthenticated clients.
- Realtime features (DMs, live chat) — they stay Supabase/XMTP. Do not fake them.
- Anything requiring the account layer.

## 4. Design constraints

- **Do not regress the online path.** Supabase stays primary for Röbel; the record is fallback. The switch must be observable and testable, not implicit.
- **Fork mode matters as much as outage mode.** A fork with no Supabase credentials at all should still render a usable read-only app. Design the seam so "no Supabase configured" is a first-class state, not an error path — this is what [the Ortis launch strategy](2026-08-11_STRATEGY_ORTIS_ONE_CLICK_COMMUNITY.md) depends on.
- **Web + native from one source.** `apps/expo` builds to iOS, Android, and the PWA. `record-client` must resolve under Metro on all three; check its module format before assuming.
- German UI copy; never surface Nostr jargon ("Relay", "npub", "Event-Kind") in user-facing text — the same rule that hides Circles/CRC. Internally, English identifiers.
- Respect the existing consent gate: [`lib/nostr/enroll.ts`](../../apps/expo/lib/nostr/enroll.ts) chains public-record participation into the ONE consent system. Reading is not publishing, but do not let a read path quietly start publishing.

## 5. Suggested slices

1. **Coverage audit** (no app code) — query the live relay/index for every dataset the app screens need; produce a table of covered / partial / missing, and note which are publisher gaps. Deliver as a short doc; it sizes the rest.
2. **Seam + one screen** — add the dependency, build the data-source seam, convert a single read-only surface (news or events) with a test proving Supabase-down falls back to the record.
3. **Publisher gaps** — fill the missing mirrors found in slice 1 (`packages/publisher`).
4. **Remaining read screens** — convert the rest of the read-only surfaces.
5. **Fork mode** — boot the app with no Supabase config and render the record-only experience end to end.

## 6. Verification

- `cd apps/expo && pnpm smoke:web` green after every slice.
- A test that simulates Supabase unavailability and asserts the fallback renders real content (not a spinner, not an error).
- Manual: airplane-mode / blocked-Supabase run on the installed PWA at `https://app.roebel.app`.
- No global `tsc` (≈431 pre-existing errors); use jest + smoke.

## 7. Open questions for Max

1. When both sources are available, should the record ever be preferred (e.g. for speed or for a "verify what's public" view), or is it strictly a fallback?
2. Should the degraded state be visible to every user, or only in a developer/advanced view?
3. Is a read-only fork (no writes without Supabase) an acceptable first milestone for other communities?
