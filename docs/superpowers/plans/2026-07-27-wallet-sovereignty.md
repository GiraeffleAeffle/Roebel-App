# Wallet sovereignty — staged, reversible plan

**2026-07-27.** Deliverable 2 of [`2026-07-27-thirdweb-independence.md`](../specs/2026-07-27-thirdweb-independence.md).
Evidence: [`2026-07-27_WALLET_SOVEREIGNTY_RESEARCH.md`](../../future-research/2026-07-27_WALLET_SOVEREIGNTY_RESEARCH.md).

**Decision: option (B)** — keep thirdweb as the signer source, replace everything else.
**No citizen's address changes in stages 0–4.** Custody (stage 5) is explicitly *not*
scheduled for 2026.

**Rule for every stage:** ships independently · reversible by config · flag-gated so both
providers work at once · `identity.authBridge.provider` in the manifest selects it ·
anything that runs on a node is rendered by `packages/cli`, never hand-wired.

---

## Stage 0 — On-chain truth (blocks everything; ~half a day)

Answer §7 of the research **before** any code.

1. Take a real citizen smart account (a `CitizenNFTv2` holder) and read on-chain: does it
   have bytecode, which **factory** deployed it, which **EntryPoint** it uses.
2. Read thirdweb's account implementation's `initialize` and record whether it binds
   anything beyond the admin signer.
3. Confirm the canonical EntryPoint address on Gnosis for that version.

**Output:** an `addresses` block appended to the research doc.
**Gate:** if the factory turns out **not** to be permissionlessly callable, option (B)'s
stage 4 dies and the plan stops at stage 3. Everything before that still stands.
**Rollback:** n/a (read-only).

## Stage 1 — SDK/RPC on viem (mechanical, large, low risk)

Move contract **reads** off the thirdweb SDK onto `viem` behind a thin data layer. Reads
first: they cannot lose funds, and they are most of the 258 files.

- Add `packages/blockchain/src/client.ts` exporting a configured viem public client from
  the manifest's `chain.rpc`.
- Migrate read paths app by app, `apps/web` last (largest).
- **Do not touch writes in this stage.**

**Verify:** every migrated screen renders identical data against the same block.
**Rollback:** per-module revert; the two clients coexist indefinitely.

## Stage 2 — Own the bundler (mostly already done)

[`/api/bundler`](../../../apps/web/src/app/api/bundler/route.ts) already proxies to
`GNOSIS_BUNDLER_RPC_URL`, and [`highgas-bundler.ts`](../../../apps/web/src/lib/highgas-bundler.ts)
already drives userOps through it. Generalise, then self-host.

1. Route **all** userOps through the proxy (not just the high-gas path), still to Pimlico.
2. Stand up **Alto** (or Voltaire) as a rendered node service; point the proxy at it via
   env. Manifest: `identity.authBridge.bundlerRpc`.
3. Run both for a week; compare inclusion latency and failure rate.

**Verify:** a gasless citizen transaction succeeds end-to-end on the self-hosted bundler,
on a real device.
**Rollback:** one env var back to Pimlico. **Kill switch:** `app_settings` flag, matching
the existing XMTP pattern.
**Risk:** Voltaire's safe mode needs `debug_traceCall` — confirm the Gnosis RPC provides
it, or run Alto.

## Stage 3 — Own the paymaster

The contract is the easy half. **The sponsorship policy is the hard half** — an open
paymaster is a faucet for whoever finds it.

1. Deploy a verifying paymaster; fund it from the Gemeinschaftskasse Safe with an explicit
   cap.
2. Sponsorship policy: signed by our backend **only** for a wallet that (a) holds a
   `CitizenNFTv2` or (b) is a declared agent account, with per-identity rate limits.
3. Alerting on burn rate; a hard daily ceiling that fails **closed**.

**Verify:** a non-citizen address is refused sponsorship; a citizen is not; the daily cap
actually stops spending in a load test.
**Rollback:** flip `sponsorGas` back to thirdweb's paymaster.
**This stage removes the dependency that would silently make the app unusable** if
thirdweb changed policy — citizens hold no xDAI.

## Stage 4 — Drive the factory ourselves (same addresses)

With stage 0 confirming a permissionless factory, deploy accounts ourselves through our
own bundler + paymaster, at the **same** `(factory, signer, salt)` — so **addresses are
unchanged and no migration exists**.

- `identity.authBridge.provider: "netizen"` selects this path; `"thirdweb"` reverts it.
- Extend `AuthBridge` (`apps/roebel-id/src/auth-bridge/`) with a `netizen-bridge.ts`
  alongside the existing `thirdweb-bridge.ts`.

**Verify — the decisive test:** on a **testnet dry-run first**, then for one consenting
citizen, the address produced by our path is **byte-identical** to the thirdweb one. If it
differs by one bit, stop; that is option (C) in disguise.
**Rollback:** provider flag.

## Stage 5 — Custody — NOT scheduled for 2026

Do not start until both are done and reviewed:
1. **Recovery design** (research §6.1) — what happens when a citizen loses their phone.
2. **PRF device-floor sizing** (§6.2) — how many Röbel citizens are excluded by
   iOS 18+ / Android 14+, and what the fallback onboarding path is.

Then: passkey signer + Safe passkey module, **opt-in per citizen**, with an on-chain signed
link between old and new identity. Never a big-bang; never a forced re-key.

**Losing citizen keys is worse than any vendor dependency.**

---

## Agent-first sequencing (cross-cutting requirement)

`inAppWallet` is built around a **human social login**, so agent accounts cannot be minted
through the citizen path at all — agents are not first-class members today.

Therefore, at **each** of stages 2–4, land the **agent** path before the citizen path:

- an agent account holds no soulbound citizenship, so a bug costs a re-deploy, not
  someone's membership;
- it exercises the whole stack in production before a citizen touches it;
- it closes a real gap — agent identity via `client_credentials` + RFC-8693 `act`
  delegation + a scoped Safe budget + kill switch, all already modeled in the manifest.

**Definition of done for the agent path:** an agent authenticates with
`client_credentials`, holds its own smart account minted by our stack, transacts gaslessly
within a Zodiac-Roles-scoped budget, and every action lands in the audit sink — with **zero
thirdweb** in that path, while citizens are still on thirdweb custody and unaffected.

## Definition of done (stages 0–4)

- A citizen logs in, holds the **same address**, and transacts gaslessly with thirdweb in
  the path **only as the signer**.
- `identity.authBridge.provider: "netizen"` selects the new path; `"thirdweb"` reverts with
  **no data migration**.
- `netizen doctor` reports the `identity-keys` layer honestly (still `✗` until stage 5 —
  do not let the score lie).
- The research doc states plainly what was not achieved and what the new stack costs to run.
