# Netizen Accounts — the wallet stack as a product

**Date:** 2026-07-31
**Status:** Design for review. Supersedes the wallet parts of
`apps/web/docs/NETIZEN_STACK_ARCHITECTURE_PLAN.md` §L1/§9.3 (2026-06-12, pre-extraction naming).
**Builds on:** [`2026-07-27-thirdweb-independence.md`](2026-07-27-thirdweb-independence.md) (spec),
[`2026-07-27-wallet-sovereignty.md`](../plans/2026-07-27-wallet-sovereignty.md) (plan, option B),
[`2026-07-27_WALLET_SOVEREIGNTY_RESEARCH.md`](../../future-research/2026-07-27_WALLET_SOVEREIGNTY_RESEARCH.md),
[`2026-07-22_NETIZEN_SOVEREIGN_STACK_RESEARCH.md`](../../future-research/2026-07-22_NETIZEN_SOVEREIGN_STACK_RESEARCH.md),
[`2026-07-27_NETIZEN_CLOUD_PRODUCT_SPEC.md`](../../future-research/2026-07-27_NETIZEN_CLOUD_PRODUCT_SPEC.md).

---

## 0. The reframe

The 2026-07-27 work treats wallet sovereignty as a **migration problem**: get Röbel off
thirdweb without breaking a single address. This spec keeps every one of its decisions
(option B, stages 0–4, custody last, agent-first) and adds the second half of the ask:

> The wallet stack is not just an exit from a vendor. It is a **product line**. Privy built
> a company on exactly this feature set. Netizen Cloud customers need embedded wallets,
> gasless transactions, contract tooling and user analytics — and Netizen cannot resell
> thirdweb to them.

The reframe that unlocks it: **the "custody last / not 2026" rule was a rule about
migration risk, not about custody itself.** A *new* account carries no migration risk.
So custody splits into three tiers with different timelines:

| Tier | Who | Custody | When |
|---|---|---|---|
| T3 (legacy) | Existing Röbel citizens | thirdweb enclave signer | Now → opt-in re-key, per the 07-27 plan stage 5. Untouched. |
| T2 (node-held) | **Agents**, orgs, PRF-floor-excluded devices | Node vault key, escrowed to the community | First — agents already need it and hold nothing soulbound |
| T1 (device-held) | **New** human signups on any node | Passkey (WebAuthn PRF) + Safe passkey module | After T2 has run in production and recovery is designed |

Röbel dogfoods every tier; Netizen customers start at T1/T2 and never touch thirdweb.

## 1. What "the entire thirdweb feature list" actually is — and what we build

From the verified inventory (226 importing files reduce to this):

| thirdweb / Privy capability | Netizen answer | Build? |
|---|---|---|
| Embedded wallet auth (social/email → signer) | Keystone OIDC (live) + passkey signer (T1) + node vault signer (T2) | **Yes — the core** |
| ERC-4337 factory / deterministic accounts | Safe + Safe4337Module for new accounts; thirdweb default factory kept for legacy addresses | **Yes** |
| Bundler | Self-hosted Alto, chain-scoped, behind the proven `/api/bundler` seam | **Yes** (mostly done) |
| Paymaster + sponsorship policy | Per-node verifying paymaster + keystone-signed sponsorship vouchers | **Yes** |
| SDK + RPC + React bindings | `@netizen-labs/accounts` (viem-first) + react/react-native surfaces | **Yes** |
| Server wallets / tx infra ("Engine") | T2 agent accounts + Zodiac Roles budgets (already the plan) | **Yes** (= agent path) |
| Data / analytics ("Insight" + dashboard) | Onchain module in `packages/indexer` (NSP-10) + operator analytics | **Yes** |
| Auth backend (SIWE verify, JWT) | Already sovereign — consolidate into one `verifyNodeSignature()` | **Consolidate** |
| Contract deploy platform | Hardhat/Foundry + docs. Not a product. | No |
| IPFS storage | 3 call sites → node storage / public gateway | No (fold into node) |
| Fiat / Pay | Monerium rail exists; never compete with the EMI | No |
| Cross-chain support | Gnosis only. The manifest declares the chain; one chain done well. | No (v1) |
| Social profile APIs | 1 component (`SocialProfileCard`) → drop or inline | No |

