# Netizen Accounts — the wallet stack as a product (v2)

**Date:** 2026-07-31 (v2, same day — revised per review)
**Status:** Design for review.
**Supersedes:** v1 of this spec (commit `2afcd25c`) and the wallet parts of
`apps/web/docs/NETIZEN_STACK_ARCHITECTURE_PLAN.md` §L1/§9.3.
**Builds on:** [`2026-07-27-thirdweb-independence.md`](2026-07-27-thirdweb-independence.md),
[`2026-07-27-wallet-sovereignty.md`](../plans/2026-07-27-wallet-sovereignty.md),
[`2026-07-27_WALLET_SOVEREIGNTY_RESEARCH.md`](../../future-research/2026-07-27_WALLET_SOVEREIGNTY_RESEARCH.md),
[`2026-07-22_NETIZEN_SOVEREIGN_STACK_RESEARCH.md`](../../future-research/2026-07-22_NETIZEN_SOVEREIGN_STACK_RESEARCH.md),
[`2026-07-27_NETIZEN_CLOUD_PRODUCT_SPEC.md`](../../future-research/2026-07-27_NETIZEN_CLOUD_PRODUCT_SPEC.md).

---

## 0. The product in one line

**Each node is its own thirdweb:** a user signs in with Google / Apple / Facebook /
email / **phone number** through the node's own OIDC keystone, gets **one smart-account
address that is identical on every supported chain**, every transaction is **gasless
and silent** (no signing prompts, no passkey ceremonies), the app integrates it through
a **bottom sheet** (mobile SDK) or a **custom wallet modal** (desktop SDK), and the
node's operator gets **node-local user analytics**. Röbel is the production proof;
Netizen Cloud operates it for customers; the manifest is the contract and the exit.

## 1. Decision log — what v2 changes and why (review direction, 2026-07-31)

| v1 said | v2 says | Why |
|---|---|---|
| Gnosis only, Safe accounts | **Multichain-native**: one address on every enabled EVM chain; account implementation re-selected for cross-chain determinism (§3.3) | Product must match thirdweb's chain coverage model |
| Default custody = device passkey (T1), signing prompts | **Default = node-held embedded signer, silent signing** — zero per-transaction UX. Passkeys/self-custody demoted to an *optional later upgrade*, out of v1 | The thirdweb UX is the requirement; passkey ceremonies and PRF device floors are friction the product must not have |
| Recovery = guardian module, "the hard problem" | **Recovery = re-login** (social/email/phone reaches the same key), like thirdweb. Guardian recovery moves to the self-custody upgrade path | Node custody makes recovery trivial; that is precisely the trade being chosen |
| Auth = social + email | **+ phone number (SMS OTP)** — and phone lands in the Röbel app too | Requested; phone is the lowest-friction civic onboarding |
| Connect UI unspecified | **Bottom sheet (React Native) + custom wallet modal (web)** as first-class SDK components | Requested |
| Per-node OIDC keystone | **Unchanged — affirmed.** The keystone is the auth root of everything below | Requested ("yes with the OIDC set up for each node") |

