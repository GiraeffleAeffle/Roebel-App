# K1 — Netizen Accounts fully replaces thirdweb

**Date:** 2026-08-11 · **Status:** research input; execution is governed by [ADR 0014](../adr/0014-provider-neutral-member-identity-and-staged-wallet-migration.md) · **Owner:** unassigned agent

> **Decision update, 2026-08-13:** Do not begin with a Thirdweb hard cutover. The accepted next design move is a provider-neutral `CitizenSession` seam with Thirdweb as the first adapter, followed by an opt-in passkey/Safe/Pimlico staging adapter and dual-proof account linking. This kickoff's inventory and address-continuity constraints remain valid; its “fully replaces” mission is a possible end state, not permission to migrate users or address-bound rights.

> Read this whole document before touching code. It ends with a decision memo
> you must produce **before** implementing anything, because the wrong choice
> here silently orphans 20 citizens, their NFTs, their Circles trust, their MACI
> signups and their Nostr identities.

## 1. Mission

Remove thirdweb from the Röbel stack and serve every capability it currently
provides from Netizen Accounts, so that a community can launch without a
thirdweb account, dashboard, client ID, or origin allowlist.

This is **not** a library swap. thirdweb currently supplies an identity
custodian, an account-abstraction stack, a signature scheme other systems
verify against, and an RPC/contract layer. Each has different replacement risk.

## 2. Where you work — two repos

| Repo | Role in this task |
|---|---|
| `Roebel-Labs/Roebel-App` (this repo) | The **consumer**. All thirdweb call sites live here (`apps/expo`, `apps/web`, `apps/coordinator`, Supabase edge functions). |
| `MaxBrych/Netizen-Labs` (NOT checked out here) | The **provider**. `signer` + `accounts` packages, `NetizenVerifyingPaymaster`, Alto bundler config. Clone it separately; nothing in this repo references it yet. |

Everything in §4 was verified in this repo on 2026-08-11. The Netizen-Labs side
is described from project memory and **you must re-verify it** — its last
recorded blocker (C-1) is that the signer signs only for a member's EOA while
ERC-4337 requires a contract sender, i.e. the Kernel v3 account layer was the
next unbuilt tranche.

## 3. Required reading (this repo)

- [`apps/expo/constants/thirdweb.ts`](../../apps/expo/constants/thirdweb.ts) — client, chain, every contract handle. Read the comment on `export const chain`; it explains the EIP-712 domain trap that already broke Nostr registration once.
- [`apps/expo/constants/wallets.ts`](../../apps/expo/constants/wallets.ts) — the in-app wallet + smart-account config, including the second Gnosis wallet.
- [`apps/expo/lib/nostr/identity.ts`](../../apps/expo/lib/nostr/identity.ts) — read the doc comment on `deriveAndStoreIdentity` (~line 60). It states the orphaning risk in one paragraph.
- [`apps/expo/lib/maci.ts`](../../apps/expo/lib/maci.ts), [`apps/expo/lib/citizen-commitment.ts`](../../apps/expo/lib/citizen-commitment.ts), [`apps/expo/lib/encryption.ts`](../../apps/expo/lib/encryption.ts) — the other signature-derived secrets.
- [`docs/SMART_ACCOUNT_GASLESS_SETUP.md`](../SMART_ACCOUNT_GASLESS_SETUP.md), [`docs/CIRCLES_ROEBEL_MUENZEN_STATE.md`](../CIRCLES_ROEBEL_MUENZEN_STATE.md).
- [`packages/blockchain/src/index.ts`](../../packages/blockchain/src/index.ts) — `CHAIN_ID = 100` is the source of truth for the active chain and address set.

## 4. Verified surface to replace (2026-08-11)

Counted across `apps/expo/{app,components,lib,hooks,context}`. Nothing may be
dropped without an explicit decision recorded in your memo.

**A. Identity custody + login** — `inAppWallet({ auth: { options: ['email','phone','google','facebook','apple'], redirectUrl } })`. thirdweb runs the OTP delivery, the OAuth dance, and custody of the user's key material. This is the largest non-crypto lift and the least "just code".

**B. Account abstraction** — `smartAccount: { chain, sponsorGas: true }` on Gnosis (chain id 100), plus a parallel `gnosisWallet` instance that deterministically yields the **same address**. Provides: account factory, CREATE2 address derivation, userOp building, bundler, and gas sponsorship policy.

**C. Signing + verification semantics** — `account.signMessage`, whose smart-account signatures are verified elsewhere via **ERC-1271** with an **EIP-712 `AccountMessage` domain stamped with the chain id**. Verifiers today: `apps/roebel-id`, `apps/expo/supabase/functions/org-membership`, the Nostr registration edge function, and the coordinator. A domain mismatch recovers a *stranger*, silently.

**D. React state layer** — `useActiveAccount` (**59 call sites**), `useActiveWallet` (6), `useDisconnect` (4), `useSetActiveWallet`, `useWalletBalance`, `useReadContract`, `ThirdwebProvider`, `ConnectEmbed`.

**E. Contract/RPC layer** — `getContract` (all contract handles), `readContract` (10), `sendTransaction` (6), `prepareTransaction` (3), `prepareContractCall` (2), `waitForReceipt`, `getContractEvents`, `prepareEvent`, `isContractDeployed`, plus `thirdweb/extensions/erc721` (`balanceOf`) and `erc20` (`transfer`, `balanceOf`).

**F. Profile data** — `getUserEmail`, `getProfiles` from `thirdweb/wallets/in-app` (linked login identities).