## 2. Approaches considered

**A — Central wallet SaaS (the literal Privy clone).** One Netizen-run custody +
dashboard service, API keys per customer. **Rejected.** It violates G2's hard rule
("never one central Sign in as Netizen"), recreates the thirdweb chokepoint one level up
with Netizen as the honeypot, collapses the sovereignty pitch that is the entire
differentiator, and drags Netizen toward custody licensing (MiCA-adjacent — counsel
territory per the Legal Masterplan).

**B — Pure toolkit, no service.** Ship the SDK + manifest sections + installer support;
every node self-hosts everything; Netizen operates nothing. Cleanest sovereignty, but
bundler/paymaster ops are real on-call work no Verein can carry, there is no revenue
surface, and Röbel would wait on perfect self-hosting.

**C — Federated service (recommended).** Per-node account + policy + data planes;
chain-scoped shared rails that any node can swap out by URL; the manifest is the
contract. Netizen Cloud's product is *operating* these planes for customers who don't
want to — the same split the Cloud spec already makes for every other module ("we run
the babysitting; you own the keys, the data and the exit").

## 3. Architecture — three planes per node, one shared rail, one SDK

```
┌──────────────────────────── one node (= one customer) ────────────────────────────┐
│  ACCOUNT PLANE                POLICY PLANE                 DATA PLANE             │
│  Safe + passkey module        keystone (OIDC, live)        packages/indexer       │
│  (T1) / node vault (T2)       + sponsorship voucher        + onchain module       │
│  legacy thirdweb (T3)           signer + rate limits       + operator analytics   │
│  recovery: guardians          + per-node paymaster         (node-local Postgres)  │
│  (attester Safe, timelock)      contract, funded caps                             │
└───────────────┬───────────────────────┬───────────────────────────────────────────┘
                │ ERC-4337 userOps      │ signed sponsorship vouchers
                ▼                       ▼
        ┌──────────────────────────────────────────┐
        │  CHAIN RAIL (per chain, shareable)       │     manifest identity.authBridge:
        │  Alto bundler (EP v0.6 legacy +          │     provider · bundlerRpc ·
        │  v0.7/0.8 Safe) · RPC · Gnosis (100)     │     entryPoint · factory · paymaster
        └──────────────────────────────────────────┘
```

### 3.1 Account plane

- **New accounts are Safe smart accounts** (Safe4337Module), minted by the node's own
  factory path. Rationale: already trusted for the treasury, audited passkey module,
  LGPL, and the 93-claim research found no credible alternative custody vendor.
- **T1 signer:** passkey via WebAuthn PRF (`react-native-passkeys`), verified onchain by
  the P-256 precompile (EIP-7951, live on Gnosis since 2026-04). Keys never exist
  server-side. Floors: iOS 18+ / Android 14+ → below the floor, onboarding falls back
  to T2 with explicit disclosure ("your community's node holds this key for you").
- **T2 signer:** derived under the node's vault secret (the `NODE_AGENT_SECRET` pattern
  already shipped for Nostr agent/org keys), escrowed to the community per
  `ARCHITECTURE.md`'s custody policy. Used by agents, org accounts, and the PRF
  fallback. Spending authority always bounded by Zodiac Roles budgets — the onchain
  policy engine Privy's TEE promises can't match.
- **T3:** existing thirdweb accounts keep working forever through the same SDK
  (adapter, below). No forced migration, ever. The individual export path
  (`/wallet/reveal`) stays advertised as a sovereignty property.
- **Recovery (the hard problem, now a product):** Safe owner set = passkey + a recovery
  module whose guardians are the node's **attester Safe** (Röbel: `0x3A08…`) and
  optionally the keystone. Guardians can only *rotate owners* after a timelock with
  user-visible notification and veto — never move funds. Key loss additionally has the
  institutional path no vendor can offer: re-attestation re-establishes membership
  (soulbound re-mint) even when the money at the old address is gone. Selling line:
  *"your town can restore your account; nobody can take it."* **Gate:** this module's
  design is reviewed before any T1 signup ships (07-27 plan §6.1 stands).

