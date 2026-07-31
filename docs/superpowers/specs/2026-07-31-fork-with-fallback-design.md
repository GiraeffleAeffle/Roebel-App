# Fork-with-fallback: the web app reads the public record when Supabase is absent

**Date: 2026-07-31.** Executes roadmap §13a and moves toward the §E bar. Companions:
[State of Nostr](../../STATE_OF_NOSTR.md), [Public data on Nostr](../../PUBLIC_DATA_ON_NOSTR.md),
[Data placement and CRUD](../../DATA_PLACEMENT_AND_CRUD.md), and the consumer contract
`netizen_labs/docs/CONSUMING_THE_RECORD.md`.

---

## 1. The goal, stated as a test

Someone forks the repo, configures **no Supabase credentials**, and runs `apps/web`. Every
public page renders the same data a visitor sees on roebel.app — read from the node's public
interfaces (`https://index.roebel.app` and the chain), with no key, no account, no permission.

This is the app-side half of the bar the roadmap already sets: *"build an entire Röbel-App
clone… using only the node's public interfaces, with no Supabase credentials."* Today a
keyless boot white-screens — `apps/web/src/lib/supabase.ts` throws at module load — and only
part of the public surface is on the record. Both halves are this spec.

## 2. Decisions (locked with Max, 2026-07-31)

1. **One spec, both halves.** The read seam and the missing publisher mappers ship under this
   design; the plan orders mappers first so the seam always has data to read.
2. **Static mode selection, not runtime failover.** Supabase env present → exactly today's
   behavior, byte for byte. Supabase env absent → all public reads go to the node index.
   No per-request fallback: it isn't needed for the fork story and it would double the test
   surface (partial outages, mixed states, cache coherence).
3. **Menus become a custom parameterised kind, one event per restaurant.** No standard NIP
   covers menus; a custom kind documented in the consumer contract is the honest choice.

## 3. Part 1 — completing the record (publisher)

Five new mappers in `packages/publisher/src/mappers.ts`, same pattern as the existing six:
pure row→`PublishSpec` functions, the mapper is the privacy boundary, each pinned by a
planted-PII test. Signing stays node-held (`deriveOrgIdentity` scopes); `created_at` =
`updated_at` (+ `MAPPER_VERSION`), so unchanged rows rebuild identical events and edits
replace.

### 3.1 News articles — the biggest gap

`news_articles` (`status=published`) → **NIP-23 kind 30023**, `d = news:<uuid>`, scope
`town`, tags `title`, `summary`, `image`, `published_at`, `t: news` (distinguishes news from
blog, whose `d` prefix stays `article:`), and `["ai_generated","true"]` where the AI-Act
label applies. HTML→Markdown via the existing `html-to-md.ts`. Author display name may appear
(it is already public in the app); author email/wallet never.

### 3.2 The Netizen civic kinds — 32100–32199

Three datasets have no standard NIP. They get a documented block of parameterised replaceable
kinds, declared in `CONSUMING_THE_RECORD.md` under a new "Netizen civic kinds" section.
**Verify the numbers against the current NIP registry at implementation time** (the CRUD
doc's own warning); if any is claimed since this writing, shift the whole block.

| Kind | Dataset | `d` tag | Content | Tags |
|---|---|---|---|---|
| **32100** | Proposal metadata (`proposals`) | `proposal:<uuid>` | short summary text | `title`; `governor` = `<chainId>:<governorAddress>`; `proposal_id` (on-chain id); `irys` (tx id of the full body); `status` snapshot; `published_at` |
| **32101** | Menu (`restaurants` + `menu_categories` + `menu_items`) | `restaurant:<uuid>` | menu JSON `{categories:[{name, items:[{name, description, price, currency}]}]}` | `title` (restaurant name), `location`, `image`, `t: menu` |
| **32102** | Civic notice (`service_alerts`, `announcements`) | `alert:<uuid>` / `announcement:<uuid>` | notice text | `title`, `t: service_alert` \| `announcement`, `severity` where present, `status` (`active`/`resolved` — resolution is an edit, never a deletion) |

Rules carried over from the existing kinds: the record event for a proposal is a **pointer**
— the body is already permanent on Irys and the authoritative state (votes, tallies,
execution) is on-chain; the event makes them discoverable and joinable. No wallet addresses
in any tag (the UI rule "never show raw 0x" starts at the record). Menu events are signed by
the restaurant's derived scope (`org-<account-id>` where the restaurant belongs to an org
account, else `resto-<restaurant-id>` — not `biz-`: restaurant ids are not `businesses` ids,
and scope strings must not collide across tables); proposals and notices by `town`.

