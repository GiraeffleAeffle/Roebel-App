# Shared Staging Environment — Design Spec

**Date:** 2026-07-24
**Status:** Draft (awaiting review)
**Trigger:** A contributing developer asked whether a staging environment exists, or how to fork the Röbel app so it's easier to test everything.

## Goal

Give external contributors a **shared, safe place to run and test the full Röbel app** (web + mobile) without provisioning their own backend and without any risk to production data. A contributor should be able to either:

- **Open a hosted staging URL** and test the app with zero setup, or
- **Run the app locally** against the shared staging backend using only **two public values** (staging Supabase URL + anon key) plus a public thirdweb client ID.

## Non-negotiable constraint

**Nothing in this work may change production behavior.** The design is therefore *strictly additive*:

- Every artifact is a **new file** (env templates, seed SQL, docs) except one **additive, non-breaking** edit: a new `staging` profile appended to `apps/expo/eas.json` (existing profiles untouched).
- **No production code path is modified.** Staging-side safety (crons, coordinator, webhooks, push) is achieved purely by **withholding secrets** on the separate staging deployment — see "Staging safety" below — not by editing handlers.
- Production stays a **separate Vercel project + separate Supabase project** that keep all their current env and secrets exactly as they are today.

## Chosen approach: persistent free staging project (Approach A)

One long-lived staging backend that web, mobile, and local dev all point at:

```
                    LIVE Gnosis mainnet contracts (chain 100)  ← read-only, shared
                                   ▲
                ┌──────────────────┼──────────────────┐
  stage.roebel.app         EAS "staging" build         local dev
  (Vercel staging project,   (internal distribution,     (contributor machine,
   full secrets)              staging channel)             minimal public env)
                └──────────────────┼──────────────────┘
                                   ▼
                   Supabase project "roebel-staging"
             (migrations + edge functions + seed test data;
              anon key is public/safe to share; service_role and
              AI / webhook secrets stay only with the maintainer)
```

Rejected alternatives:

- **B — Supabase Branching + Vercel Preview (per-PR ephemeral).** Needs Supabase Pro (~$25/mo), and ephemeral per-PR backends can't be baked into an Expo build, so it doesn't serve mobile. Overkill for a small contributor pool.
- **C — Local-first Supabase (Docker).** Not *shared*; doesn't answer "so others can test everything."

## Components

### 1. Staging Supabase project (`roebel-staging`)

- A new **free-tier** Supabase project, fully isolated from production (`wwbeqhkslxdxhktqzqti`).
- Canonical migrations applied on top, then edge functions deployed, then seed data loaded.
- **Anon key + URL are safe to share** with contributors (RLS-gated; the anon key already ships inside the published apps). **`service_role` key and all function secrets stay with the maintainer.**
- **Open question O1:** the repo has two migration directories — `supabase/migrations` (80 files) and `apps/expo/supabase/migrations` (39 files). The runbook must confirm which set represents production before applying to staging. Default assumption pending confirmation: `apps/expo/supabase/migrations` is the app-linked set (edge functions live under `apps/expo/supabase/functions`), but this must be verified against the live prod schema, not assumed.

### 2. Seed data (`supabase/seed-staging.sql`)

- A new SQL file loaded **only** against the staging DB, giving contributors a non-empty app: a handful of test users, sample feed posts, a sample proposal/event, sample Münzen balances where those are DB-backed.
- Written to be **idempotent** (safe to re-run) and to touch only staging.
- Contains **no PII and no real user data.**

### 3. Web — staging Vercel deployment

- A **separate Vercel project** (or a dedicated `staging` environment) building the same repo, pointed at the staging Supabase project.
- Full server secrets set **by the maintainer** on that staging project so the hosted URL exercises server routes.
- **Open question O2:** dedicated `stage.roebel.app` subdomain vs. Vercel's default deployment URL. Either works; subdomain is nicer for contributors. Decide at provisioning.

### 4. Mobile — EAS `staging` profile + channel

- Append a `staging` build profile to `apps/expo/eas.json` (channel `staging`, `distribution: internal`) — purely additive; `development` / `preview` / `production` are untouched.
- A staging dev build is baked with the staging `apps/expo/.env` (staging Supabase + `EXPO_PUBLIC_MINIAPP_API_BASE` = the staging web URL) and distributed to contributors via EAS internal distribution (QR / TestFlight-internal). OTA staging updates flow on the `staging` channel.
- Alternatively contributors run Expo Go locally with a staging `.env` — documented as the lightweight path.

### 5. Env templates (new files)

