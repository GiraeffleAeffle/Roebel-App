# Wallet Sovereignty — replacing thirdweb with our own stack

**Date:** 2026-07-27
**Status:** Kickoff spec for an implementing agent. **Research first, then plan, then execute.**
**Goal (MISSION G2):** "Netizen mints the accounts." Remove the dependency on thirdweb
without changing a single citizen's address.

---

## 0. Read this first (do not skip)

You are working in a **live civic platform with real users in a real town**. Wallets
here are not test accounts: they hold soulbound membership NFTs, community currency
balances, and governance signups. **An address change is a data-loss event.**

**Required reading before you plan anything:**
- `docs/MISSION_AND_GOALS.md` — G2 is the goal this spec serves
- `packages/blockchain/src/index.ts` — **source of truth** for chain + contract addresses
- `apps/roebel-id/src/auth-bridge/` — the `AuthBridge` seam (already designed to be swapped)
- `packages/protocol/src/manifest.ts` — `identity.authBridge` already models
  `provider: "thirdweb" | "netizen"` plus `bundlerRpc`/`entryPoint`/`factory`/`paymaster`
- `docs/future-research/2026-07-22_NETIZEN_SOVEREIGN_STACK_RESEARCH.md` — prior
  93-claim research incl. the thirdweb → Safe + passkeys + own-4337 path
- `docs/NODE_SECURITY_POLICY.md` — key custody is now a security-critical concern

**Verify every architectural claim against the code.** Prior sessions have found the
docs lagging reality. Where they disagree, the code wins and you fix the doc.

---

## 1. What thirdweb actually provides today

Establish this empirically (grep the apps; do not assume). Expect roughly:

| # | Capability | Where it is used |
|---|---|---|
| 1 | **In-app wallet / key custody** — Google, Apple, Facebook, email login producing a signer (enclave-held key) | `apps/web`, `apps/expo`, `apps/roebel-id/src/interaction/login-page.ts` |
| 2 | **Smart-account factory** — deterministic ERC-4337 account address per signer | same |
| 3 | **Bundler** — UserOperation submission | `GNOSIS_BUNDLER_RPC_URL` |
| 4 | **Paymaster** — gasless sponsorship (`sponsorGas: true`) | same |
| 5 | **SDK + RPC + contract reads/writes** | everywhere (`thirdweb/react`, `getContract`, …) |

Also inventory what it provides that is *not* wallet infra and may be replaced
separately or kept: contract deploys, event indexing/monitoring, storage.

## 2. The constraint that dominates everything

**Address continuity.** A citizen's Gnosis smart-account address is bound to:
- `CitizenNFTv2` / `AttesterNFTv2` (soulbound — cannot simply be re-minted freely)
- Circles v2 "Röbel Münzen" trust + balances
- MACI signups (per-poll state)
- Safe signer sets, points/ledger rows keyed by `wallet_address`

thirdweb derives the account address from `(factory, signer, salt)`. Any change to
factory **or** signer changes the address. So the plan must answer, with evidence,
**one** of:

- **(A) Reproduce the same address** — deploy/point at the *same* factory contract and
  reuse the *same* signer key material, so addresses are unchanged; or
- **(B) Keep custody, change everything else** — retain thirdweb only as the signer
  source while replacing bundler/paymaster/SDK (partial sovereignty, no migration); or
- **(C) Migrate deliberately** — new accounts, plus an on-chain migration for NFTs,
  Circles and points, with a signed link between old and new identity.

Research which is actually possible (is the factory address reusable? is the enclave
key exportable? what does thirdweb's account implementation do on `initialize`?).
**Do not pick (C) by default** — it is the most expensive and most user-visible.

## 3. Candidate sovereign replacements (verify current state, 2026)

- **Key custody:** WebAuthn/**passkeys** as the signer (device-held, phishing-resistant),
  optionally with a recovery scheme. Compare against: Safe's passkey signer module,
  Privy/Turnkey (still third parties), and self-hosted MPC. Note the **recovery
  problem** is the hard part, not the signing.
- **Accounts:** **Safe{Core}** (battle-tested, already used for the treasury) vs a
  minimal ERC-4337 account. Prefer reusing Safe — you already depend on it.
- **Bundler:** self-hosted (Rundler / Silius / Alto). Cost + ops burden of running one.
- **Paymaster:** own contract + a funded sponsor; policy for who gets sponsored (abuse!).
- **SDK/RPC:** **viem** (already in the tree) + your own Gnosis RPC or a provider.
- **ERC-4337 version:** confirm which EntryPoint the live accounts use and what the
  ecosystem has moved to; a version mismatch silently breaks sponsorship.

## 4. Deliverables, in order

1. **Research report** → `docs/future-research/2026-07-27_WALLET_SOVEREIGNTY_RESEARCH.md`
   - the real inventory (§1) with file references
   - a definitive answer on address continuity (§2) with evidence
   - component-by-component replacement options with tradeoffs, cost, ops burden
   - **the strongest argument for staying on thirdweb** (steelman it; partial
     sovereignty may be the correct answer for now)
2. **Implementation plan** → `docs/superpowers/plans/2026-07-27-wallet-sovereignty.md`
   - staged so **each stage ships independently and is reversible**
   - suggested spine: SDK/RPC → bundler → paymaster → accounts → custody
     (custody last: it is the one that touches user addresses)
   - explicit rollback per stage, and a kill-switch
   - test strategy incl. a **testnet dry-run of the full flow** before any prod change
3. **Execution** — behind the existing `AuthBridge` seam and the manifest's
   `identity.authBridge.provider` flag, so switching is config, not a rewrite.
   Follow the standing rule: **anything that runs on a node must be renderable by
   the installer** (`packages/cli`), never hand-wired.

## 5. Hard constraints

- **No user's address may change without an explicit, planned migration** the user
  consents to.
- **Gasless must keep working.** Citizens do not hold xDAI; if sponsorship breaks,
  the app is unusable for them.
- **Ship behind a flag.** Both providers must work simultaneously during transition.
- **Key custody is now your responsibility.** Read `docs/NODE_SECURITY_POLICY.md` §1.
  Losing user keys is worse than any vendor dependency.
- Keep the repo public-safe: secrets by reference only.

## 6. Definition of done

- A citizen can log in (social **and** passkey), hold the same address, and transact
  gaslessly with **zero thirdweb** in the path.
- `identity.authBridge.provider: "netizen"` in the manifest is sufficient to select it.
- Rollback to `"thirdweb"` works without data migration.
- The research report honestly states what was *not* achieved and what it costs to run.
