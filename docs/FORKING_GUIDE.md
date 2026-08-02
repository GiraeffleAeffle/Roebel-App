# Forking & Testing Guide

This guide is for **contributors** who want to run and test the Röbel App, and for
towns who want to **fork the platform** for themselves. If you just asked *"is there
a staging environment / how do I test this easily?"* — start with
[Testing against staging](#testing-against-staging).

- **Just want to see it run, zero setup?** → [Ohne Supabase starten (record mode)](#ohne-supabase-starten-record-mode)
- **Contributor?** → [Prerequisites](#prerequisites) → [Testing against staging](#testing-against-staging)
- **Maintainer provisioning staging?** → [docs/STAGING_ENVIRONMENT.md](STAGING_ENVIRONMENT.md)
- **Forking for your own town?** → [Fork for your own town](#fork-for-your-own-town)

---

## TL;DR — the four ways to test

| Goal | What to do | Setup effort |
|---|---|---|
| Clone and run the **web** app with zero backend | `pnpm install`, run `apps/web` with no env | none |
| Just look at / click through the app | Open **https://stage.roebel.app** | none |
| Develop the **web** app | Run `apps/web` locally, point at staging Supabase | ~2 min |
| Develop the **mobile** app | Run `apps/expo` in Expo Go, point at staging Supabase | ~5 min |

You do **not** need to fork or provision anything to contribute — staging is shared.
You only fork if you want your *own town's* independent instance.

---

## Ohne Supabase starten (record mode)

The fastest way to see the app run at all: **no Supabase project, no env file, no
credentials.** `apps/web` reads the town's public record straight off the node's
HTTP index instead of PostgREST, so every public page renders with real data even
when `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are absent.

```bash
git clone https://github.com/Roebel-Labs/Roebel-App.git
cd Roebel-App
pnpm install
cd apps/web
pnpm dev        # → http://localhost:3000, no .env.local needed
```

Open it and you'll see **Röbel's actual public record** — the default index is
`https://index.roebel.app`, the same node the production app talks to, just
through its read-only public interface instead of the database.

To point the app at a **different community's node** instead, set one variable:

```bash
NEXT_PUBLIC_NODE_INDEX_URL=https://index.example-town.app pnpm dev
```

That's the whole seam — [`apps/web/src/lib/record.ts`](../apps/web/src/lib/record.ts)
constructs the index client from that single env var, defaulting to Röbel's own
node when it's unset.

**What works in record mode** — all public reading: the feed, events, news,
cinema programme, organisations, marketplace, business deals, restaurant menus,
governance proposals, civic notices, and the map.

**What does not** — anything that needs a backend to write or to know who you
are: login, posting, likes/comments, any form, DMs, notifications, the points
card, the mini-app runtime, QR ordering. A navy banner across the top says so
plainly: *"Öffentlicher Datensatz – nur Lesen. Diese Instanz läuft ohne Backend
und zeigt das öffentliche Register der Stadt."* — and every write affordance is
hidden rather than shown-then-failing.

This is genuinely read-only, not a demo mode with fake data — it's Röbel's live
public record, sourced the same way an outside client would. See
[Public data on Nostr](PUBLIC_DATA_ON_NOSTR.md) for what's published and why, and
[Roadmap and deferred work §13a](ROADMAP_AND_DEFERRED.md) for how this shipped.

**The acceptance test is [`apps/web/scripts/keyless-smoke.sh`](../apps/web/scripts/keyless-smoke.sh)** —
it builds and boots the app with the Supabase env genuinely absent (not just
unread) and asserts all eight public routes (`/`, `/news`, `/app`,
`/app/marktplatz`, `/proposals`, `/karte`, `/app/events`, `/unternehmen`) return
HTTP 200 with the record-mode banner present. Run it yourself with:

```bash
cd apps/web
./scripts/keyless-smoke.sh
```

---

## Prerequisites

- [Node.js](https://nodejs.org/) v20+
- [pnpm](https://pnpm.io/) v9+ (this is a pnpm workspace — do **not** use npm/yarn)
- For mobile: the [Expo Go](https://expo.dev/go) app on your phone, or an iOS/Android simulator

```bash
git clone https://github.com/Roebel-Labs/Roebel-App.git
cd Roebel-App
pnpm install
```

---

## Testing against staging

There is a **shared staging environment** so contributors never touch production
data and don't need to provision their own backend. It has its own Supabase
project and its own hosted web deploy, and both the web and mobile apps can point
at it.

**What you need from the maintainer** (ask in the contributor chat): the staging
**Supabase URL** and **anon key**, plus a **thirdweb client id**. All three are safe
to share — the anon key is row-level-security-gated and already ships inside the
published apps.

### Web (Next.js)

```bash
cp apps/web/.env.staging.example apps/web/.env.local
# edit apps/web/.env.local — fill in NEXT_PUBLIC_SUPABASE_URL,
# NEXT_PUBLIC_SUPABASE_ANON_KEY (staging), and NEXT_PUBLIC_TEMPLATE_CLIENT_ID.
# Leave every "maintainer-only" secret blank.

pnpm dev:web        # → http://localhost:3000
```

Everything below the "minimal set" line in the template is optional for
contributors — the affected server routes just no-op or degrade gracefully.

### Mobile (Expo)

```bash
cp apps/expo/.env.staging.example apps/expo/.env
# edit apps/expo/.env — fill in the same staging Supabase URL + anon key,
# EXPO_PUBLIC_THIRDWEB_CLIENT_ID, and keep
# EXPO_PUBLIC_MINIAPP_API_BASE=https://stage.roebel.app

pnpm dev:expo       # scan the QR with Expo Go
```

> **Expo env bakes at build/start time.** [app.config.ts](../apps/expo/app.config.ts)
> reads `process.env` into `extra`, so after editing `.env` you must **restart the
> dev server**. There's no runtime env switch. A distributed staging *dev build*
> (EAS internal distribution on the `staging` channel) is the maintainer's job —
> see the runbook.

---

## What works on staging — and what doesn't

Staging shares the **live Gnosis mainnet contracts** (chain id 100). There's no
cheap way to stand up a parallel identity + MACI + Governor + Circles stack, so:

**✅ Fully testable on staging** (this is most of the app):
- The whole app UI/UX, navigation, feed, profiles, mini-apps
- Reading on-chain data: proposals, citizen/attester lists, Röbel Münzen balances
- Supabase-backed features: posts, comments, likes, events, DMs (against staging DB)

**⚠️ Not testable as a normal contributor:**
- **Creating proposals / attesting / voting** — these require an Attester or
  Citizen NFT you won't hold, and staging must **not** write junk into the real
  DAO or Circles trust graph. Treat live governance writes as read-only on staging.

**🔧 Contract-level work is a separate track** (see below) — not part of shared
staging, because staging deliberately reuses the live contracts.

---

## Contributing workflow

We use **trunk-based development** — see [CONTRIBUTING.md](../CONTRIBUTING.md) for the
full rules, commit conventions, and PR checklist. In short:

- Small fix/docs → commit to `main`. Larger/multi-app/contract work → short-lived
  `feat/…` branch → PR → let CI pass → merge → delete branch.
- Never commit real API keys. The `.env.staging.example` files use placeholders only.

---

## Smart-contract development (separate from staging)

If you're changing Solidity, don't use shared staging — work locally:

```bash
cd contracts/governor-contract
cp .env.example .env        # fill in as needed
npx hardhat compile
npx hardhat test            # local, free, isolated
```

For an integration testnet, Gnosis has **Chiado** (chain id 10200, free faucet
xDAI). Deploying a full parallel identity+governance+Circles stack there is a large
task and out of scope for app contributors — coordinate with the maintainers first.
The live address source of truth is
[packages/blockchain/src/index.ts](../packages/blockchain/src/index.ts).

---

## Fork for your own town

The other meaning of "fork" — running an independent instance for a different town:

1. Fork this repository.
2. Rebrand: colors/fonts/mascot in [packages/design-tokens/](../packages/design-tokens/)
   and the primary color / German copy (see [CLAUDE.md](../CLAUDE.md) → Development Notes).
3. Deploy your own **Supabase** project; apply the migrations and edge functions.
4. Deploy **web** to Vercel and build **mobile** with EAS, each with your own env.
5. Deploy the identity + governance contracts on Gnosis (optionally register your
   own Circles group currency). The contract sources and deployment manifests are
   under [contracts/governor-contract/](../contracts/governor-contract/).

Setting up your own shared staging environment for your fork? The maintainer
runbook — [docs/STAGING_ENVIRONMENT.md](STAGING_ENVIRONMENT.md) — is written to be
reused verbatim; just swap in your project names and domain.

---

## Trouble?

- Open a [GitHub issue](https://github.com/Roebel-Labs/Roebel-App/issues) with
  reproduction steps.
- Web build runs out of memory? Heavy server-only deps must go in
  `serverExternalPackages` — see the notes in [apps/web](../apps/web/).
- Something staging-specific broken? Ping the maintainer — they own the staging
  Supabase/Vercel/EAS config.
