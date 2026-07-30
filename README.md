<img width="1229" height="686" alt="1777224343114-28ylktjcd91 1 (1)" src="https://github.com/user-attachments/assets/aa398c24-560f-472c-af59-d2c906780fdf" />

# Roebel App

Open-source civic technology platform for Roebel/Mueritz, Mecklenburg-Vorpommern, Germany — a replicable blueprint for small towns building digital civic infrastructure.

Verified residents get a soulbound **civic ID**, vote on local proposals with **encrypted MACI ballots**, and transact in **Röbel Münzen**, the town's own [Circles](https://aboutcircles.com) group currency. The whole stack — identity, private voting, and money — runs natively on **Gnosis Chain**.

Since July 2026 the town also runs its own **sovereign node**: a machine in Germany hosting the workspace, chat, a members-only [Nostr](https://nostr.com) relay and a public index, federating with other nodes over an open protocol. Röbel is **Genesis Node #1** of the [Netizen](#the-sovereign-node--netizen-genesis-node-1) stack — the forkable generalisation of this repo.

> 🎯 **Mission & Goals:** [docs/MISSION_AND_GOALS.md](docs/MISSION_AND_GOALS.md) — sovereign blockchain × AI infrastructure for coordination, and the 7 goals (sovereign infra, identity, technodemocratic decisions, on-chain money, cross-node AI automation, a sovereign workplace suite, and a forkable protocol) it decomposes into.

## What's Inside

This [Turborepo](https://turbo.build/repo) monorepo contains:

### Apps

| App | Description | Stack |
|-----|-------------|-------|
| **[apps/web](apps/web/)** | Roebel Website + admin dashboards (proposals, verification, treasury, Münzen tokenomics) | Next.js 15, Tailwind CSS, thirdweb v5 |
| **[apps/expo](apps/expo/)** | Roebel Mobile App (iOS + Android) — voting, verification, Röbel Münzen wallet, Mecky AI | Expo SDK 55, React Native, thirdweb v5 |
| **[apps/roebel-id](apps/roebel-id/)** | **Röbel ID** — the town's own OIDC provider, bridging a wallet to Nextcloud, Matrix and the web app | panva `oidc-provider`, Fly.io |
| **[apps/coordinator](apps/coordinator/)** | MACI tally coordinator — Shamir share reconstruction, proof generation, on-chain submission | Node, snarkjs, Fly.io |
| **[apps/mini-apps](apps/mini-apps/)** | Mini-apps embedded in the mobile app (e.g. `roebel-data`) | Next.js |
| **[circles-roebel-mini-app](circles-roebel-mini-app/)** | Standalone Circles mini-app ("Röbel Circles") — trust graph, transfers, invites (runs inside the Circles host) | Vite, React 19, Tailwind 4 |

### Packages

Röbel-specific packages:

| Package | Description |
|---------|-------------|
| **[packages/config](packages/config/)** | Shared ESLint and TypeScript configs |
| **[packages/blockchain](packages/blockchain/)** | Contract ABIs, addresses, thirdweb utilities — **canonical address source of truth** |
| **[packages/design-tokens](packages/design-tokens/)** | Shared colors, spacing, typography tokens |

**Netizen packages** — the town-agnostic half, developed here against a live town and extracted
into the [Netizen](#the-sovereign-node--netizen-genesis-node-1) project. Nothing in them knows
the word "Röbel":

| Package | Description |
|---------|-------------|
| **[packages/protocol](packages/protocol/)** | The **Node Manifest** (NSP-0) and the rest of the NSP specs as zod schemas — one JSON document describes a whole node |
| **[packages/cli](packages/cli/)** | `netizen render \| doctor \| up` — turns a manifest into a deployable bundle, then onto a machine |
| **[packages/nostr](packages/nostr/)** | Wallet-derived Nostr identity, NIP-01 events, wallet↔npub binding proofs, agent + organisation keys, NIP-52 calendars |
| **[packages/relay-sync](packages/relay-sync/)** | On-chain membership → relay write access, **fail-closed** |
| **[packages/indexer](packages/indexer/)** | Cross-node query layer — search, provenance, proof lookup |
| **[packages/agent-watcher](packages/agent-watcher/)** | A node's AI agent answers when mentioned, under explicit bounds |
| **[packages/workspace](packages/workspace/)** | Scope guard + Nextcloud WebDAV/OCS client for the sovereign workspace |
| **[packages/miniapp-sdk](packages/miniapp-sdk/)** | Client + host bridge for embedding mini-apps |

### Smart Contracts

| Contract | Description |
|----------|-------------|
| **[contracts/governor-contract](contracts/governor-contract/)** | Hardhat smart contracts (OpenZeppelin v5) — identity NFTs, MACI-aware Governor, Timelock, Circles membership condition |

See [Smart Contracts & Governance](#smart-contracts--governance) below for the full on-chain architecture, deployed addresses, and voting rules.

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) v20+
- [pnpm](https://pnpm.io/) v9+
- [Expo CLI](https://docs.expo.dev/get-started/installation/) (for the mobile app)

### Setup

```bash
# Clone the repo
git clone https://github.com/Roebel-Labs/Roebel-App.git
cd Roebel-App

# Install the complete workspace (web, mobile, mini-apps, and contracts)
pnpm install

# Copy environment variables
cp apps/web/.env.example apps/web/.env.local
cp apps/expo/.env.example apps/expo/.env

# Fill in your API keys in the .env files, then:

# Start web app
pnpm dev:web

# Start mobile app
pnpm dev:expo
```

A complete install includes the Next.js app, Expo/React Native, mini-apps, and
the smart-contract toolchain. If you only need one app, install its dependency
graph instead:

```bash
pnpm install --filter @roebel/web...
pnpm install --filter @roebel/expo...
```

### Testing against staging

You don't need to provision anything to contribute — there's a **shared staging
environment**. Open **[stage.roebel.app](https://stage.roebel.app)** to click
through the app with zero setup, or run the app locally against the staging backend
with just the staging Supabase URL + anon key (both safe to share). Full instructions:
**[docs/FORKING_GUIDE.md](docs/FORKING_GUIDE.md)**. Maintainers provisioning staging:
**[docs/STAGING_ENVIRONMENT.md](docs/STAGING_ENVIRONMENT.md)**.

## Architecture

- **Chain**: **Gnosis Mainnet (chain id 100)** + Thirdweb Smart Wallets — invisible Web3, gasless ERC-4337 (users never see a wallet or pay gas). Identity, governance, and currency all live on one chain.
- **Identity**: Two soulbound NFTs — `AttesterNFTv2` (culture committee) and `CitizenNFTv2` (verified residents) — with **scale-aware, Sybil-hardened signature thresholds**.
- **Governance**: **MACI v2** privacy-preserving voting. Attesters propose; Citizens vote with **encrypted ballots**. An off-chain coordinator (whose decryption key is **Shamir 3-of-5-split across Attesters**) tallies them and posts a Groth16 ZK proof on chain. Proposals execute through a Timelock.
- **Currency**: **Röbel Münzen** — a collateral-backed [Circles v2](https://aboutcircles.com) group currency, gated on the CitizenNFT, adding an economic Sybil cost and a transparent on-chain trust graph.
- **Backend**: Supabase (Postgres, Auth, Realtime, Edge Functions).
- **AI**: Claude API powering the Mecky chatbot assistant (German language).
- **Sovereign node**: a community-owned machine in Germany running the workspace (Nextcloud + Collabora), chat (Matrix), a members-only Nostr relay, a federation mirror and a public index — declared in a single manifest and installable with one command.
- **Public record**: citizens hold their own Nostr key, derived from their wallet, and publish signed posts to the town's relay. A public index makes that record queryable by anyone, including other nodes.

> 📘 **MACI deep-dive:** [docs/MACI_E_GOVERNANCE.md](docs/MACI_E_GOVERNANCE.md) explains the privacy layer end-to-end (identity → Governor → MACI core/Poll/MessageProcessor/Tally/VkRegistry → coordinator → apps), the ceremony zKey parameters, the operational runbook, and the security model. *Note: that doc predates the Gnosis move and still cites Base addresses for the mechanism walkthrough — the current live addresses are in this README and in the deployment manifest below.*
>
> 🛡️ **V2 Sybil-hardening design:** [docs/superpowers/plans/2026-06-24-gnosis-consolidation-and-sybil-hardening.md](docs/superpowers/plans/2026-06-24-gnosis-consolidation-and-sybil-hardening.md) — the threshold model, migration plan, and the Self.xyz Phase-2 roadmap.
>
> 🪙 **Circles / Röbel Münzen:** [docs/CIRCLES_ROEBEL_MUENZEN_STATE.md](docs/CIRCLES_ROEBEL_MUENZEN_STATE.md) and [docs/CIRCLES_TOKENOMICS.md](docs/CIRCLES_TOKENOMICS.md).
>
> 🔐 **Coordinator privacy federation:** [docs/SHAMIR_CEREMONY.md](docs/SHAMIR_CEREMONY.md) (concept) and [docs/MACI_SHAMIR_OPERATIONS.md](docs/MACI_SHAMIR_OPERATIONS.md) (runbook).

---

## The sovereign node — Netizen Genesis Node #1

A chain gives a town identity, votes and money. It does not give it a place to keep documents,
hold a conversation, or publish a record it still controls next decade. Since **2026-07-21**
Röbel runs its own machine for that: a Hetzner box in Falkenstein, EU-resident, owned by the
community rather than rented per-seat from a platform.

The node is not configured by hand. It is declared in **one JSON manifest**
([`packages/protocol/examples/roebel.netizen.json`](packages/protocol/examples/roebel.netizen.json))
and installed with the CLI:

```bash
netizen render roebel.netizen.json   # manifest -> deployable bundle
netizen doctor                       # check the declaration against reality
netizen up --host                    # ship it, idempotently
```

Anything running on the box but *not* in the manifest is drift: it will not survive a rebuild
and will not exist on a fork. That rule is what makes this repo a blueprint instead of a
souvenir.

### What it serves

| Endpoint | What it is |
|---|---|
| `wss://relay.roebel.app` | The town's **authoring relay** — members-only writes |
| `https://index.roebel.app` | **Public, unauthenticated** cross-node query API over the civic record |
| `https://cloud.roebel.app` | Nextcloud + Collabora — files and collaborative documents |
| `https://chat.roebel.app` | Element / Matrix |
| `https://id.roebel.app` | **Röbel ID**, the town's OIDC provider (hosted on Fly, deliberately not on the box) |

### Identity on the public record

A Nostr key is a secp256k1 Schnorr key; an Ethereum address is not one, and an ERC-4337 smart
account has no private key at all. So a citizen's Nostr identity is **derived from a signature
their own wallet produces** over a fixed message — deterministic in, deterministic out, so the
same wallet reproduces the same `npub` on any device after any reinstall.

The consequences are the point:

- **The key never touches the node.** It is derived on the phone and stays there. The node
  cannot post as a citizen, and cannot lose their identity for them.
- **The identity is node-independent.** The derivation message contains no town name, so one
  wallet has one Nostr identity across every Netizen node — which is what federation needs.
- **Write access is on-chain membership.** A syncer reads `CitizenNFTv2` holders, verifies each
  wallet↔npub binding proof, and regenerates the relay's allow-list. It is **fail-closed**: if
  the RPC or the registry errors, the allow-list is left untouched, because a stale allow-list
  is a far better failure than an empty one.

Every post carries a **proof link** in the app: tap it and you get the raw signed event —
pubkey, signature, timestamp — served by the public index. Not a screenshot of a claim, the
claim itself.

### Federation

The node runs *two* relays: the members-only one it authors into, and a **read-only mirror**
that pulls declared peers over [NIP-77](https://github.com/nostr-protocol/nips/blob/master/77.md)
negentropy set reconciliation. Peers are declared in the manifest with a required `why` field,
so every trust decision between towns is reviewable in a git diff.

> **Honest limit: n = 2, and both nodes are on one box.** Federation is proven as a *protocol*,
> not as a *network*. The concentration ratio stays 1 until an independent operator runs one.

### Agents on the record

Mecky, the town's AI assistant, has its own Nostr identity and answers when mentioned. Every
machine-authored event carries NIP-24 `bot: true` and an agent tag, because an unlabelled agent
in a civic feed is indistinguishable from a resident — and that is the failure mode that erodes
trust in the whole record. The watcher refuses to answer on explicit bounds: kill switch,
already-answered, self, other agents, per-author rate limit, daily cap.

### Portability, tested rather than promised

Sovereignty that has never been exercised is a hope. On **2026-07-29** the full export path was
run against the live node: a clean-room stack was rebuilt from backup output alone and passed
every check — the relay served the same events, the allow-list regenerated from chain into a
byte-identical key set, federation reconverged from peers, and **a proof link created before the
move still resolved** through the rebuilt index.

The node's agent identity was re-derived from the escrowed node secret by a script sharing no
code with our libraries, and matched exactly. That last point is what makes leaving a host
non-lossy, and it is why that secret belongs with the community and not with an operator.

Roughly half a node is **derived** and needs no backup at all: the federation mirror re-syncs
from peers, the index re-reads the relays, TLS certificates re-issue themselves. That is the
practical payoff of treating the protocol as the source of truth — an export is small.

### What is on the public record

Citizen **profiles** and **feed posts** are published opt-in, signed on the citizen's own
device. Since **2026-07-30** the node also mirrors its public datasets onto the relay itself:
**events** and the **cinema programme** as NIP-52 calendar events and **organisation
profiles** as kind 0 — each signed by a node-held per-organisation key, so the cinema's
screenings carry the cinema's signature. Any standard Nostr client can render the town
calendar; anyone can build a full rival client from the public index alone
([docs/PUBLIC_DATA_ON_NOSTR.md](docs/PUBLIC_DATA_ON_NOSTR.md)).

Not on the record: the marketplace (deliberately last — the withdrawal path gets tested before
the publish path), events hosted by private individuals (needs per-person opt-in), and private
data — messages, evidence, PII — which is **never** destined for the relay; see
[docs/DATA_PLACEMENT_AND_CRUD.md](docs/DATA_PLACEMENT_AND_CRUD.md) for the rule and
[docs/DSGVO_AI_ACT_COMPLIANCE.md](docs/DSGVO_AI_ACT_COMPLIANCE.md) for the GDPR duties that
shape it.

> 📗 **Node docs:** [State of the Netizen Stack](docs/STATE_OF_THE_NETIZEN_STACK.md) ·
> [State of the Netizen Node](docs/STATE_OF_THE_NETIZEN_NODE.md) ·
> [State of Nostr](docs/STATE_OF_NOSTR.md) ·
> [Key governance](docs/KEY_GOVERNANCE.md) ·
> [Roadmap and deferred work](docs/ROADMAP_AND_DEFERRED.md)

---

## Smart Contracts & Governance

The Röbel stack runs on **Gnosis Mainnet (chain id 100)** — a full consolidation from Base completed **2026-06-25** (the "v2 Sybil-hardened" rotation). Identity NFTs are soulbound/non-transferable, voting is privacy-preserving via [MACI v2](https://maci.pse.dev), and the town currency is a Circles v2 group. The old Base stack is archived on chain and in the manifests for historical lookups only.

### Live addresses (Gnosis, v2)

#### Identity

| Contract | Address | Purpose |
|---|---|---|
| **AttesterNFTv2** | [`0xC587F383696D3c9DF7A6eE03A9160E40Ae1cdb82`](https://gnosisscan.io/address/0xC587F383696D3c9DF7A6eE03A9160E40Ae1cdb82) | Soulbound NFT for "culture committee" members. Only holders can *propose* in the DAO and co-sign attestations. Scale-aware thresholds. Owned by the Attester Safe. |
| **CitizenNFTv2** | [`0x59aA26f499D7C2B3EC2c8524Ed06F54fc4E85dE5`](https://gnosisscan.io/address/0x59aA26f499D7C2B3EC2c8524Ed06F54fc4E85dE5) | Soulbound ERC721Votes NFT for verified residents. Gates MACI signup (1 NFT = 1 vote) *and* Circles group membership. Scale-aware thresholds + `validUntil` dormancy. |

#### Governance (MACI v2 privacy voting)

| Contract | Address | Purpose |
|---|---|---|
| **MaciAttesterGovernor** | [`0x5F5e499Dc1872c2Ce19a4b50cd10f680e78E3Ba3`](https://gnosisscan.io/address/0x5F5e499Dc1872c2Ce19a4b50cd10f680e78E3Ba3) | OZ Governor + MACI-aware `state()`. Attesters propose, Citizens vote via encrypted MACI ballots, the coordinator submits a ZK tally proof, proposals execute through the Timelock. Quorum/coordinator are governance-mutable. |
| **TimelockController** | [`0x5b358A77E89FF3d699607b4fC235b381d67f3d05`](https://gnosisscan.io/address/0x5b358A77E89FF3d699607b4fC235b381d67f3d05) | OZ `TimelockController`, `minDelay = 3600` (1h) for the pilot. Raise via a `timelock.updateDelay()` governance proposal. |

#### MACI v2 infrastructure

| Contract | Address | Purpose |
|---|---|---|
| **MACI core** | [`0x6663eDC8650276fe264710B1A2ba46eB8bd0bF1D`](https://gnosisscan.io/address/0x6663eDC8650276fe264710B1A2ba46eB8bd0bF1D) | Global signup pool + `deployPoll` factory (deploy block `46867803`). |
| **Verifier** | [`0xC95359cF5d7391cD239c9476393706a8132406dc`](https://gnosisscan.io/address/0xC95359cF5d7391cD239c9476393706a8132406dc) | Groth16 proof verifier. |
| **VkRegistry** | [`0xB21EAA60DF62b7cf06Eb0a2554D9C4e6BA76658f`](https://gnosisscan.io/address/0xB21EAA60DF62b7cf06Eb0a2554D9C4e6BA76658f) | Stores process + tally verifying keys keyed by tree depths. |
| **SignUpGatekeeper** | [`0xc4B9E45F0e84BC0CDe930CE888E4D0e38184f277`](https://gnosisscan.io/address/0xc4B9E45F0e84BC0CDe930CE888E4D0e38184f277) | "You can sign up to vote iff you hold a CitizenNFTv2." Bound to the CitizenNFT above. |
| **Coordinator EOA** | [`0x5e6528D22283Daf1E4340B39d48a4D3CeaDC184C`](https://gnosisscan.io/address/0x5e6528D22283Daf1E4340B39d48a4D3CeaDC184C) | Submits on-chain tally proofs. Its **MACI decryption key is Shamir 3-of-5-split** across Attesters (see below). |

#### Currency — Röbel Münzen (Circles v2)

| Contract | Address | Purpose |
|---|---|---|
| **Röbel Münzen group** | [`0xAc2CeCdBead594F97358a0d3132454f24F3E470c`](https://gnosisscan.io/address/0xAc2CeCdBead594F97358a0d3132454f24F3E470c) | Circles v2 `BaseGroup` (symbol `RCRC`), the town's collateral-backed group currency. |
| **Membership condition** | [`0x5850A04544c1882d5958872bdbfC591E94abE67b`](https://gnosisscan.io/address/0x5850A04544c1882d5958872bdbfC591E94abE67b) | `CitizenMembershipCondition` — only `CitizenNFTv2` holders can be trusted into the group. |
| **Attester Safe (owner)** | [`0x3A08c86Efc5ff38CC35d850F1D4d564e497bFDEa`](https://gnosisscan.io/address/0x3A08c86Efc5ff38CC35d850F1D4d564e497bFDEa) | 3-of-5 Attester Gnosis Safe — owns both identity NFTs and the Circles group. |
| **Circles Hub v2** | [`0xc12C1E50ABB450d6205Ea2C3Fa861b3B834d13e8`](https://gnosisscan.io/address/0xc12C1E50ABB450d6205Ea2C3Fa861b3B834d13e8) | The canonical Circles v2 Hub (shared protocol contract). |

Source files: [`AttesterNFTv2.sol`](contracts/governor-contract/contracts/verification-system/AttesterNFTv2.sol), [`CitizenNFTv2.sol`](contracts/governor-contract/contracts/verification-system/CitizenNFTv2.sol), [`ThresholdBands.sol`](contracts/governor-contract/contracts/verification-system/ThresholdBands.sol), [`MaciAttesterGovernor.sol`](contracts/governor-contract/contracts/verification-system/MaciAttesterGovernor.sol), [`CitizenMembershipCondition.sol`](contracts/governor-contract/contracts/verification-system/CitizenMembershipCondition.sol). Address source of truth: [`packages/blockchain/src/index.ts`](packages/blockchain/src/index.ts) and [`deployments/gnosis-v2.json`](contracts/governor-contract/deployments/gnosis-v2.json).

### Sybil-hardened identity — scale-aware thresholds

Every attestation / revocation / rejection gate is a **percentage band** (or a fixed count) evaluated against the *live set size*, snapshotted when the request is created so the bar can't move mid-request:

```
required = clamp( ceil(setSize · percentBps / 10000), floor, cap )
```

- **Percentage band** → the required signer count *scales with the community* as it grows.
- **`floor`** governs behaviour while the set is small; **`cap`** stops onboarding gates from exploding once the set is large (`cap = 65535` means "no cap").
- **Fixed count** (`percentBps = 0`, `floor == cap`) keeps high-throughput gates (the citizen co-sign) constant no matter how large the town grows — so adoption never slows down.

The gate *type* is chosen by how often it fires: onboarding co-signs stay cheap and fixed; the rare-but-must-stay-strict revocation gate scales with no cap. See [`ThresholdBands.sol`](contracts/governor-contract/contracts/verification-system/ThresholdBands.sol).

### Governance rules (current)

| Rule | Threshold band | Today (5 Attesters / 20 Citizens) |
|---|---|---|
| **Become a Citizen** | 30% of Attesters (floor 2, cap 7) **+ fixed 1 Citizen** | 2 Attesters + 1 Citizen (≥ 3 distinct people) |
| **Revoke a Citizen** | **67% of Attesters (floor 3, no cap)** **+ fixed 1 Citizen** | 4 Attesters + 1 Citizen (≥ 5 distinct people) |
| **Become / revoke an Attester** | 50% of Attesters (floor 3, cap 7) | 3 Attesters |
| **Reject a pending request** | 25% each side (floor 2, cap 5) | 2 Attesters + 5 Citizens |
| **Who can propose** | Anyone holding an Attester NFT | — |
| **Who can vote** | Anyone holding a Citizen NFT, via encrypted MACI v2 ballots | — |
| **Voting period** | 604,800 s (7 days) | — |
| **Quorum** | `max(10% of MACI signups, 2)` — both terms governance-mutable | — |
| **Tally grace period** | 7 days for the coordinator to publish the ZK tally proof | — |
| **Timelock delay** | 3,600 s (1 h) pilot setting — raise via `timelock.updateDelay()` | — |

**Anti-clique guarantee:** attestation requires **≥ 2 Attesters + 1 Citizen** (≥ 3 distinct people), and revocation requires a **≥ 67% Attester supermajority + 1 Citizen** — scaling to 14-of-20 Attesters at 20 Attesters — so "two people revoke everyone" is structurally impossible. Onboarding stays cheap; destructive actions stay hard.

**No-double-sign invariant:** one approval per wallet, and dual Attester + Citizen holders (the norm here) must pick a single role via `signAsAttester` — so no one wallet can satisfy both halves of a gate alone. `msg.sender != target` prevents self-approval. This is *why* the citizen co-sign can safely be a fixed 1.

All band parameters are stored as state on the deployed contracts and are **governance-mutable** by the owner (the Attester Safe / Timelock) via `setAttestationBands` / `setRevocationBands` / `setRejectionBands` — any of them can be re-tuned by a single transaction, no redeploy.

### How to become a Citizen

1. Call `CitizenNFTv2.createAttestationRequest(evidenceURI)` with an evidence pointer. Privacy note: the app stores only a one-way **Poseidon commitment** (`commit:0x…`) on chain — no PII ever touches the chain or the server; the plaintext preimage stays in device secure-store.
2. The required Attesters each call `approveRequest(requestId, signAsAttester = true)`.
3. One existing Citizen calls `approveRequest(requestId, signAsAttester = false)`.
4. Once the snapshotted thresholds are met by distinct signers, the CitizenNFT auto-mints and voting power auto-delegates to the holder.

### How to become an Attester

1. Call `AttesterNFTv2.createAttestationRequest(evidenceURI)`.
2. The required number of existing Attesters each call `approveRequest(requestId)`.
3. When the threshold is met, the soulbound Attester NFT auto-mints.

Bootstrap: three founding Attesters and three founding Citizens are seeded in the constructors; the full historical set (20 Citizens + 5 Attesters) was seeded via a one-shot, since-finalized `migrationMint`.

### How a proposal works (MACI private voting)

1. An Attester calls `MaciAttesterGovernor.propose(...)`. The Governor automatically deploys a fresh MACI **Poll** for the proposal.
2. The proposal is `Active` immediately (MACI v2 has no voting delay). Citizens vote by submitting **encrypted MACI ballots** to the Poll — `Governor.castVote` is disabled by design.
3. After the 7-day voting period, the coordinator decrypts ballots off-chain, generates a Groth16 tally proof, and posts it to the per-poll `Tally` contract. `state()` holds the proposal `Active` through a 7-day grace period until the tally lands.
4. Once the tally lands, the proposal resolves to `Succeeded` (if `forVotes > againstVotes` and quorum is met) or `Defeated`.
5. Anyone calls `queue(...)` then, after the Timelock delay, `execute(...)`.

### Coordinator privacy — Shamir 3-of-5 federation

The MACI coordinator's ballot-decryption key is **not** a single secret on one server. It is **split with Shamir secret-sharing across 5 Attester-held wallets**, and reconstructing it to tally a poll requires **3-of-5 Attesters to cooperate** — there is no single-operator fallback. The plaintext key exists only in a reconstructor process's RAM for a few minutes per tally, then is zeroed. The on-chain tx-signing key (the coordinator EOA above) only authorizes state transitions that the on-chain ZK Verifier has already validated — compromising it breaks liveness, not privacy or result-correctness. See [docs/SHAMIR_CEREMONY.md](docs/SHAMIR_CEREMONY.md) and [docs/MACI_SHAMIR_OPERATIONS.md](docs/MACI_SHAMIR_OPERATIONS.md).

### Röbel Münzen — the town's Circles currency

**Röbel Münzen** (on-chain symbol `RCRC`) is a collateral-backed [Circles v2](https://aboutcircles.com) **group currency** on Gnosis. It gives the identity layer a second, economic Sybil defense and a transparent on-chain trust graph:

- **Gated on the civic ID.** The group's `CitizenMembershipCondition` only lets `CitizenNFTv2` holders be trusted in — so the currency inherits the same verified-resident set as voting.
- **Economic Sybil cost.** Registering as a Circles human burns personal CRC and mints a welcome bonus; faking many identities is expensive, not just permissioned.
- **Owned by the 3-of-5 Attester Safe**, matching the identity NFTs. A hands-free service also auto-trusts each new CitizenNFT holder into the group.
- Surfaced in-app (Expo "Röbel Münzen" home + daily mint), in the web admin dashboard (`/admin/dashboard/circles` + a `/admin/dashboard/muenzen` tokenomics console), and via the standalone **Röbel Circles** mini-app.

> **Roadmap — Phase 2 personhood:** `CitizenNFTv2` reserves an `attestationSource` enum and a `validUntil` dormancy field for a future [Self.xyz](https://self.xyz) proof-of-personhood path — a one-human-one-identity nullifier that does not rely on trusting Attesters, with no PII on chain. See the design plan linked above.

---

## Contract Migration History

### 2026-06-25 — Full consolidation to Gnosis + v2 Sybil-hardening (current)

Identity, MACI, Governor, Timelock **and** the Circles currency are now all native on **Gnosis (chain id 100)**. Previously production ran on Base while only an identity layer lived on Gnosis to gate Circles — that split meant new citizens kept landing on the wrong chain. The consolidation retired Base and shipped fresh, hardened contracts:

| Change | Before (Base v1) | After (Gnosis v2) |
|---|---|---|
| Chain | Identity + governance on Base; Circles-only identity on Gnosis | Everything on Gnosis (chain 100) |
| Thresholds | Flat absolute counts (1 Attester + 1 Citizen to join; 2-of-N Attesters) | **Scale-aware percentage bands** (auto-scale with the community, floor + cap) |
| Attestation (the Sybil lever) | 1 Attester + 1 Citizen | 30%/floor2/cap7 Attesters + fixed 1 Citizen (raised deliberately) |
| Revocation | 1 Attester + 1 Citizen | **67%/floor3/no-cap** Attester supermajority + fixed 1 Citizen (anti-malicious-removal) |
| Re-attestation | none | `validUntil` dormancy + cheap `renewSelf` / `renewByVouch` |
| Personhood hook | none | `attestationSource` enum reserved for Self.xyz (Phase 2) |
| Coordinator key | single env secret on one machine | **Shamir 3-of-5** across Attesters, no single-operator fallback |

The Base contracts remain readable on chain for historical proposal/revocation lookups and are marked as archived (`legacyBase*`) in [`packages/blockchain/src/index.ts`](packages/blockchain/src/index.ts). The Governor + Timelock were re-tuned twice on 2026-06-27; those intermediate deployments are archived under timestamped keys in [`deployments/gnosis-v2.json`](contracts/governor-contract/deployments/gnosis-v2.json).

The full rotation log (every prior MACI Governor + Timelock + VkRegistry rotation) is structured in [`apps/web/src/lib/maci-config.ts`](apps/web/src/lib/maci-config.ts) under `ROTATION_HISTORY`, and every archived address is kept in [`packages/blockchain/src/index.ts`](packages/blockchain/src/index.ts).

---

## Fork for Your Town

This platform is designed to be forked by any small town:

1. Fork this repository
2. Update branding (colors, fonts, mascot) in `packages/design-tokens/`
3. Deploy your own Supabase project
4. Deploy web to Vercel, build mobile with EAS
5. Deploy the identity + governance contracts on Gnosis (and, optionally, register your own Circles group currency)

See [docs/FORKING_GUIDE.md](docs/FORKING_GUIDE.md) for the full guide.

## Contributing

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

[AGPL-3.0](LICENSE) — following the [Decidim](https://decidim.org/) model for open civic technology.