**G. Utils** — `keccak256`, `toWei`, `toHex` (trivial; viem covers these).

**H. Server-side** — thirdweb is also referenced in `apps/web/src/app/api/bundler/route.ts`, `apps/web/src/app/api/coordinator/proposal-action/[txHash]/route.ts`, `apps/web/src/app/api/sommercamp/register/route.ts`, `apps/expo/supabase/functions/org-membership`, `apps/expo/supabase/functions/delete-user-account`.

Note reads mostly go to a **pinned public RPC** already (`https://rpc.gnosischain.com` via `gnosisRead`), so the RPC dependency is thinner than it looks.

## 5. Hard constraints — violating any of these is a production incident

1. **Account addresses must survive.** The smart-account address is CREATE2 from (factory, admin, salt) and is *identical on every EVM chain*. Bound to it today: CitizenNFTv2 / AttesterNFTv2 holdings (20 citizens + 5 attesters, migration-minted and finalized), Circles v2 group trust, MACI signups (`stateIndex`), org memberships, push tokens, and every Supabase row keyed by wallet address. **A different account factory produces different addresses and detaches all of it.**
2. **Signature-derived secrets must not re-derive.** MACI voting keys, the Nostr secret key, and the citizen commitment are deterministic functions of a wallet signature. A new signer changes the signature, therefore the npub and the MACI key. `deriveAndStoreIdentity` already refuses to re-derive over an existing key for exactly this reason — preserve that property.
3. **Never touch `lib/encryption.ts`'s chain id 8453.** It is a derivation constant, not a network selector. Changing it makes existing ciphertext undecryptable.
4. **ERC-1271 verifiers must be migrated in lockstep** with the signing change, including the chain-id domain. List every verifier before you change one.
5. **Gasless must stay gasless.** Citizens hold no xDAI. Any window where sponsorship is unavailable is a full outage of voting, attestation, and Münzen.
6. The Röbel production app is live on iOS/Android and now as a PWA. Native builds ship via EAS on Max's machine — code must work on native and web from one source.

## 6. Deliverables

### Slice 0 — Migration strategy memo (REQUIRED FIRST, no code)

Write `docs/future-research/2026-08-XX_ACCOUNT_MIGRATION_STRATEGY.md` evaluating
at least these three routes against §5, with a recommendation:

- **(a) Address-preserving factory** — Netizen Accounts reproduces the existing accounts' addresses (same factory/admin/salt semantics). Highest fidelity, likely constrains you to thirdweb's account implementation; verify whether the deployed accounts are upgradeable and who holds the upgrade right.
- **(b) Keep accounts, replace everything above them** — leave the deployed smart accounts and their addresses untouched; Netizen Accounts supplies auth, key custody, bundler, paymaster, and signing to those same accounts. Ask whether the account's admin/owner key can be re-issued to a Netizen-custodied signer, and whether the derivation-sensitive signatures can be reproduced.
- **(c) New accounts + explicit on-chain migration** — new addresses, then re-mint/re-attest NFTs, re-trust in Circles, re-signup in MACI, re-register npubs, and migrate Supabase rows. Cleanest architecture, most expensive, and it burns the "identity is continuous" property. Cost it honestly (per-citizen tx count, coordination burden, what breaks irreversibly).

The memo decides Slices 1-4. Bring it to Max before continuing.

### Slice 1 — Provider-agnostic seam in this repo

Introduce an internal account abstraction (e.g. `apps/expo/lib/account/`) that the
app's 59 `useActiveAccount` call sites and the contract layer consume, with
thirdweb behind it as the first implementation. **No behavior change; the app
must be byte-for-byte equivalent in behavior after this slice.** This makes the
later cutover a one-file change and is valuable even if Slice 0 picks (c).

ADR 0014 now fixes this as the first implementation slice. The seam represents a stable member and selected app account in addition to signing/transaction capabilities; it must not expose a wallet address as the canonical person identifier.
### Slice 2 — Netizen Accounts parity (Netizen-Labs repo)

Close blocker C-1 (contract sender / Kernel v3 or the equivalent the memo picks),
plus bundler + paymaster + sponsorship policy on Gnosis, and the auth methods
from §4A. Ship with an example manifest fixture (project rule: every rendered
service needs one).

### Slice 3 — Cutover behind a flag

Dual-run: Netizen Accounts selectable per user via `app_settings`, with Max as
the first account. Verify against §5 checklist on a real device before widening.

### Slice 4 — Remove thirdweb

Delete the dependency, the client ID, and the origin-allowlist step from the
deploy runbook ([`docs/EXPO_WEB_PWA.md`](../EXPO_WEB_PWA.md)). **This is the step
that makes community onboarding self-serve**, so state it in the PR.

## 7. Verification

- `cd apps/expo && pnpm smoke:web` must stay green at every slice.
- Do **not** run a global `tsc` (the repo has ~431 pre-existing errors from an untyped Supabase client); use jest + the smoke gate.
- Native regression check: no shared-code path may change behavior on ios/android without an explicit `Platform` guard.
- Before/after address assertion: for a known citizen, the derived account address, npub, and MACI `stateIndex` must be identical.

## 8. Open questions for Max

1. Is any downtime acceptable for the cutover, or must it be fully hot?
2. If Slice 0 recommends (c) new accounts, is re-attesting 20 citizens acceptable, and who coordinates it?
3. Should Netizen Accounts custody keys itself (server-side), or move to passkeys (see [K3](2026-08-11_K3_IDENTITY_INVERSION.md))? This overlaps K3 and the two should be decided together.