### 3.2 Policy plane (the keystone grows one job)

The paymaster contract is easy; the policy is the product. The node's keystone — which
already knows who is a citizen, an org, an agent — signs **sponsorship vouchers**:

- eligibility: holds the node's membership NFT, or is a declared agent in the manifest;
- per-identity rate limits + per-node daily cap, **fail closed**;
- funded from that node's treasury Safe with an explicit ceiling; burn-rate alerting.

Per-node paymasters mean one community's abuse or budget exhaustion can never drain
another's — the multi-tenant isolation decision that makes shared rails safe.
Sponsorship signing key ≠ OIDC signing key (separate blast radii, both in the node vault,
both with kill switches following the `app_settings` pattern).

### 3.3 Chain rail

- **Alto** self-hosted per chain (GPL-3.0, verified self-hostable), serving **both**
  EntryPoint v0.6 (the legacy thirdweb accounts — the code comment at
  `apps/web/src/app/api/coordinator/proposal-action/[txHash]/route.ts:19` points to
  v0.6; stage 0 verifies onchain) **and** v0.7/0.8 for new Safe accounts.
- Every node fronts it with its own `/api/bundler` proxy (production-proven). Netizen
  Cloud runs the shared Gnosis rail; `identity.authBridge.bundlerRpc` points anywhere —
  a node can bring its own bundler and lose nothing. The bundler holds no user policy
  and is reimbursed by each node's paymaster, which is why sharing it is safe.

### 3.4 Data plane — analytics without a tracker

The thirdweb-Insight equivalent is an extension of what already exists, not a new
service. `packages/indexer` (NSP-10) gains an **onchain ingestion module**: viem log
ingestion of the contracts the node's manifest declares, plus account activity of the
node's own accounts, into the same node-local Postgres. On top:

- **Operator analytics** (what Privy/thirdweb dashboards sell): active accounts
  (D/W/M), new accounts by tier, retention cohorts, transaction and currency volume,
  sponsored-gas spend against cap, agent-budget utilization.
- **Privacy is the differentiator, not a constraint:** everything is node-local;
  the community is the data controller; dashboards show display names and aggregates,
  never raw addresses (standing rule); no client-side trackers — the explorer's
  "no tracking" property extends to the whole product. Wallet addresses are treated as
  personal data (DPIA precedent); retention windows declared in the manifest. No
  cross-node aggregation exists in v1 — if it ever does, it is opt-in and aggregate-only.
- Röbel's DPIA/AV-register work becomes the **template** every customer node inherits —
  S1 revenue, and a moat a Zug protocol shop cannot copy.

### 3.5 SDK — `@netizen-labs/accounts`

viem-first core + `accounts-react` / `accounts-react-native`, living in the
`netizen_labs` monorepo next to its siblings. The SDK is **the runtime reader of the
manifest flag nothing reads today**: `createNodeAccountClient(manifest)` selects the
adapter from `identity.authBridge.provider`.

- **Adapter `netizen`:** passkey/vault signer + Safe4337 + node bundler/paymaster.
- **Adapter `thirdweb`:** wraps the existing `inAppWallet` config — this is what makes
  the Röbel migration and the SDK build the *same work* instead of parallel work.
- React surface mirrors what Röbel actually consumes: an app-owned `useAccount()`
  (replacing ~337 raw `useActiveAccount()` sites), a node-branded `ConnectPanel`
  (replacing `ConnectButton`/`ConnectEmbed`, German-first, no vendor branding), and the
  `autoConnectFinished` boot state machine already proven in the expo contexts.
- EIP-1193 provider export — the mini-app boundary is already thirdweb-free and needs
  zero changes.
- **Server: one `verifyNodeSignature()`** (ERC-1271 + ERC-6492 + the multi-convention
  recovery from `packages/relay-sync`), replacing the six divergent verifier
  implementations the inventory found. Handles both signing-chain domains (100 + 8453,
  the standing thirdweb quirk) and, later, P-256 passkey signatures.

