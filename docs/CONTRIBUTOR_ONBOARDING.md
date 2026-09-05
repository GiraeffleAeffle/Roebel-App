# Contributing to Röbel — Full Access, Sovereign by Design

Welcome. You have **everything to contribute fully to staging** without touching production
or provisioning anything. This is the short version; deep links at the bottom.

## What you already have

- **Write access** to `Roebel-Labs/Roebel-App`.
- A **shared staging environment** = an exact schema clone of prod, with **fabricated dummy
  data** (feed, events, restaurant/menu, map POIs) and **no real PII**.
- **`stage.roebel.app`** — the hosted staging site (tracks the `staging` branch).
- **Per-branch Vercel preview URLs** — push a branch, get a live URL running against staging.
- **Mobile OTA** — merges to the `staging` branch auto-publish an OTA to the staging app build.

## Get running (~5 min)

```bash
git clone https://github.com/Roebel-Labs/Roebel-App.git
cd Roebel-App && pnpm install          # pnpm only, not npm/yarn
cp apps/web/.env.staging.example  apps/web/.env.local
cp apps/expo/.env.staging.example apps/expo/.env    # fill staging Supabase URL + anon key + thirdweb client id
pnpm dev:web    # localhost:3000
pnpm dev:expo   # Expo Go / dev client — instant hot-reload
```

Full details + the values: **[docs/FORKING_GUIDE.md](FORKING_GUIDE.md)**.

## The contribution loop

1. Branch off `main`, build **locally against staging** (fastest feedback).
2. Push → your branch gets a **Vercel preview URL** (web) automatically.
3. Open a **PR to `main`** → CI runs, gets reviewed, merged.
4. Shared mobile build: merge to **`staging`** → OTA lands live. *(JS/asset changes only; native
   changes need a fresh `eas build`.)*

## Where your AI pipeline plugs in

The app is already AI-native and built to be **provider-agnostic** — that's the seam you extend:

- **Mecky** — the in-app assistant (German), Claude-powered, tool-using: `apps/expo/app/messages/mecky.tsx`.
- **AI edge functions** — e.g. `moderate-post` (Claude Haiku classification), `generate-menu-image`
  (image models). Server-side runtime + a **service key**, never the app's client key.
- **Model routing principle** — right model per job: Opus for reasoning, Sonnet for chat/research,
  Haiku for classification, image models for visuals. Keep the **LLM behind an injected seam** so a
  provider can be swapped without touching callers.
- **Reference implementation to mirror** — the **Fördermittel Agent** is a clean, DI-style AI
  pipeline (deterministic hard-filters + an *injected* LLM ranking seam + honest matching):
  [docs/superpowers/specs/2026-07-24-foerdermittel-agent-design.md](superpowers/specs/2026-07-24-foerdermittel-agent-design.md).
  Copy its shape for new agents.
- **Structured context / tools (MCP)** — how AI reads town context:
  [docs/ROEBEL_CLAUDE_CONNECTOR.md](ROEBEL_CLAUDE_CONNECTOR.md).
- **Where it's heading** — Mecky is moving reactive → agentic (a Town Context Graph + a server-side
  outbound runtime): [docs/MECKY_AGENT_ROADMAP.md](MECKY_AGENT_ROADMAP.md).

**To add an AI feature:** put the runtime **server-side** (Supabase edge function or a Next API
route), inject the model behind an interface (see Fördermittel), and read/write staging via the
service role. Test it end-to-end on staging before a PR.

## The north star — sovereign & self-hosted

We're building toward **full digital sovereignty**: self-hosting on **Hetzner**, our own auth/4337
rails, and **self-hosted open models** (EuroLLM / LiteLLM gateway) alongside frontier APIs. So when
you build AI: **make it provider-swappable** (one config/gateway, not hard-coded to one vendor) — that
future-proofs it for the migration off hosted APIs onto our own infra.

- Technical direction: [docs/future-research/2026-07-22_NETIZEN_SOVEREIGN_STACK_RESEARCH.md](future-research/2026-07-22_NETIZEN_SOVEREIGN_STACK_RESEARCH.md)
- The why / strategy: [docs/future-research/2026-07-22_NETIZEN_BUSINESS_PLAN.md](future-research/2026-07-22_NETIZEN_BUSINESS_PLAN.md) ·
  [docs/SOVEREIGN_AI_COMMUNITY_WEALTH_STUDY.md](SOVEREIGN_AI_COMMUNITY_WEALTH_STUDY.md)

## Context map — read these first

| Topic | Doc |
|---|---|
| Architecture & conventions | [AGENTS.md](../AGENTS.md) · [CI automation](CI_AUTOMATION.md) |
| Run & test on staging | [docs/FORKING_GUIDE.md](FORKING_GUIDE.md) |
| AI / agent direction | [docs/MECKY_AGENT_ROADMAP.md](MECKY_AGENT_ROADMAP.md) |
| AI pipeline worked example | [foerdermittel-agent-design](superpowers/specs/2026-07-24-foerdermittel-agent-design.md) |
| Sovereignty / Hetzner | [sovereign-stack-research](future-research/2026-07-22_NETIZEN_SOVEREIGN_STACK_RESEARCH.md) |

## Ground rules

- **pnpm** only; **German** for user-facing UI text.
- **Never** commit secrets; **never** put real user data into staging — dummy data only
  (`supabase/seed-staging.sql`).
- Keep AI **provider-agnostic** (swappable seam) — we're migrating to self-hosted models.

Questions → open a GitHub Discussion or ping the maintainer. Build something great. 🚀