### 3.3 Business profiles

`businesses` → **kind 0** under the existing `biz-<business_id>` scopes (the deals mapper
already derives these keys). Content mirrors the org-profile shape (`name`, `about`,
`picture`, `category`, `opening_hours`) plus the `["netizen_org", <slug>, <node>]` tag so a
record-mode client renders the directory one way. Profile ↔ deals join by pubkey — the same
rule orgs already follow.

### 3.4 Explicitly deferred

Mini-apps (the runtime needs served HTML and a backend), `documentation_chapters`, tourism
(`pois`/`tours`/`transit_*`), help hub. Each passes the CRUD-doc publish test and can follow
this pattern later; none blocks the fork story.

## 4. Part 2 — indexer tag filters

`GET /events` gains three filter params: `e`, `p`, `d` (comma-separated, same convention as
`authors`). Implementation in `packages/indexer/src/query.ts` as JSONB containment
(`tags @> '[["e","<id>"]]'`) with a GIN index on `tags` added idempotently in `schema.ts`.
Bound parameters only, `MAX_LIMIT` unchanged.

Why: without tag filters a client cannot fetch the replies/reactions of a post
(kind 1/7 with `e` tags) or a single CMS record by its stable `d` identity without scanning.
This also closes a documented gap for every outside consumer, not just our seam.
`CONSUMING_THE_RECORD.md` documents the new params.

## 5. Part 3 — `packages/record-client`

