# Strategy — One-click community launch from the Ortis Dashboard

**Date:** 2026-08-11 · **Status:** strategy draft for review · **Depends on:** [K1](2026-08-11_K1_NETIZEN_ACCOUNTS_REPLACES_THIRDWEB.md), [K2](2026-08-11_K2_NOSTR_READ_FALLBACK.md)

## 1. The goal

From the Ortis Dashboard, in a few clicks: enter a community's name, domain, and
type — get back a deployed stack and an **installable PWA at their own domain**,
with a resident AI agent. Röbel is tenant #1. Tenant #2 is a different town or a
political party.

## 2. What already exists (verified 2026-08-11)

This is further along than it feels, because the delivery half was proven this week.

| Layer | State |
|---|---|
| **PWA build + deploy** | Works and is scriptable: `pnpm export:web` → static bundle → Vercel → custom domain. Röbel is live at `app.roebel.app`, installable, offline-capable. Runbook: [`docs/EXPO_WEB_PWA.md`](../EXPO_WEB_PWA.md). |
| **Service installer** | `packages/cli`: `netizen <render\|up\|doctor> <manifest.json>` — manifest-driven rendering and deployment to a node. |
| **On-chain bootstrap** | `CommunityRegistry` on Gnosis (`0x1c4B243a…`, unowned, admin-free), plus contract presets and a factory script. |
| **Per-community identity** | `ortis-id` is live at `id.ortis.app` — an OIDC issuer per community, already proven in production. |
| **Public record** | Relay + index + publisher + `packages/record-client`, already consumed by `apps/web`. |
| **Resident agents** | Agent runtime + `agent-watcher`; Mecky runs against the manifest. |

**What is missing is not the pieces — it is that the app itself is single-tenant.**

## 3. The core obstacle, measured

`apps/expo` is Röbel, hardcoded:

- **224 source files** mention `Röbel`/`roebel`.
- Endpoints are baked in: `wss://relay.roebel.app`, `https://index.roebel.app`, `https://roebel.app`, `https://www.roebel.app`.
- `app.config.ts` hardcodes name, slug, scheme, bundle identifiers, splash, icons, associated domains, and ~30 deep-link intent filters on `roebel.app`.
- Contract addresses are env-overridable but default to Röbel's Gnosis v2 set; `CHAIN_ID = 100` lives in `packages/blockchain`.
- Supabase is already env-driven (good) — `lib/supabase.ts` reads `SUPABASE_URL`/`SUPABASE_ANON_KEY` from `extra`.
- German copy is written for Röbel specifically ("Röbel/Müritz", "Röbel Münzen").

Two more gates block *self-serve* onboarding today:

1. **thirdweb** requires a client ID and a per-domain origin allowlist that only an account holder can configure — a manual dashboard step in the middle of an otherwise automatable flow. **[K1](2026-08-11_K1_NETIZEN_ACCOUNTS_REPLACES_THIRDWEB.md) removes this**, which is why K1 is a prerequisite for "one click", not merely a sovereignty nicety.
2. **Supabase** — every tenant needs a backend. Without [K2](2026-08-11_K2_NOSTR_READ_FALLBACK.md), a tenant cannot even run read-only without one.

## 3a. DECIDED — domains are `<name>.ortis.app` (2026-08-11, Max)

Every tenant gets a subdomain of `ortis.app`, derived from the project name and
**editable afterwards**: an operator who creates "Strausberg" lands on
`strausberg.ortis.app`. A custom domain stays possible later, but is never
required to launch.

This removes the single worst step from the launch flow. Röbel needed a manual
IONOS `A` record because `roebel.app` is on third-party nameservers; **`ortis.app`
is already on Vercel nameservers**, so tenant subdomains can be created through
the Vercel API with no human DNS step and no registrar access. Combined with the
observed cert issuance (~1 minute), a launch can be fully automated end to end.

Implications the pipeline must handle:

- **Name → subdomain slugification** with a reserved list (`app`, `id`, `www`,
  `api`, `admin`, …) and a collision check against existing tenants.
- **Renaming** must move the domain and leave the old subdomain redirecting, not
  dangling — the PWA is installed on people's home screens, and `start_url` is
  origin-bound. An installed app whose origin disappears is a dead icon.
  Treat rename as a migration, not a config edit.
- **Per-tenant PWA identity**: `manifest.json` `id`/`start_url`/`scope` are
  origin-scoped, so each tenant's manifest is generated, not shared.
- The wildcard makes tenant isolation a *browser origin* boundary too: separate
  localStorage, separate service worker, separate installed app. Good default.
- One Vercel project per tenant vs one project with many domains is now the open
  sub-question (see §7.4); the subdomain decision does not settle it.

## 4. Architecture: one tenant manifest, four consumers

Extend the existing manifest philosophy rather than inventing a parallel config
system. One `community.json` per tenant is the single source of truth, consumed by:

1. **The PWA build** — branding (name, colors, icons, fonts), copy overrides, endpoints, contract addresses, feature flags.
2. **`netizen render` / `up`** — services for that community (relay, index, agent, coordinator as needed).
3. **Contract deployment** — preset + factory, then a record written to `CommunityRegistry`.
4. **Agent provisioning** — persona, language, knowledge sources.

Rule to carry over from existing practice: *everything goes into the installer.*
If a launch step is hand-wired, it will drift; make it a manifest field.

## 5. Phases

