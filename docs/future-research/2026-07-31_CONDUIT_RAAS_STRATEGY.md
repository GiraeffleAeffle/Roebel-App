# Conduit.xyz & the RaaS business model — what Netizen Labs should adopt, build, and skip

> **Research session 2026-07-31** (M. Brych with Claude). Question: Röbel/Netizen wants to scale
> globally to all kinds of communities and builders. Conduit.xyz has built a large business selling
> "your own chain in a few clicks" (chains, RPC, sequencers). What should Netizen Labs adopt from
> their business model, and which of the user-named layers — easy chain deployment (OP/Arbitrum/zk,
> public or private), RPC, sequencer, **paymaster**, **contract deployment**, **MACI setup** — should
> Netizen actually provide? Target picture: template selection + a few clicks → a live governance +
> identity + money system for a town, community, or business (the "sovereign Microsoft 365" buyer).
>
> Method: two parallel research passes — (a) full read of the Netizen Labs corpus (netizen_labs repo
> + this repo's strategy docs), (b) fresh web research on Conduit's 2026 product and pricing. This doc
> is the synthesis. Web claims cite sources; Conduit's scale numbers are partly self-reported.

---

## 1. What Conduit actually is in 2026 (verified snapshot)

**Company.** Founded ~2022 (Andrew Huang, ex-Paradigm). ~$44M raised — $7M seed + $37M Series A,
both led/co-led by Paradigm (Series A with Haun, Jun 2024). No token — pure B2B SaaS + revenue
share. Claims: 60+ mainnets, $4B TVL, 3B tx, "55% of chains on Ethereum" (their denominator,
their marketing). SOC 2 Type I; seats on **both** the Optimism and Arbitrum security councils;
HSM-backed rollup keys. (conduit.xyz, /security, /customers)

**Product surface.**
- **Chain Platform**: OP Stack, Arbitrum Orbit, Polygon Agglayer CDK (no native zk-stack — that is
  Caldera/AltLayer territory). Settlement on Ethereum L1, Arbitrum One, Base, or custom. DA menu:
  Ethereum blobs, AnyTrust, Celestia, EigenDA, OP Plasma. Self-serve dashboard; **testnet deploys in
  ~15 minutes, no code**. Mainnet is white-glove at current price points.
- **Sequencer ladder G1/G2/G3**: G2 (Oct 2024) 50–100 Mgas/s; **G3 (Mar 2026)**: 3 Ggas/s, 10k TPS,
  ~10ms latency, built on Reth + Flashblocks, marketed as "the Money Upgrade" for payments/RWA.
  **Conduit Elector**: 3-sequencer HA with leader election, 99.95%+ SLA. **Conduit Stack**
  (Jun 2026): their own OP-compatible framework — after 4 years operating others' stacks.
- **RPC Nodes**: standalone multi-chain RPC line (customers: Coinbase Wallet, OpenSea, Chainlink,
  Dune, TRM…).
- **Account Abstraction (2025)**: in-house bundler + paymaster, sponsorship policies, pay-gas-in-any-
  token, session keys — **sold standalone, works on any rollup, not just Conduit chains**.
- **Indexing** (via Index Supply), **Privacy Suite** (private DA, zk proving via Boundless/Succinct,
  permissioning — institutions), **Professional Services** (embedded teams, migrations).
- **Marketplace**: ~100 partners / 450+ installs — bridges (Superbridge), onboarding (Privy, Magic),
  oracles (Chainlink, Pyth), indexers (Goldsky, The Graph), dev tools (thirdweb, Tenderly). Block
  explorer + bridge UI ship with every chain.

**Pricing (current page).** Trial testnet **$250/mo**. Growth **$60,000/yr + 5% sequencer *profit*
share** (profit = net of L1/DA posting costs — DA is effectively borne by the chain's own fee
revenue). Pro/Enterprise custom + 5%, gated by sequencer tier (G2/G3). Adjacent lines priced
separately (RPC $50/mo+, Indexing $250–500/mo). **History matters**: 2023-era reporting had mainnet
at ~$3k/mo + 7.5% — they started cheap to land lighthouses, then moved radically upmarket as
references accumulated, while *cutting* the take rate 7.5%→5%.

**Flagship credential: migrations.** Led **Ronin's** conversion from independent sidechain to OP
Stack Ethereum L2 (completed May 2026, "largest chain migration to date"); won **Plume** off
Caldera; operates **Polygon Katana** (Polygon outsourced its own chain ops); infra partner for
Stripe/Paradigm's **Tempo** payments chain.

**What Conduit does NOT do** — the strategic negative space:
- **No identity products** (no personhood, membership, KYC).
- **No governance tooling** (no voting, no DAO frameworks — nothing).
- **No app layer / templates** — no community, social, workspace products of any kind.
- **No non-crypto-native onboarding** — the buyer is a funded team that already wants a chain;
  enterprise reach is white-glove consulting, not product.

**Ethereum Economic Zone**: no Conduit involvement found. The EEZ is a separate
Gnosis / Zisk / Ethereum Foundation initiative (eez.io, introduced around EthCC 2026). See §5.

---

## 2. The structural rhyme — Conduit and Netizen are the same business shape, one layer apart

| Conduit | Netizen (existing corpus) |
|---|---|
| Declarative chain config in a dashboard | **NSP-0 Node Manifest** — one signed JSON = a whole node |
| "Testnet in 15 minutes, no code" | `netizen render \| doctor \| up` |
| Managed sequencer/proposer/batcher ops | Netizen Cloud managed node ops; Shamir coordinator ops |
| Base fee + 5% sequencer profit share | Hosting tiers + per-tally fees + Fördermittel success fee (+ H3 thin protocol fee) |
| Block explorer ships with every chain | **Atlas** — per-node explorer, conformance test |
| Marketplace of 100 partners | Manifest modules as the SKU list ("the product catalogue and the technical spec are the same artifact") |
| Ronin migration as the trust credential | **EXPORT_AND_RELAUNCH** — 5-check portability, executed against the live node 2026-07-29 |
| No token; open stacks, paid ops | Open-core AGPL; "we sell convenience, integration, operations, and accountability — never lock-in" |

Conduit sells *"your own chain without hiring a protocol team."* Netizen sells *"your own
institutions without hiring an IT + legal + crypto team."* Conduit proves this shape sustains a
$44M-funded company with 60+ production deployments and **no token** — strong external validation
of the Netizen Cloud model. And the two companies' gap maps are **perfect complements**: everything
Conduit refuses to build (identity, governance, app layer, non-crypto buyers) is Netizen's product;
everything Netizen's blueprint rejected (own chain, sequencer ops) is Conduit's product.

---

## 3. Verdict per layer (the user's list, triaged)

### 3.1 Own chain / sequencer offering — **NO. Reaffirmed, now with market evidence.**

The 2026-07-21 blueprint already rejected "Netizen Chain" (ops burden, fragments Circles liquidity
off Gnosis, rebuilds neutrality we get free) and kept it reversible via the manifest's `chain`
block. The Conduit research adds three harder reasons:

1. **The economics are absurd for this customer.** Conduit's entry mainnet tier is $60k/yr + 5%.
   Röbel's *entire* civic stack — 18 containers — runs on an €82/mo Hetzner box at 2.1 GiB RAM and
   ~0% CPU. A town's digital civic life does not fill one block. Communities need *shared* rails
   with strong isolation (per-node paymasters, per-node relays), not dedicated chains.
2. **It is an arms race between funded specialists.** G3 does 3 Ggas/s on Reth + Flashblocks;
   Caldera, AltLayer, Gelato are all competing that race down. Entering as a one-person company is
   not a strategy.
3. **Conduit's own graduation pattern says: operate first, own the stack later, maybe.** They
   shipped their own OP-compatible stack only in Jun 2026, after 60 mainnets. Netizen's analog
   milestone is dozens of *nodes* — not now.

**What to do instead — the "bring-your-own-rollup" posture.** When a customer genuinely outgrows
shared Gnosis (a city, a large enterprise, a country program), the play is: a RaaS partner
(Conduit/Gelato-class) deploys the OP-Stack chain; the Netizen manifest's `chain.chainId` points at
it; the entire Netizen layer (identity, governance, treasury, paymaster, workspace, AI) runs on
top. Netizen takes the integration + civic-ops margin (S1 + Institution tier); the RaaS takes the
sequencer margin. Zero new fields needed — the manifest is already chain-declarative. The inverse
also holds: **Conduit's marketplace lists thirdweb and Privy for onboarding, and the
identity/governance slot is empty.** Getting the Netizen stack listed as *the* governance+identity
partner in RaaS marketplaces is a distribution channel, not a build.

### 3.2 RPC — **build resilience, not a business.**

Conduit's RPC line serves Coinbase Wallet and OpenSea; that is a scale business Netizen cannot and
need not enter. But the corpus already flags the real gap: `GNOSIS_RPC` is one un-abstracted URL in
the manifest (`manifest.ts` models `chain` as `{chainId, rpc}` — no fallback list), the "never
trust one RPC" lesson was written down in June and never implemented in the packages, and Atlas
does chain reads through public Gnosis RPCs. Scope: (a) `chain.rpc` becomes an ordered list with
rotation in `@netizen-labs/*`, (b) Netizen Cloud runs one shared managed RPC rail for its nodes
(the bundler design already establishes the shared-rail-with-per-node-isolation pattern), (c) stop.

### 3.3 Paymaster — **BUILD. Already designed; Conduit just validated it as a standalone product.**

Conduit's 2025 AA launch (bundler + paymaster, sold separately, "works on any rollup") proves
paymasters are a product line, not just plumbing. Netizen's version is already specified in
`2026-07-31-netizen-accounts-service-design.md` and is *differentiated*, not generic: sponsorship
vouchers signed by the node's keystone, eligibility = membership NFT or declared agent, per-identity
rate limits + per-node daily caps that **fail closed**, funded from that node's own treasury Safe.
"The paymaster contract is easy; **the policy is the product**." No RaaS ships governance-gated gas
tied to civic identity and agent charters — this is the moat-shaped piece of the accounts service.
Conduit's precedent also settles an open posture question: like their AA, **Netizen accounts should
work for any community, not only Netizen Cloud nodes** (consistent with the client invariant).
Blockers already on file: canonical EntryPoint v0.7/0.8 addresses + paymaster audit status on
Gnosis (unverified, twice), and M2's "daily cap fails closed under load" gate.

### 3.4 Contract deployment — **BUILD. This is the single Conduit-shaped hole in the stack.**

The strongest structural finding of this session: **the manifest is fully declarative except for
contracts.** `netizen render` only *reads* `m.contracts` to write env vars; the contracts
themselves are deployed by hand with Hardhat runbooks. Everything else in a node is "a manifest
edit followed by `netizen up`" — contracts are the one layer where Röbel is still artisanal. That
is exactly the gap Conduit closed for chains ("configure → 15 minutes → live testnet").

The design already exists and was never built (`NETIZEN_STACK_ARCHITECTURE_PLAN.md`, 2026-06-12):
- **`TenantFactory`** — deterministic CREATE2 deployment of the full civic set (membership NFTs,
  MACI, Governor, Timelock, Safe wiring, and now: paymaster) from `tenantId`-derived salts, with
  explorer verification. "MACI deployment is too heavy for one tx" — a guided script, not a
  factory contract. Old target: one CLI command, ~15 minutes, ~$20 gas.
- **`CommunityRegistry`** (one per chain) — `tenantId → {full address set, metadataURI}` so every
  client, indexer, and agent resolves a deployment from one onchain read. This simultaneously
  answers the standing NSP open question "how does a node announce itself without a central
  registry" (roadmap #6 — `peers` is "already shaped for a contract to populate it").
- **Manifest presets = Conduit's chain templates**: `town`, `verein`, `genossenschaft`, `company`.
  A preset is a partial manifest (governance weights, admission policy, treasury split, module
  set). Template selection + a few clicks is then literal: pick preset → factory deploys →
  **addresses are written INTO the manifest as output, not typed in as input** → `netizen up`.

This closes the loop the Cloud spec wants ("adding a module = a manifest edit… no sales
engineering") and is the pulled-forward Phase 3 of the blueprint, whose exit test is already
written: *"A new community deploys its full contract set in one guided flow."*

### 3.5 MACI setup — **BUILD as coordinator-as-a-service. This is Netizen's sequencer.**

The analogy is nearly exact: the sequencer is the specialized, ops-heavy, trust-critical shared
infrastructure Conduit runs so customers don't have to; the **Shamir 3-of-5 MACI coordinator** is
the same thing for verified-member governance — and the corpus already claims it as unique IP
("every other MACI deployment on earth has the single-coordinator-key problem this repo already
solved"). Business plan P3 already prices it (€99–299/mo + per-tally). What Conduit adds:
- **Tier it like G1/G2/G3.** Shared coordinator across small nodes (the pragmatic option in open
  decision #5) = the entry tier; dedicated per-node Shamir federation = the institutional tier.
  The tier ladder resolves the shared-vs-per-node decision by making it a price point instead of a
  philosophy.
- **Prerequisites are already identified**, unchanged: the MACI v3 question (v3 would eliminate
  the deploy-per-vote pattern; unverified whether v3 tooling accepts an externally reconstructed
  Shamir key), and the coordinator re-architecture off the "one pet Fly machine, state in RAM,
  deploys kill live tallies."
- The factory (§3.4) must treat MACI as a first-class template component — poll gatekeeping bound
  to the freshly deployed membership NFT.

### 3.6 The console — **the reserved `apps/console` is the Conduit dashboard.**

Configure (preset + manifest editor) → deploy (factory + `render/up` + `netizen dns`) → operate
(coordinator sessions, paymaster budgets, backups) → observe (Atlas is already the public half —
Conduit ships an explorer with every chain; Atlas-per-node is that, and it's built). The console is
the last piece, not the first: it becomes real once factory, paymaster, DNS, and provisioning API
exist under it.

---

## 4. Business-model adoptions (shape, not prices)

1. **Base fee + aligned share.** Conduit's $60k + 5%-of-*profit* structure aligns them with chain
   success while passing DA costs through. Netizen's analog is already ranked in the business plan
   ("recurring hosting → success-fee AI → treasury/governance SaaS → services → thin H3 protocol
   fee"). Do **not** invent a %-of-treasury fee now — town treasuries are not fee revenue; the
   aligned-upside instruments are per-tally fees and the Fördermittel success fee.
2. **Self-serve funnel below, white-glove above.** Free self-host (already strategy: "the exit
   guarantee that makes the paid tier trustworthy") + cheap sandbox tier ↔ Conduit's $250 testnet;
   managed tiers in the middle; Institution tier = professional-services motion (Conduit added
   embedded teams in 2026 — that is where Kommune/procurement revenue lives, matching S1).
3. **Reprice upward from references, not upfront.** Conduit went $3k/mo+7.5% → $60k/yr+5% in three
   years. The two unreconciled Netizen pricing sketches (€199–499 vs €99/€299/€900+) should be
   reconciled *after* customer #2 exists, and low — early customers are bought references.
4. **Marketplace = the manifest module ecosystem.** Third parties shipping manifest modules is the
   450-integrations analog; NSP conformance (Atlas `/conformance`) is the listing bar. Plus the
   outbound version: Netizen as the governance/identity listing in *others'* marketplaces (§3.1).
5. **Migrations as the credential.** Ronin is Conduit's proof they can move a living network
   without dropping it; **EXPORT_AND_RELAUNCH is already Netizen's Ronin** — executed against the
   live node, five checks, independent re-implementation. Productize it: "move your community in —
   and the tested proof you can move out."
6. **Sell audits, not vibes.** Conduit leads enterprise pages with SOC 2, security-council seats,
   HSMs, uptime history. Netizen's ladder: DPIA (shipped), threat model (roadmap #15 — still
   unwritten), `ops/status.json` → public uptime page, later ISO 27001/BSI-Grundschutz for
   procurement. Infrastructure buyers buy evidence.
7. **No token.** Conduit vs tokenized competitors (Caldera $ERA, AltLayer ALT) validates the
   existing stance.

---

## 5. The Ethereum Economic Zone / settlement question

The EEZ is a **Gnosis / Zisk / Ethereum Foundation** initiative (eez.io) — and Netizen is already
on Gnosis, i.e. already inside the EEZ's home orbit. "Ethereum is where everything settles" arrives
for Netizen through Gnosis's own trajectory plus the manifest's chain-agnosticism — **not through
Netizen building settlement infrastructure**. Concretely: (a) `chainId` stays declarative (done);
(b) the bring-your-own-rollup posture (§3.1) covers the customer who needs an Ethereum-settled
dedicated chain; (c) watch EEZ for a public-sector-grade shared chain — if one emerges, joining it
is a manifest change plus a migration ceremony, which is precisely the reversibility the blueprint
engineered. One standing constraint keeps its veto: **Circles must live on Gnosis** — any chain
story that fragments Münzen liquidity is a regression.

---

## 6. Sequenced deltas to the existing roadmap (one person; sequencing over parallelism)

Nothing here displaces the standing gate — **node #2 must be a stranger's node** — or the accounts
milestones already committed. The Conduit findings re-order and sharpen, they don't rewrite:

1. **Accounts M1/M2 (bundler + paymaster)** — unchanged, now doubly justified (§3.3). Resolve the
   EntryPoint/paymaster-audit unknowns on Gnosis first, as already flagged.
2. **Pull blueprint Phase 3 forward: TenantFactory + CommunityRegistry + manifest presets** (§3.4).
   Highest-leverage single build in this doc; converts "one-click governance + identity" from
   vision to demo. Exit test already written.
3. **DNS automation + provisioning API** (roadmap item B + Cloud P1) — the remaining non-declarative
   steps around the factory; "a node from zero without a human."
4. **MACI v3 investigation → coordinator re-architecture → coordinator-as-a-service tiers** (§3.5).
5. **RPC fallback rotation in packages + one shared rail** (§3.2) — small, slot alongside.
6. **`apps/console`** once 1–4 exist (§3.6).
7. **Not on the list**: sequencers, own chain, an RPC business, zk proving infrastructure.

## 7. Open questions carried forward

- ~~MACI v3: audit status + does the tooling accept an externally reconstructed (Shamir)
  coordinator key?~~ **Answered 2026-07-31** — see
  [`2026-07-31_MACI_V3_MIGRATION_DECISION.md`](2026-07-31_MACI_V3_MIGRATION_DECISION.md): yes on
  both (HashCloak audit; `generateProofs -k` keeps the pass-the-key flow), verdict is still
  **stay on v2.5** (orphaned 6-week-old release, zero production users, full-rebuild cost); note
  §3.5's "v3 eliminates deploy-per-vote" premise is refuted there.
- EntryPoint v0.7/0.8 canonical addresses + verifying-paymaster audit status on Gnosis (blocks M2).
- Factory chain scope: deploy templates on Gnosis only at first, or design salts/registry to be
  chain-portable from day one? (Recommendation: chain-portable salts, Gnosis-only execution.)
- Which RaaS partner for the bring-your-own-rollup tier, and what does the referral/integration
  economics look like? (No urgency until an Institution-tier customer asks.)
- Whether the CommunityRegistry doubles as the NSP node-discovery answer or stays contracts-only
  (the Atlas team flagged discovery as belonging "in NSP, not in Atlas").