### 3.6 Protocol

No new NSP number. The service is the completion of two existing specs:
**NSP-1** (`identity.authBridge` — add `custodyTiers`, `sponsorship` policy refs,
`recovery` guardian config) and **NSP-10** (`services.indexer` — add the `onchain`
ingestion block + `analytics` retention declaration). Everything renders through
`netizen render` and reports through `netizen doctor` — the standing installer rule;
`doctor`'s existing "provider is thirdweb" sovereignty warning becomes clearable for
real. Atlas `/conformance` gains the check.

## 4. Build order

Milestones extend the 07-27 plan (its stages 0–4 are unchanged and remain the spine);
each ships independently, reversible by config, Röbel first.

| # | Milestone | = plan stage | Gate / proof |
|---|---|---|---|
| M0 | Onchain truth: factory, EntryPoint, `initialize` behavior of a live citizen account | 0 | Blocks everything (unchanged) |
| M1 | SDK core: `@netizen-labs/accounts` skeleton, viem reads, `useAccount()` adoption, shared `verifyNodeSignature()`; **fix the two live verifier bugs now** (delete-account ERC-1271 gap; coordinator's stale `BASE_RPC_URL`) | 1 | Röbel screens render identically; deletion flow verified on a real smart account |
| M2 | Rails: shared Alto (dual EntryPoint) + per-node paymaster + keystone voucher policy, rendered by the installer | 2–3 | Gasless citizen tx on own rails on a real device; non-citizen refused; daily cap fails closed under load |
| M3 | T2 agent accounts: node-minted Safe + Zodiac budget + audit trail, zero thirdweb | 4 + agent-first rule | An agent transacts gaslessly within budget in production |
| M4 | T1 passkey signups for **new** humans (Röbel's next citizens + customer nodes); PRF-floor fallback to T2 | new | Recovery design reviewed; device-floor sized; existing citizens untouched |
| M5 | Data plane: indexer onchain module + operator analytics dashboard | new | Röbel's own dashboard runs on it; zero client-side trackers |
| M6 | Productization: manifest add-on complete, docs, Atlas conformance, pricing as a Netizen Cloud add-on ("Sovereign Accounts") | new | A second node enables it by manifest edit + `netizen up` |

**Deliberately not scheduled:** T3 opt-in re-key of existing citizens (07-27 plan stage
5 — unchanged, gated on recovery + device floor + the **Shamir signature-determinism
blocker**: attester share keys are derived from RFC-6979-deterministic thirdweb
signatures, so any signer change requires a share-key re-registration ceremony first).

## 5. Security summary

- **Custody:** T1 non-custodial (device passkey); T2 disclosed node custody, community
  escrow, Zodiac-bounded; T3 vendor custody, shrinking. Netizen-the-company holds keys
  for **nobody** — the control plane provisions nodes and holds scoped credentials only.
- **Paymaster abuse:** voucher-gated, rate-limited, fail-closed caps, per-node budgets,
  treasury-funded ceilings, burn alerting.
- **Blast radii:** sponsorship key ≠ OIDC key ≠ vault secret; per-node isolation means a
  compromised node never crosses tenants; kill switches per capability.
- **Recovery:** guardians rotate owners only, timelocked, vetoable, notified.
- **Legal (counsel-gated per the Legal Masterplan):** T2 node custody is the
  *community's* operation with Netizen as processor under a DPA — whether any MiCA/KWG
  custody duty attaches, and the analytics DPIA template, both go to the Fachanwalt
  before the service sells. The T1 default exists precisely to keep the answer simple.

## 6. Open questions for review

1. Naming: "Netizen Accounts" as the add-on name? (Copy rules apply: no em-dashes in
   public copy, "Onchain", no Optimism.)
2. Does the recovery guardian set include the keystone by default, or attester Safe
   only? (Keystone inclusion eases UX, widens its blast radius.)
3. Analytics pricing: bundled into the base node fee or a separate add-on uplift?
4. Should M1's `useAccount()` adoption run as its own mechanical PR series before any
   rails work, given it touches ~337 sites?