### P0 — Make the app multi-tenant (the real work)

Turn `apps/expo` from "the Röbel app" into "a community app that ships as Röbel".

- A `tenant` config module resolved at build time from `community.json`, feeding `app.config.ts` (name, scheme, identifiers, deep-link hosts, icons) and a runtime config object (endpoints, contracts, feature flags).
- Extract user-facing strings into a per-tenant copy layer. Do **not** attempt a full i18n migration in the same pass — scope it to community-specific nouns first (community name, currency name, region), which is the majority of the 224 hits.
- Generate icons/splash from a tenant logo (the existing `sharp` pipeline already does this for Röbel).
- Feature flags per community type: Circles currency, citizen verification, MACI voting, Amt/administration integration, marketplace.
- **Acceptance: build Röbel and one throwaway tenant from the same source, both installable, with no code changes between them.** Röbel's output must be behaviorally identical to today.

### P1 — Headless launch pipeline

A single command/API: `community.json` → contracts deployed + registry record → services up → PWA built and deployed to the tenant's domain → agent running. Everything the runbook does by hand today, automated, including the DNS record and the deployment protection setting.

Carry forward the two traps already documented in [`docs/EXPO_WEB_PWA.md`](../EXPO_WEB_PWA.md): never deploy a `dist/` you did not just build, and PWA head tags live in `public/index.html` (not `+html.tsx`) at `output: 'single'`.

### P2 — Ortis Dashboard UI

The few-clicks surface over P1: a form (name, domain, type, logo, colors), a preview, a launch button, and a live progress view. Then ongoing management: redeploy, update branding, rotate agent settings, view status. Ortis lives in the **Netizen-Labs repo**, so P2 spans both repos — P1's pipeline must therefore be callable as a service, not only as a local CLI.

### P3 — Presets per community type

- **Town** (Röbel): geofenced posting, attester-based citizen verification, Circles currency, administration surfaces.
- **Political party**: roster/invite-based membership instead of geofence, motions and internal votes, no local currency, strong minutes/decision record.
- **Online community**: no geography at all; identity by invitation.

Presets are manifest defaults, not forks of the code.

## 6. Sequencing (recommended)

```
K2 (record fallback) ──┐
                       ├──> P0 (multi-tenant app) ──> P1 (pipeline) ──> P2 (dashboard) ──> P3 (presets)
K1 (accounts) ─────────┘
K3 (identity inversion) runs after K1's memo; it is not on the launch critical path.
```

K1 and K2 are parallelizable and both unblock P0's "tenant without our infrastructure" story. P0 is the largest single body of work and should not start before the K1 migration memo is decided, because the account layer determines what the tenant manifest must carry.

## 7. Open decisions for Max

1. ~~**Backend per tenant.**~~ **DECIDED 2026-08-11 (Max): one Supabase project per community.** Clean data isolation, per-community DSGVO controllership, straightforward deletion. Costs: the pipeline must provision via the Supabase Management API, and — combined with the self-serve signup decision — **every signup provisions a paid resource**, so a launch policy gate is mandatory (see [K4 §4.1](2026-08-11_K4_ORTIS_DASHBOARD.md)). A record-only free tier ([K2](2026-08-11_K2_NOSTR_READ_FALLBACK.md)) remains the candidate safe default for unpaid signups.

   *Why not "just build a Supabase alternative on Nostr":* Nostr is an append-only signed event log with a fixed filter grammar (ids / authors / kinds / #tags / since / until / limit). No joins, aggregates, transactions, row-level auth, file storage, or server functions. The speed answer is already in this repo, though: `packages/indexer` ingests relay events into **Postgres** and serves them over a plain HTTP query API (`index.roebel.app`), which `packages/record-client` reads with no API key. That is the CQRS split — **Nostr is the sovereign write log, Postgres is the fast read model** — and it is what makes a record-only tenant viable *and* fast. What Supabase still uniquely supplies is auth/RLS, media storage, edge functions, and realtime; replacing those is a separate track, not a prerequisite for launch.
2. **Who is the data controller?** Each community almost certainly must be its own controller under DSGVO, which means per-tenant DPIA, imprint, and policy documents — a product surface, not just paperwork. Selling to an Amt or a party makes this load-bearing.
3. **Chain per tenant.** Do all communities share Gnosis and the existing registry, or does a tenant get to choose? Shared is far simpler and the registry is already unowned and admin-free.
4. **Hosting shape.** Now that domains are settled (§3a): one Vercel project per tenant (clean separation, per-tenant deploy history and rollback, N projects to manage) vs one project serving many tenant domains (one deploy, cheaper, but a bad deploy hits every community at once). Self-hosting via `netizen up` remains the sovereign option for tenants who want it.
5. **Native apps.** Do tenants ever get iOS/Android builds, or is store-free PWA the whole product? PWA-only keeps launches self-serve; native requires an Apple account per tenant and re-introduces exactly the gate this work removes.
6. **Naming.** "Röbel Münzen" is community-specific; each tenant needs its own currency noun (or none). Confirm the copy layer covers this.

## 8. What to hand an agent first

If you want motion before the decisions in §7 land, the safe first task is **P0's
tenant-config seam** for endpoints and contracts only (no copy extraction, no
branding pipeline). It is additive, testable behind `pnpm smoke:web`, valuable
under every option in §7, and it makes the 224-file copy problem visible in a
concrete diff before anyone commits to the big refactor.
