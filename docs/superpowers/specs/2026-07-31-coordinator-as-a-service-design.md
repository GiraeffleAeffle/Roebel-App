# Coordinator-as-a-Service — design (decision + sequencing, no code in this tranche)

> 2026-07-31, final tranche of the Conduit-study roadmap
> ([`2026-07-31_CONDUIT_RAAS_STRATEGY.md`](../../future-research/2026-07-31_CONDUIT_RAAS_STRATEGY.md) §3.5:
> "the coordinator is Netizen's sequencer"). This doc RESOLVES blueprint open decision #5
> (shared vs per-node coordinator) and fixes the re-architecture sequence. It deliberately ships
> **no code**: the live Röbel coordinator runs real tallies and gets touched only in a dedicated
> session with `MACI_SHAMIR_OPERATIONS.md` §10 loaded. MACI stays v2.5 per
> [`2026-07-31_MACI_V3_MIGRATION_DECISION.md`](../../future-research/2026-07-31_MACI_V3_MIGRATION_DECISION.md).

## The decision: tiers, not a philosophy

Blueprint open decision #5 asked: *one shared coordinator for all early nodes (pragmatic,
centralizing) or per-node from the start (pure, heavy)?* Conduit's G1/G2/G3 ladder shows the
answer is a **price point, not a principle** — both, tiered by what a community's stakes justify:

| | **Tier S — shared** (entry) | **Tier D — dedicated Shamir** (institutional) |
|---|---|---|
| Preset mapping | `verein` (`coordinator: "single"`), `company` | `town`, `genossenschaft` (`coordinator: "shamir"`) |
| Key custody | The service holds the community's coordinator key (custodial single-key — acceptable at Verein stakes, said out loud in the contract) | The community's OWN attesters hold 3-of-5 shares; the service orchestrates sessions + proofs but **can never decrypt alone** — Röbel's live model, productized |
| Ceremony | none (keygen at onboarding) | share ceremony at onboarding (the existing runbook, generalized) |
| Price shape (business plan P3) | low end of €99–299/mo + per-tally fee | high end + ceremony setup fee |
| Isolation | per-community keypair; one community's polls never touch another's key | structural (shares live with the community) |

One fleet serves both tiers — the difference is solely where the reconstruction input comes from
(service-held key vs. attester share submissions). Röbel itself stays Tier D on its own terms
(customer zero, nothing sold).

## Why the re-architecture is the prerequisite

The current coordinator cannot serve even a second community: **one pet Fly machine, one session
at a time, session state in RAM + JSON files, deploys kill live tallies** (architecture plan L3),
plus two known staleness bugs (`Dockerfile` sets `HARDHAT_NETWORK=base`; `hardhat.config.js`
defines only a `base` network — the stack votes on Gnosis).

## Target architecture (v2.5, multi-tenant)

1. **Session state → Postgres.** Tally sessions, share submissions, key generations, audit log —
   all keyed by **`communityId`, the CommunityRegistry id**. Kills the orphan-session race and
   deploy-kills-tally at the root.
2. **Tenant resolution → the CommunityRegistry** (`0x1c4B…F889` on Gnosis). The coordinator
   resolves a community's MACI/Governor/Tally addresses from one onchain read — the
   chain-as-config rule; no per-tenant env vars, no address drift.
3. **Ephemeral tally workers.** A session spawns a worker (Fly machine / container) that lives
   for the session, streams stage progress to Postgres, and dies. Reconstructed keys exist only
   in worker RAM (unchanged invariant: ~10 minutes, zeroed after) — a deploy of the control
   plane can never kill a running tally again.
4. **Proof artifacts → object storage**, keyed by community + poll (audit trail survives worker
   death; `verify` re-runs from artifacts).
5. **The maci surface stays one module.** `finalize-helpers.js` remains the only importer of
   `maci-cli` — the v3 swap seam the migration decision requires.
6. **zkeys from our own mirror** (see the artifact-mirror change shipped alongside this doc) —
   a coordinator fleet cannot depend on a disbanded team's S3 bucket.

## Sequencing (each step ships alone; Röbel never pauses)

0. Fix the stale `base` network config (10-minute change, standing bug, do first).
1. Postgres session state behind the existing HTTP surface (no behavior change; the JSON/RAM
   path becomes a fallback, then dies).
2. `communityId` on every table + registry-based tenant resolution (Röbel = first tenant,
   resolved from its own registry entry).
3. Worker extraction (the reconstructor child process becomes the worker — it is already
   process-shaped; this step moves it out of the pet machine).
4. Tier S keygen + custody module (new capability, sold only after 0–3 are boring).
5. Onboard community #2 — which, per the standing gate, should be a stranger's community.

## Explicitly out of scope

MACI v3 (triggers in the decision doc govern), threshold decryption that never reconstructs the
key (the runbook's "Layer 3" — post-v3-ceremony territory), coordinator federation across
nodes, and any change to Röbel's live 3-of-5 ceremony or share keys (the share-key
re-registration constraint stands: signer changes need a ceremony first).
