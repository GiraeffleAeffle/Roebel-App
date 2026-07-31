# Wallet Sovereignty — what thirdweb actually holds, and what it would take to leave

**2026-07-27.** Deliverable 1 of [`2026-07-27-thirdweb-independence.md`](../superpowers/specs/2026-07-27-thirdweb-independence.md)
(MISSION **G2**: "Netizen mints the accounts").

> **Scope honesty.** The inventory and the address-continuity analysis below are
> **verified against this repo's code and the live node**, with file references. The
> external component facts (Alto/Voltaire, Safe passkey module, EIP-7702/7951 on Gnosis)
> are **carried over from the 93-claim adversarial research** in
> [`2026-07-22_NETIZEN_SOVEREIGN_STACK_RESEARCH.md`](2026-07-22_NETIZEN_SOVEREIGN_STACK_RESEARCH.md)
> and were **not re-verified here**. Three things are explicitly **unverified** and are
> listed in §7 — they must be checked on-chain before anyone writes migration code.

---

## 1. The real inventory

`thirdweb` appears in **258 TypeScript files**:

| Surface | Files | What it does there |
|---|---|---|
| `apps/web` | 160 | wallet connect, contract reads/writes, the whole admin console |
| `apps/expo` | 86 | citizen login + every on-chain action in the mobile app |
| `apps/roebel-id` | 9 | the keystone's login page — wallet → OIDC identity |
| `packages/*` | 3 | shared ABIs/util |

That count overstates the lock-in. It is **five separable capabilities**, and they are
not equally hard to replace:

| # | Capability | Where | Replaceability |
|---|---|---|---|
| 1 | **SDK / RPC / contract reads+writes** | everywhere | **Easy.** `viem` is already in the tree. Mechanical, large, low-risk. |
| 2 | **Bundler** | [`apps/web/src/app/api/bundler/route.ts`](../../apps/web/src/app/api/bundler/route.ts) | **Already done in one path** — see §3. |
| 3 | **Paymaster** (`sponsorGas: true`) | 7 call sites | Medium. Own contract + funded sponsor + an abuse policy. |
| 4 | **Smart-account factory** | *never configured* — see §2 | Medium, but it is what fixes the address. |
| 5 | **Key custody** (`inAppWallet` enclave signer) | 6 call sites | **The actual lock-in.** Everything else is plumbing. |

The `AuthBridge` seam the spec promised is real:
[`apps/roebel-id/src/auth-bridge/`](../../apps/roebel-id/src/auth-bridge/) contains
`types.ts` + `thirdweb-bridge.ts` + `verify-siwe.ts`, so the keystone side is already
written against an interface, not against thirdweb directly.

## 2. Address continuity — the constraint that dominates everything

A citizen's Gnosis smart-account address is bound to their `CitizenNFTv2` (soulbound),
their Circles "Röbel Münzen" trust + balances, their MACI signups, and every
`wallet_address`-keyed row in Supabase. **An address change is a data-loss event.**

thirdweb derives the account address from `(factory, signer, salt)`. Two findings decide
which of the spec's options A/B/C is available:

**Finding 1 — no factory is configured anywhere.**
```
grep -rn "accountFactoryAddress\|factoryAddress" apps packages   →   zero matches
```
Every call site is just `smartAccount: { chain, sponsorGas: true }`
([`apps/expo/constants/wallets.ts:14`](../../apps/expo/constants/wallets.ts#L14),
[`apps/web/src/lib/wallet-config.ts:13`](../../apps/web/src/lib/wallet-config.ts#L13),
[`apps/roebel-id/src/interaction/login-page.ts:55`](../../apps/roebel-id/src/interaction/login-page.ts#L55)).
So the accounts sit on thirdweb's **default** factory. That factory is an ordinary
**public contract on Gnosis** — permissionless to call. Nothing stops our own bundler
from driving the same factory to produce the same addresses. **The factory is not the
lock-in.**

**Finding 2 — the signer key is user-exportable.**
[`apps/web/src/app/wallet/reveal/page.tsx`](../../apps/web/src/app/wallet/reveal/page.tsx)
already ships a page walking a citizen through thirdweb's *Manage Wallet → Export Private
Key*, and states plainly that there is no recovery phrase, only the hex key. So the
enclave-held admin key **can leave thirdweb** — but only **to the user**, by the user.

**Consequence — the honest reading of A/B/C:**

- **(A) Reproduce the same address** is *cryptographically* possible (same public factory
  + same signer) but **operationally unacceptable**: it requires every citizen to export a
  private key and hand it to the platform. Collecting citizen private keys is a worse
  security posture than the vendor dependency it removes. **Reject A as a platform
  migration** — but keep it as the *individual exit path* it already is, which is itself a
  sovereignty property worth advertising.
- **(B) Keep custody, replace everything else** — replace SDK, bundler, paymaster, and
  point at the factory ourselves, while `inAppWallet` continues to hold the signer.
  **No address changes, no migration, no consent flow.** This is the correct next move.
- **(C) Deliberate migration to new accounts** — only ever justified together with a
  *product* reason to re-key (e.g. passkeys), and then only as **opt-in, per citizen**,
  with an on-chain signed link between old and new identity. Not a big-bang.

**The steelman for staying on thirdweb** (the spec asked for it): thirdweb currently
provides social-login key custody with an enclave, account recovery, and a working
paymaster — for free, for a town of ~20 onboarded citizens. Replacing custody means
Netizen owns *citizen key loss*, which is unrecoverable and far more damaging than a
vendor outage. The 2026-07-22 research is blunt that **no end-to-end passkey + 4337 +
Gnosis reference implementation exists anywhere**, so this is novel engineering on the one
component where bugs are permanent. **Partial sovereignty (B) is the correct answer for
2026.** Custody moves last, or not at all this year.

## 3. What is already sovereign (and nobody wrote it down)

The bundler is **already not thirdweb** on the highest-gas path:
[`apps/web/src/lib/highgas-bundler.ts`](../../apps/web/src/lib/highgas-bundler.ts) builds a
`smartWallet` with `overrides.bundlerUrl` pointed at
[`/api/bundler`](../../apps/web/src/app/api/bundler/route.ts), a self-controlled proxy that
forwards to `GNOSIS_BUNDLER_RPC_URL` (Pimlico today, but the seam is ours). It runs with
`sponsorGas: false` to dodge thirdweb's 12M sponsored-gas cap.

Two things follow. First, **the bundler swap is proven in production**, not theoretical —
stage 2 of the plan is mostly generalising a path that already works. Second, that proxy
is exactly where a **self-hosted Alto/Voltaire** URL drops in with no app-side change.

## 4. AI-agent operability — a constraint thirdweb cannot satisfy

The manifest already models agents as members (`agents.a2a`, `identity.agentIdentity`:
`client_credentials` + RFC-8693 `act` delegation + kill switch), and today's node runs
agent workloads.

**`inAppWallet` is built around a human social login** — Google/Apple/Facebook/email. An
autonomous agent has no Google account, and creating one per agent is both absurd and a
policy violation waiting to happen. So *agent* smart accounts cannot be minted through the
citizen path at all. Today that gap is papered over with separately managed keys.

This reframes G2: **"Netizen mints the accounts" is not only about leaving a vendor — it is
the only way agents become first-class members** with their own account, scoped Safe
budget, and audit trail. The agent path is also the **safest place to build the new
stack**: an agent account holds no citizen's soulbound membership, so a bug costs a
re-deploy rather than someone's citizenship. **Build the sovereign minting path for agents
first, and let citizens inherit a stack that has already run in production.**

(Related and already shipped today: declared agent Nostr keys now survive relay allow-list
syncs — `agents.a2a.relayPubkeys`. Before that, an agent literally could not publish to its
own community's relay.)

## 5. Component options (carried from the 2026-07-22 research, not re-verified)

| Layer | Recommendation | Note |
|---|---|---|
| SDK/RPC | **viem** (already a dependency) | mechanical |
| Bundler | **Alto** (GPL-3.0) or **Voltaire** (LGPL-3.0), self-hosted behind `/api/bundler` | Voltaire's safe mode needs `debug_traceCall` |
| Paymaster | own contract + funded sponsor | **the abuse policy is the hard part**, not the contract |
| Accounts | **Safe{Core}** — already trusted for the treasury | prefer reusing what you already depend on |
| Custody | **passkeys** (WebAuthn PRF) + Safe passkey module | PRF floors: **iOS 18+ / Android 14+**; Apple's cross-device QR flow does not pass PRF |
| Recovery | **unsolved — this is the real work** | see §6 |

## 6. The two genuinely hard problems

1. **Recovery, not signing.** Signing with a passkey is solved. What happens when a citizen
   loses their phone is not. Options (social recovery via attesters, a Safe guardian set,
   an encrypted backup blob) all trade security against a 70-year-old losing access to
   their citizenship. **Do not start custody work until this is designed and reviewed.**
2. **The PRF device floor.** iOS 18+ / Android 14+ excludes some share of ~5,000 eventual
   citizens. Nobody has sized it for Röbel. A civic platform cannot ship an onboarding path
   that silently excludes older devices — the fallback is a **product requirement**, not an
   edge case.

## 7. Unverified — check before writing migration code

1. **The default factory address on Gnosis for the accounts our citizens actually hold**,
   and which **EntryPoint** version they use. This report establishes that *no factory is
   configured in our code*; it does **not** establish which contract thirdweb's SDK
   resolves to at runtime. Read it off a real deployed citizen account on-chain. A version
   mismatch silently breaks sponsorship.
2. **Whether thirdweb's account implementation's `initialize` binds anything else** (an
   admin registry, a thirdweb-owned role) that would make a self-driven factory call
   produce a *different-behaving* account at the same address.
3. **Canonical EntryPoint v0.7/v0.8 addresses on Gnosis** + audit status of the open
   verifying paymasters — flagged unverified in the 2026-07-22 research too, still open.

## 8. Recommendation

**Take option (B), staged, custody last — and build it on the agent path first.**

Order (each stage ships independently and is reversible): **SDK/RPC → bundler → paymaster
→ accounts → custody**. Stages 1–3 remove real vendor dependency, change **no addresses**,
need **no citizen consent flow**, and are individually revertible by config. Stage 5
(custody) should not start in 2026 unless recovery (§6.1) is designed, reviewed, and
device-floor-sized (§6.2).

Doing stages 1–4 moves `doctor`'s `identity-keys` layer from "a third party mints citizen
accounts" to "a third party holds the signer" — honest partial progress — and gets agents a
first-class account path they do not have today.

Plan: [`2026-07-27-wallet-sovereignty.md`](../superpowers/plans/2026-07-27-wallet-sovereignty.md).

## Addendum 2026-07-31 — onchain answers (M0 of the Accounts plan)

Verified against citizen account `0x90f677dC480E76A127eC1DCE42263a370e396313`
(CitizenNFTv2 `ownerOf(1)`) on Gnosis, via `rpc.gnosischain.com`:

- **Account bytecode:** deployed — EIP-1167 minimal proxy (45 bytes) →
  implementation `0xf22175c80c6e074c171811c59c6c0087e2a6a346`
- **EntryPoint:** `0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789` → **v0.6**
  (read via `entryPoint()` on the account)
- **Factory:** `0x85e23b94e7F5E9cC1fF78BCe78cfb15B81f0DF00` (read via `factory()`
  on the account; contract confirmed to have code on Gnosis) — thirdweb's default
  AccountFactory, publicly callable
- **Consequence for the rails (M2):** Alto must serve EntryPoint **v0.6** for
  legacy accounts alongside v0.7+ for new accounts. §7 items 1–2 of this doc are
  now answered; item 3 (paymaster audit status) remains open. §7 item 2's
  `initialize` question narrows to: read the implementation at `0xf22175c8…` and
  record what its initializer binds beyond the admin signer before any
  self-driven factory call.