Unchanged from v1: per-node planes over shareable rails (approach C; the central-SaaS
and pure-toolkit alternatives stay rejected — G2's "never one central Sign in as
Netizen" still binds), per-node paymaster *policy*, node-local analytics on NSP-10,
`@netizen-labs/accounts` as the runtime reader of `identity.authBridge`, address
continuity for existing Röbel citizens (thirdweb adapter until opt-in migration), and
the agent-first sequencing rule.

## 2. Feature parity with thirdweb — what we build

| thirdweb capability | Netizen answer | Build? |
|---|---|---|
| Embedded wallet: social/email/phone → signer, silent signing | Keystone OIDC (live) + **node signer service** (§3.2) | **Yes — the core** |
| Smart account, same address on all chains | One admin EOA per user + deterministic factory on every enabled chain (§3.3) | **Yes** |
| Gasless everywhere | Per-chain bundler + paymaster rails, per-node gas budgets (§3.4) | **Yes** |
| Connect UI (ConnectButton/ConnectEmbed) | Bottom sheet (mobile) + wallet modal (desktop), node-branded, German-first (§3.6) | **Yes** |
| SDK + RPC + React bindings | `@netizen-labs/accounts` (viem-first) + react / react-native | **Yes** |
| Server wallets ("Engine") | Agent/org accounts in the same signer service + Zodiac budgets | **Yes** (= agent path) |
| Data / analytics ("Insight") | Multichain onchain module in `packages/indexer` + operator dashboard (§3.5) | **Yes** |
| Auth backend (SIWE/JWT verify) | Already sovereign — consolidate into one `verifyNodeSignature()` | **Consolidate** |
| Key export to the user | `/wallet/reveal` equivalent against the node signer — parity is a sovereignty feature | **Yes** |
| Contract deploy platform, IPFS storage, fiat/Pay, external-wallet aggregation | Foundry/Hardhat docs; node storage; Monerium; not requested | No |

## 3. Architecture

```
┌────────────────────────────── one node (= one customer) ──────────────────────────────┐
│  AUTH PLANE                SIGNER PLANE (new core)         POLICY PLANE               │
│  keystone OIDC (live)      per-user admin EOA,             sponsorship vouchers       │
│  + Google/Apple/Facebook   envelope-encrypted in the       (membership/agent gate,    │
│  + email OTP + SMS OTP     node vault; silent signing      rate limits, per-chain     │
│  "Sign in with <node>"     API; export; audit; kill switch    gas budgets, fail-closed)│
│                                                                                       │
│  DATA PLANE: packages/indexer + multichain onchain module + operator analytics        │
└──────────────┬────────────────────────────────────────────────────────────────────────┘
               │ userOps (per chain)                  manifest identity.authBridge:
               ▼                                      provider · chains[] · bundlerRpc ·
   ┌────────────────────────────────────────┐         factory · paymaster · signer
   │ CHAIN RAILS (per chain, shareable)     │
   │ Alto bundler + verifying paymaster     │   Gnosis · Base · … (a manifest list;
   │ + RPC, one set per enabled chain       │   a node enables chains by config)
   └────────────────────────────────────────┘
```

### 3.1 Auth plane — the keystone grows two strategies

The per-node OIDC keystone (Röbel ID pattern, live) remains the root. Additions:

- **Phone number (SMS OTP)** as a first-class auth method (`authMethods: [... , "phone"]`
  in NSP-1). Needs an SMS provider credential per node (EU provider, e.g. seven.io;
  secret by reference in the manifest). SIM-swap risk is accepted for civic-tier
  accounts and mitigated by step-up (email or social re-auth) for sensitive actions
  (key export, signer rotation).
- **Per-node social OAuth apps** (Google/Apple/Facebook client IDs are the node's own,
  so consent screens say the node's name — "Sign in with your node" stays literal).
  Registration is onboarding friction; the installer documents it and Netizen Cloud's
  setup agent performs it. **No Netizen-run OAuth broker** — a broker would be exactly
  the central chokepoint G2 forbids.
- **Immediate Röbel win, independent of everything else:** thirdweb's `inAppWallet`
  already supports a `phone` strategy — adding it to the four existing wallet configs
  gives Röbel phone login *now*, on the current stack, and the future keystone path
  inherits the same UX expectation.

### 3.2 Signer plane — the node signs for its members (the honest core)

The thirdweb UX — silent signing, no ceremonies — requires the key to be usable without
per-transaction user interaction. v2 makes the custody explicit and puts it where the
sovereignty story wants it: **the community's node holds the key, not a US vendor.**

- **One random admin EOA per user**, generated at first login, **envelope-encrypted**
  (per-user data key, wrapped by the node's KMS/vault master key). Never derived from a
  shared master secret: no derivation linkage, and per-user re-encryption on rotation.
- **Signing API:** after OIDC login the client holds short-lived tokens; signature and
  userOp requests go to the node's signer service, which signs **silently** server-side
  and enforces policy first (per-identity rate limits, per-action classes, deny-lists,
  the node kill switch). Every signature lands in the audit sink.
- **Sessions and revocation:** refresh-token revocation = signing stops. Losing a phone
  is recovered by logging in again — same identity, same key, same address.
- **Export = sovereignty parity:** a user can always export their admin key (the
  `/wallet/reveal` equivalent, step-up-authenticated). Disclosure text ships with the
  SDK: *"your community's node holds this key for you; you can take it out any time."*
- **Rotation property:** because the onchain account is a smart account, a leaked admin
  EOA can be **rotated** (owner swap on deployed chains) without changing the user's
  address — an incident-response property plain-EOA custody lacks. Counterfactual
  (not-yet-deployed) chains still derive the address from the *original* signer, so the
  factory's salt binds identity, and rotation is recorded per chain.
- **Agents and orgs are the same service** with a different policy class (Zodiac-bounded
  budgets, manifest-declared, kill-switchable) — "Engine" falls out for free, and the
  agent-first rule still applies: agents exercise every new path before humans do.
- **Optional later upgrade (explicitly out of v1):** self-custody for users who want it
  — key export today; a passkey/guardian path can be added behind the same account
  later. It must never reintroduce prompts for users who did not opt in.

### 3.3 Account layer — one address on every chain

An EOA address is chain-independent. That is the anchor: **user address identity comes
from the admin EOA**, and the smart account on top is deployed **counterfactually at
the same CREATE2 address on every enabled chain** via one deterministic factory
(same factory address everywhere, salt = admin EOA).

- **Implementation choice is re-opened** (v1's Safe-first pick was Gnosis-reasoning).
  Requirements: audited, permissive license, deterministic cross-chain factory,
  ERC-4337 EntryPoint v0.7+, admin-owner rotation, modularity for later upgrades
  (ERC-7579 preferred). Candidates to verify (M0): **ZeroDev Kernel** (MIT, multiple
  audits, wide chain coverage), **Biconomy Nexus** (ERC-7579; verify license/audits),
  **Safe + Safe4337Module** (kept as candidate; deterministic cross-chain Safe
  deployment is possible but historically drift-prone — verify). Prior-research claims
  here were Gnosis-scoped; **nothing in this section is treated as verified for other
  chains until M0 checks it onchain per chain.**
- **EIP-7702 track (simplification, not v1):** where 7702 + EntryPoint v0.8 are live,
  the admin EOA itself becomes the account (address = EOA on every chain, no factory at
  all). Watch and adopt per chain; the signer plane is unchanged by it.
- **Röbel continuity is untouched:** existing citizens stay on their thirdweb accounts
  through the thirdweb adapter (no address changes, ever, without opt-in migration and
  a signed identity link). New signups and all customer nodes start on the Netizen
  account layer. The Shamir signature-determinism blocker (attester share keys derive
  from deterministic thirdweb signatures) still gates any migration of *existing* keys.

### 3.4 Chain rails — gasless everywhere, budgeted per node

Per enabled chain: an **Alto** bundler + a **verifying paymaster** + RPC. Shareable:
Netizen Cloud runs one rail set per supported chain serving all its nodes; any node can
point `bundlerRpc`/`paymaster` at its own deployment instead and lose nothing.

- **Policy stays per node** (the v1 invariant survives multichain): the node's keystone
  signs sponsorship vouchers — membership NFT holders and declared agents only,
  per-identity rate limits, and now **per-chain gas budgets** with a per-node daily cap
  that **fails closed**. One community's abuse or budget exhaustion can never touch
  another's.
- **Funding model:** the paymaster operator (Netizen Cloud for managed nodes, the
  community for self-hosted) holds prepaid per-node gas balances per chain; nodes top up
  from their treasury; burn-rate alerting per node per chain. This is the thirdweb
  dashboard-credits model with the policy moved into the node's own keystone.
- **Chain enablement is a manifest edit:** `identity.authBridge.chains: ["gnosis",
  "base", ...]` — v1 rail set: **Gnosis** (Röbel primary) + **Base** (legacy reads,
  ecosystem reach); more by customer demand. Legacy EntryPoint v0.6 support on Gnosis
  remains for existing thirdweb accounts (the code points at v0.6; M0 verifies).
- Sponsoring on expensive chains (mainnet) is a pricing decision per node, not an
  architecture change.

### 3.5 Data plane — multichain analytics without a tracker

Unchanged in shape from v1, widened per chain: `packages/indexer` (NSP-10) gains an
onchain ingestion module reading the node's declared contracts **and account cohort on
every enabled chain** into node-local Postgres. Operator dashboard: active accounts
(D/W/M), new accounts by auth method, retention cohorts, transaction/currency volume,
**sponsored-gas spend per chain against budget**, agent-budget utilization. Everything
node-local; the community is the data controller; no client-side trackers; display
names never raw addresses; wallet addresses treated as personal data (DPIA precedent
becomes the customer template). Cross-node aggregation does not exist in v1.

### 3.6 SDK — `@netizen-labs/accounts` (+ react, react-native)

- **Core (viem-first):** `createNodeAccountClient(manifest)` reads
  `identity.authBridge` — `provider: "netizen" | "thirdweb"` selects the adapter;
  `chains[]` scopes multichain use. The thirdweb adapter wraps the existing
  `inAppWallet` so Röbel's migration and the SDK build stay the same work.
- **Connect UI, first-class:** **mobile bottom sheet** (React Native; the expo
  `LoginDrawer` is the seed) and a **custom wallet modal** (web/desktop) — login
  (social buttons, email, phone), connected state (balances, activity, export, logout),
  node branding, German-first, no vendor branding. These replace `ConnectButton` /
  `ConnectEmbed` at all 8 web sites and the expo drawer.
- **Hooks:** app-owned `useAccount()` (absorbs ~337 raw `useActiveAccount()` sites),
  `useSendTransaction({ chain })` (routes through signer + rails, always sponsored),
  boot state machine per the proven `autoConnectFinished` pattern.
- **EIP-1193 provider export** — mini-apps stay zero-change.
- **Server:** the single `verifyNodeSignature()` (ERC-1271 + ERC-6492 + multi-convention
  recovery, both historic signing-chain domains 100/8453), replacing the six divergent
  verifiers found in the inventory.

### 3.7 Protocol

Still no new NSP. **NSP-1** `identity.authBridge` grows: `chains[]`, `signer`
(service ref + vault ref), `sponsorship` (voucher policy + per-chain budgets), `phone`
auth method. **NSP-10** grows the `onchain` ingestion + analytics retention block.
Everything renders via `netizen render`, reports via `netizen doctor` (the "provider is
thirdweb" warning becomes clearable for real), and Atlas `/conformance` gains the check.

## 4. Build order (Röbel dogfoods every step)

| # | Milestone | Gate / proof |
|---|---|---|
| M0 | **Onchain truth, now multichain:** live citizen account's factory + EntryPoint on Gnosis (unchanged from the 07-27 plan) **+ account-implementation bake-off** (§3.3 candidates: license, audits, deterministic factory per candidate chain) | Blocks account-layer code; written up as an addendum to the research doc |
| M1 | **Quick win:** phone auth strategy added to the four existing `inAppWallet` configs (Röbel gets phone login on the current stack) · SDK skeleton + `useAccount()` adoption · shared `verifyNodeSignature()` · **fix the two live verifier bugs** (delete-account ERC-1271 gap; coordinator `BASE_RPC_URL`) | Phone login works on a real device; Röbel screens render identically |
| M2 | **Rails on Gnosis:** Alto (dual EntryPoint) + verifying paymaster + keystone voucher policy + per-node budget accounting, rendered by the installer | Gasless citizen tx end-to-end on own rails; non-member refused; cap fails closed under load |
| M3 | **Signer plane + agent accounts:** node signer service (vault, envelope encryption, policy, audit, export) minting **agent** accounts first — zero thirdweb in the agent path | An agent authenticates via `client_credentials`, transacts gaslessly within a Zodiac budget, every action audited |
| M4 | **Human embedded accounts:** keystone phone/email/social → node signer → smart account, for **new** signups on Röbel + customer nodes; bottom sheet + wallet modal ship with it | A new citizen onboards by phone number, transacts gaslessly, exports their key; existing citizens untouched |
| M5 | **Multichain enablement:** second chain rail (Base) + counterfactual same-address deployment + per-chain budgets + multichain indexer/analytics | Same address verified byte-identical on both chains; dashboard shows per-chain spend |
| M6 | **Productization:** manifest add-on complete, docs, Atlas conformance, pricing as a Netizen Cloud add-on | A second node enables it by manifest edit + `netizen up` |

Not scheduled (unchanged): opt-in migration of existing Röbel citizens off thirdweb
custody — gated on the Shamir share-key re-registration ceremony and a per-citizen
consented identity link.

## 5. Security & custody honesty

- **The node is the custodian.** That is the product, stated plainly: a community bank
  for keys, with export as the exit. Netizen-the-company holds keys for nobody — the
  signer runs on the customer's box with the customer's vault; Netizen Cloud operates
  it as processor under a DPA.
- **Blast radii, separated:** OIDC signing key ≠ sponsorship voucher key ≠ vault master
  key; per-node isolation; per-capability kill switches (the `app_settings` pattern);
  signer compromise is bounded by policy classes + rate limits + budget caps, and
  remedied by admin-EOA rotation without address loss (§3.2).
- **Paymaster abuse:** voucher-gated, per-identity rate-limited, per-chain budgeted,
  fail-closed, treasury-funded ceilings, burn alerting.
- **Phone auth:** SIM-swap accepted at civic tier; step-up required for export/rotation.
- **Legal (counsel-gated, Legal Masterplan rule, before the service sells):** node-held
  keys are a custody service by the community/operator — whether MiCA/KWG duties attach
  to a Verein-run node, and to Netizen Cloud operating it, is the first Fachanwalt
  question. Key export and the "community as custodian" framing exist partly to keep
  that answer favorable, but the question must be answered, not assumed. Analytics DPIA
  template goes in the same review.

## 6. Open questions for review

1. **v1 chain list:** Gnosis + Base as proposed, or a third from day one?
2. **Account implementation:** any prior on Kernel vs Nexus vs Safe before M0's
   bake-off, or let the verification decide?
3. **SMS provider:** seven.io (DE) as default? Per-node credential either way.
4. **Social OAuth app registration** per node is real onboarding friction — acceptable
   as a documented + agent-automated step, or does a managed interim (Netizen-registered
   apps, explicitly temporary) exist despite the G2 tension? I recommend against the
   interim; stating it for the record.
5. **Pricing:** signer + rails + analytics bundled as one "Accounts" add-on, or rails
   metered per chain separately?