A new workspace package, `@netizen-labs/record-client`: isomorphic, `fetch`-only,
dependency-free (mirroring `packages/nostr`'s discipline). It is both the app's fallback data
layer and the reference implementation of the consumer contract for outside builders.

Surface (typed, returns the web app's existing row shapes):

- `listEvents`, `getEvent(d)` — kind 31923 minus `t: kino`
- `listMovies` — kind 31923 with `t: kino`
- `listNews`, `getNews(d)` / `listArticles`, `getArticle(d)` — kind 30023 split on `d` prefix
- `listOrgs`, `getOrgBySlug` — kind 0 with `netizen_org` tag (orgs and businesses)
- `listPosts({withAuthors})` — kind 1 + a batched kind-0 join for names/avatars
- `getThread(eventId)` / `reactionsFor(ids)` — kind 1/7 via the new `e` filter
- `listListings` — kind 30018, withdrawn tombstones hidden
- `listDeals` — kind 30402, `status=active` only
- `getMenu(restaurantId)` — kind 32101
- `listProposals` — kind 32100 (detail pages join Irys + chain as they already do)
- `listNotices` — kind 32102, `active` first
- `manifest()`, `mediaUrl(sha256)`

Contract rules baked in, not left to callers: the `d` tag is the record identity; event date
comes from the `start` tag, never `created_at`; replaceable semantics are already applied
server-side (no client-side dedupe); `ai_generated` and `bot`/`netizen_agent` labels are
surfaced on the returned rows so the UI must render them. Pagination via `until` cursors
beneath the index's 200-row cap.

## 6. Part 4 — the web app seam

### 6.1 Stop crashing

`apps/web/src/lib/supabase.ts` no longer throws at import. It exports:

- `hasSupabase: boolean` — env presence, evaluated once;
- `supabase` — the real client when configured; otherwise a `Proxy` that throws
  `"Supabase ist nicht konfiguriert (record mode)"` on first **property access**.

The Proxy is deliberate: the 29 importers include private-data paths this spec does not
port. In record mode they must fail loudly at the point of use — a visible error beats a
silently empty DM list. The same treatment (lazy `!` → guarded) applies to
`supabase/client.ts`, `server.ts`; `admin.ts` and middleware stay untouched (admin routes are
Supabase-only by definition).

### 6.2 Branch at the data-access layer

Each public read function branches once at the top —
`hasSupabase ? <today's PostgREST query, unchanged> : recordClient.<fn>()` — in:
`app/page.tsx` + `app/app/page.tsx` feed loaders, `actions/posts.ts` (`getPostsForFeed`),
`actions/movies.ts`, `actions/businesses.ts`, `actions/marketplace.ts`, the news queries,
`lib/supabase-gastro.ts`, `lib/supabase-org-content.ts`, the proposals loader, `karte`
loaders, and `StadtFeed`. Components stay untouched wherever the row shapes match — that is
the point of the record-client returning app shapes.

### 6.3 Honest degradation

Everything that cannot work keyless hides behind `hasSupabase`, with one small notice in the
shell: **"Öffentlicher Datensatz – nur Lesen"** (EN: "Public record — read only"). Hidden or
disabled: login entry, composer, likes/comments *writing* (reading works), ordering,
marketplace contact, all forms (newsletter, sommercamp, Röbel-Card, support), DMs,
notifications, points, admin, mini-apps, help hub, tourism, documentation. Untouched because
already keyless: DAO stats, social graph, proposal state/tallies, Circles/Münzen balances,
treasury, mint, Irys proposal bodies.

### 6.4 Config and media

- `NEXT_PUBLIC_NODE_INDEX_URL`, default `https://index.roebel.app` — a bare fork sees
  exactly Röbel's public data, which is the stated goal. A different community's fork points
  it at their node.
- Images render whatever URL the event carries: node-hosted `/media/<sha256>` (preferred,
  content-addressed) or legacy public Supabase Storage URLs — both load without keys.
  `next.config.mjs` already allows any remote host; no change.

## 7. Error handling

The record client throws one typed error (`RecordUnavailableError`) on network/HTTP failure;
read functions catch it and return empty results, and pages render their existing empty
states plus the read-only notice. No retries, no spinner loops — the index is one HTTP
service, and a fork operator seeing empty pages with a clear notice can diagnose it. A
keyless boot with an unreachable index must still render the shell and chain-backed pages.

## 8. Testing

TDD throughout; the centerpiece is the **round-trip parity test** in the publisher/record
packages: Supabase fixture row → publisher mapper → signed event → record-client → row′,
asserting row′ equals the public projection of the fixture. One test per dataset pins the
publish side and the read side against each other, so a mapper change that would break the
fork fails in CI, not in a fork.

Also:
- planted-PII tests for each new mapper (organiser/seller/author contact data cannot appear
  in a serialized event) — same pattern the existing mappers pin;
- record-client unit tests against fixture JSON, no network;
- indexer query tests for the new tag filters (bound params, containment, limit cap);
- the keyless smoke: `next build` with Supabase env stripped succeeds, and the main public
  routes render without throwing (route-level render test; full Playwright is out of scope).

## 9. Sequencing and repo discipline

1. Indexer tag filters (+ deploy with the next `netizen render/up`, alongside the pending
   vanish pipeline).
2. Publisher mappers: news → businesses → notices → menus → proposals; update
   `CONSUMING_THE_RECORD.md` (netizen_labs repo) and `PUBLIC_DATA_ON_NOSTR.md` §1 in the
   same change as each mapper (STATE docs rule).
3. `packages/record-client` with the parity tests.
4. The web seam: un-crash first, then dataset-by-dataset, most-visible surface first:
   events, news, orgs, posts, marketplace, movies, deals, menus, proposals, notices.
5. `FORKING_GUIDE.md` gains "Run without Supabase (record mode)" as the first option;
   roadmap §13a marked done.

Work lands in this monorepo (the node runs from here); docs and the eventual package mirror
sync to `netizen_labs` afterward, like `nostr`/`publisher`/`indexer` before it. Parallel
sessions are active on this repo: **pathspec-only commits, no bare `git add`**, and the spec/
plan artifacts keep the `fork-with-fallback` prefix.

## 10. Out of scope

- The Expo seam (same record-client would serve it; separate slice).
- Runtime failover for roebel.app itself.
- Writes over Nostr from the web (roadmap §10, web publishing, is separate).
- NIP-65/NIP-05 discoverability (roadmap §11), Blossom server, mini-apps/tourism/docs
  datasets, per-peer provenance — all tracked in the roadmap already.

## 11. Risks and honest limits

- **Custom kinds render only in Netizen-family clients.** Accepted for proposals/menus/
  notices — no standard NIP exists, and the consumer contract documents them. Standard kinds
  remain the rule everywhere one exists.
- **Feed completeness is consent-bound.** Citizen posts appear on the record only for
  enrolled citizens — by design. A fork's feed is the consented public record, not a mirror
  of the private database. The spec does not change any consent boundary.
- **Interaction counts.** Record mode derives like/comment counts from fetched kind 7/1
  events per page of posts (via the new `e` filter), which undercounts relative to the
  denormalised Supabase counters when history exceeds fetch limits. Accepted: counts are
  advisory in a read-only client.
- **Legacy media.** Older citizen-signed events carry Supabase Storage URLs; they work while
  Röbel's project exists but are not content-addressed. Not worth a backfill now.