- `apps/web/.env.staging.example` and `apps/expo/.env.staging.example`: staging-shaped copies of the existing `.env.example` files that make explicit **which variables a contributor actually needs** (the minimal public set) vs. which are **maintainer-only server secrets** they can leave blank when testing locally.

### 6. Docs

- **`docs/FORKING_GUIDE.md`** (currently just `TODO`): filled in as the contributor-facing guide — clone, install, run web + expo, point at staging with the minimal env, and the "fork for your own town" path. This is what the developer's question maps to directly.
- **`docs/STAGING_ENVIRONMENT.md`**: the **maintainer runbook** — the ordered, copy-pasteable steps to *provision* staging (create Supabase staging → apply canonical migrations → deploy edge functions → set the maintainer-only secrets → create the Vercel staging project + env → run the EAS staging build → share the URL + QR). Also documents exactly which secrets to **withhold** for staging safety.

## Staging safety (why staging can't hurt production or real users)

Achieved by **configuration, not code**:

- **Separate projects.** Staging Supabase and staging Vercel are distinct from production; a contributor writing through the staging anon key can only reach the staging DB, which is RLS-gated and seeded with throwaway data.
- **Crons / coordinator inert on staging by omission.** The Mecky, newsletter, dev-ticket, and store-metrics crons guard on `CRON_SECRET`; the coordinator `chain-listener` guards on `BASE_RPC_URL`. If the staging Vercel project **does not set these secrets**, those jobs return unauthorized / not-configured and no-op — with **no handler change**. The runbook lists the secrets to withhold on staging: `CRON_SECRET`, `BASE_RPC_URL`/coordinator RPC, `COORDINATOR_ETH_PRIV`, Monerium/Stripe webhook secrets, Resend, and the push-notification path.
- **No real notifications.** Because push/webhook/newsletter secrets are withheld, staging can't email or push real users.
- Optional future hardening (out of scope for v1, noted for later): a shared `isStaging()` helper reading `ROEBEL_ENV=staging` for belt-and-suspenders early-returns. Not needed for correctness and deliberately omitted to keep production code untouched.

## Blockchain constraint (documented, not worked around)

Staging shares the **live Gnosis mainnet contracts** (chain 100) — there is no cheap way to stand up a parallel MACI + Governor + NFT + Circles stack. Consequences, which the docs must state plainly:

- **Read-heavy flows test fully on staging:** viewing proposals, citizen/attester lists, Münzen balances, the feed, DMs, profiles, mini-apps.
- **Live governance write-paths cannot be exercised by a normal contributor:** propose / attest / vote require an Attester or Citizen NFT the contributor won't hold, and staging test-writes must **not** create junk in the real DAO or Circles trust graph.
- Therefore staging is **"full app UX minus live on-chain governance writes."**
- **Contract-level development stays a separate track** (Hardhat local tests, optional Chiado testnet at chain 10200), documented in the forking guide but out of scope for the shared staging backend, since the target contributor's focus is web + mobile.

## Deliverables checklist

Repo changes (maintainer can do now, all non-breaking):

1. `apps/expo/eas.json` — append `staging` profile (additive).
2. `apps/web/.env.staging.example` (new).
3. `apps/expo/.env.staging.example` (new).
4. `supabase/seed-staging.sql` (new, idempotent, staging-only).
5. `docs/FORKING_GUIDE.md` — replace `TODO` with the contributor guide.
6. `docs/STAGING_ENVIRONMENT.md` — new maintainer runbook.

Cloud provisioning (maintainer executes from the runbook; cannot be automated from here because Supabase MCP / Vercel / EAS need interactive auth):

7. Create staging Supabase project + apply canonical migrations + deploy edge functions + set maintainer secrets + load seed.
8. Create the Vercel staging project/env (withholding the cron/coordinator/webhook secrets).
9. Configure the thirdweb staging client (or reuse the existing public client id).
10. Run the EAS `staging` build and share URL + QR with contributors.

## Success criteria

- A contributor can open the hosted staging URL and use the app end-to-end (read flows) with zero setup.
- A contributor can run `apps/web` and `apps/expo` locally against staging with only the staging Supabase URL + anon key + a public thirdweb client id.
- `docs/FORKING_GUIDE.md` is no longer a `TODO` and answers "how do I fork/run/test this."
- Production Supabase and production Vercel are provably untouched: no prod env changed, no prod code path modified, `git diff` on production-affecting files is empty except the additive `eas.json` profile.

## Open questions (to resolve during provisioning, not blockers)

- **O1:** Which migration directory is canonical for provisioning staging.
- **O2:** Dedicated `stage.roebel.app` subdomain vs. default Vercel URL.
