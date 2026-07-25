# Mission & Goals

> The canonical north-star for the Röbel / Netizen project. Everything in
> [`docs/future-research/`](future-research/README.md), the
> [technical blueprint](superpowers/specs/2026-07-21-netizen-stack-design.md), and the product specs
> serves this. Research/strategy record — not legal advice; real-money phases gated by the
> [Legal Masterplan](future-research/LEGAL_MASTERPLAN.md).

## Mission

I'm building **sovereign blockchain × AI infrastructure** — starting in my hometown (Röbel/Müritz),
but designed to scale to **businesses, other Gemeinden, communities, and every kind of coordinated
human organisation — and to single sovereign persons — worldwide** (from Röbel to communities across
Europe, Asia, and beyond). The goal is to **solve coordination and decision-making by increasing the
flow of both information and payments, using AI and crypto.**

## The thesis

If many **sovereign nodes** — individuals, communities, Gemeinden, companies, and organisations of
all kinds — **own their own infrastructure and data with public/private-key cryptography**, then:

1. **AI can connect to and read across those nodes' data** to make decisions faster and better;
2. **coordination and real-money execution happen on blockchains;**
3. **decisions are made through cryptographic, technodemocratic processes;**
4. **AI automation and metric-based predictions guide execution.**

Together this could move humanity toward a **more efficient, sustainable, growth-oriented future.**

*(This is the same arc the corpus already traces — civic app → prosperity engine → coordination
protocol → sovereign stack. See [DECADE_STRATEGY §0](future-research/DECADE_STRATEGY.md) and
[COORDINATION_PROTOCOL_THESIS](future-research/COORDINATION_PROTOCOL_THESIS.md).)*

## Goals (the pillars)

Each goal is a layer of "a sovereign node any org or person can own," plus the network effects between nodes.

| # | Goal | Where it lives today | Direction |
|---|---|---|---|
| **G1** | **Sovereign infrastructure** — own the compute + data, in the EU, on hardware we control | Supabase/Vercel/Fly (managed) | → self-host on **Hetzner** ([migration spec](superpowers/specs/2026-07-25-hetzner-sovereign-infra-migration-design.md)) |
| **G2** | **Sovereign identity** — self-owned keys; wallet login as the root of identity | thirdweb smart accounts + soulbound CitizenNFT/AttesterNFT on Gnosis; Semaphore v4 | → passkeys+Safe+own-4337; **SIWE→OIDC ("Röbel ID")**; **eIDAS 2.0 / EUDI** (laddered, not launch-gated); an **anchor-tier Sybil model** — in-person attestation + proof-of-personhood with a **wallet-independent nullifier** — as the admission input |
| **G3** | **Technodemocratic decision-making** — cryptographic, private, verifiable | MACI private voting + OZ Governor + Timelock; Shamir 3-of-5 coordinator | → MACI v3; futarchy/prediction layer as *advisory* input to the binding vote |
| **G4** | **Real-money execution on-chain** — treasury, currency, scoped agent budgets | Safe (Gemeinschaftskasse), Circles "Röbel Münzen", Monerium EURe fiat rail | → Fiscal Constitution modules (50/30/20 splits, epoch dividends, auditable agent budgets) |
| **G5** | **AI that reads across nodes + automates work** — MCP tool bus + AI gateway | Mecky (Claude, tool-using); Röbel MCP; edge-function AI | → sovereignty-tier routing (LiteLLM + **EuroLLM** on EU GPU), governance-controlled data-egress, a **Town Context Graph**, agent-to-agent coordination |
| **G6** | **Sovereign workplace suite with AI agent automation** *(direction set 2026-07-25)* | — | a **cryptographic, AI-agent-automated workspace** (Buzz-model) built on **wallet identity**, with **openDesk tools enabled** — reuse the open office components behind our identity; **ride the EU openDesk wave via OIDC coexistence** *and* **scale worldwide** through a **global-core / regional-adapter** design (the office plane is pluggable: openDesk-federation in the EU, composed components everywhere). Proposal: [`sovereign-workplace-suite-design`](superpowers/specs/2026-07-25-sovereign-workplace-suite-design.md) |
| **G7** | **Forkable protocol** — "deployment #2 is config, not rewrite" | one live deployment | → **Netizen** protocol (NSP-0…6) + node + SDK + cloud; adopt the existing order **one Satzung at a time** (the Decidim path) |

**The loop these pillars form:** sovereign nodes own their data (G1/G2) → AI reads across them and
automates work (G5/G6) → decisions are made technodemocratically (G3) → money executes on-chain
(G4) → metric-based predictions guide the next decision (G3/G5) → the whole thing is forkable so any
community or person can run it (G7).

## People

- **Maintainer:** M. Brych (Röbel-Labs).
- **Active contributor & peer builder:** [GiraeffleAeffle](https://github.com/GiraeffleAeffle) —
  contributes to Roebel-App (maintains a public fork) and independently builds a **sibling sovereign
  civic-tech pilot for another German town** (Gnosis + passkeys + Circles + Noir/Semaphore ZK voting).
  Collaboration is by design **shared data contracts, not shared code** — a licence boundary (their
  project is MIT, Röbel is AGPL-3.0) — with architectural kinship on sovereign identity, benchmarked
  both ways. Onboarding: [CONTRIBUTOR_ONBOARDING.md](CONTRIBUTOR_ONBOARDING.md).

## Standing principles

- **Adopt the rails, build the integration.** Rent credible neutrality (Gnosis, Safe, Circles, MACID,
  openDesk components); build the opinionated glue, specs, and UX.
- **Provider-agnostic seams everywhere** — so US SaaS → EU/self-hosted is config, not rewrite.
- **GDPR/data-minimisation by design** — locality (one node = one community's data controller) is a
  compliance *feature*, not a burden.
- **The forcing function is a real town.** Röbel is the Genesis Node — the living proof, never paused
  to build infrastructure.

---

*Related: [future-research index](future-research/README.md) · [Netizen technical blueprint](superpowers/specs/2026-07-21-netizen-stack-design.md) · [Sovereign-community-OS / openDesk coexistence spec](superpowers/specs/2026-07-05-sovereign-community-os-design.md) · [Business plan](future-research/2026-07-22_NETIZEN_BUSINESS_PLAN.md).*
