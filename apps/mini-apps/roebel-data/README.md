# Röbel Circles — Netizen Mini App

The first-party **proof-of-concept** for the [Netizen Mini App platform](../../../packages/miniapp-sdk).
It's the town's on-chain economy dashboard — **Town** (supply, backing, trust graph, CSV export),
**Economy** (a visx analytics dashboard), and **Governance** (proposals) — plus citizen tools to
**invite neighbours** into Röbel-Münzen and **create event QR codes**.

It runs embedded in the Röbel host (Expo WebView / web iframe), bundles
`@netizen-labs/miniapp-sdk`, and talks to the host over the Netizen `postMessage` bridge.

> Ported from the standalone Vite Circles mini app to **Next.js 15 (App Router)** and swapped
> off `@aboutcircles/miniapp-sdk` onto `@netizen-labs/miniapp-sdk`. The rich dashboards (visx charts,
> trust graph, governance) are unchanged — this was a framework + SDK swap, not a rewrite.

## Stack

Next.js 15 (App Router) · React 19 · TypeScript · Tailwind v4 (`@theme` in `app/globals.css`) ·
Mona Sans (self-hosted via `next/font/local`) · `@netizen-labs/miniapp-sdk` (workspace) ·
`@visx/*` + `@xyflow/react` (charts / graph) · `viem` (Gnosis reads) ·
`@aboutcircles/sdk-invitations` (the InviteFarm invitation path). A pnpm-workspace member
under `apps/mini-apps/*`.

## Netizen SDK usage

| Capability | Where | SDK call |
|---|---|---|
| Dismiss host splash (MANDATORY) | `src/App.tsx` mount | `sdk.actions.ready()` |
| Connected account + live updates | `src/App.tsx` | `sdk.wallet.getAccount()`, `sdk.on('walletChanged', …)` |
| Untrusted context (host name) | `src/App.tsx` | `sdk.getContext()` |
| Röbel-Münzen balance chip (RÖ) | `src/App.tsx` header → `src/lib/rewards.ts` | `sdk.roebel.getMuenzenBalance()` |
| Reward on invite / share | `InviteView`, `GrowCard` → `src/lib/rewards.ts` | `sdk.roebel.grantReward({ amount, reason, idempotencyKey })` |
| Signed txs (invite / self-fund) | `InviteView` → `src/lib/wallet.ts` | `sdk.wallet.getEthereumProvider()` → `eth_sendTransaction` |
| Analytics (writes `mini_app_events`) | everywhere → `src/lib/analytics.ts` | `sdk.track(event, props)` |

The manifest lives in [`netizen.manifest.ts`](./netizen.manifest.ts) (slug `roebel-data`,
category `community`, permissions `wallet` / `circles` / `rewards` / `share`).

**Copy rule (DESIGN.md §5):** the in-app currency is **"Röbel-Münzen" (RÖ)** — never CRC/Circles —
and raw wallet addresses are never shown (the header chip shows the balance, not the address).

## Run (dev)

```bash
pnpm install            # from the monorepo root (workspace)
pnpm --filter @netizen/miniapp-roebel-data dev   # http://localhost:3000
```

Outside a host, the SDK calls resolve to safe no-ops (no wallet connects, balance shows "…",
`grantReward` degrades to "no reward") — the dashboards still render their live on-chain data.
Inside the Röbel host the wallet, balance, rewards, and transaction signing all light up.

## Stadtstack decision cases (read-only)

The Governance tab has a visually separate **Kommunale Entscheidungsfälle**
section. Configure its public provider origin with:

```bash
NEXT_PUBLIC_STADTSTACK_PUBLIC_BASE_URL=https://your-stadtstack.example
```

Leaving the value empty produces an explicit "not configured" state. The
section uses `@roebel/stadtstack-federation-client` to accept only reviewed v1
case-index, manifest and seven-stage snapshots, confine linked resources to the
configured provider, verify the stable stage-map SHA-256 with Web Crypto, and
fail closed on invalid, missing, withdrawn, oversized or timed-out reads. It
never authenticates, writes, rewards, opens a wallet or calls Supabase.

For a stakeholder build that must demonstrate the administration feedback loop
before a real Röbel case has completed local review, opt in explicitly:

```bash
NEXT_PUBLIC_STADTSTACK_DEMO_SCENARIO=walkthrough
```

This adds a separate amber **Demo · keine amtlichen Antworten** card with the
department-by-department states. The client accepts it only from the confined
Stadtstack origin and only when the JSON contract plus truth, authority and
scenario response headers all identify the synthetic walkthrough. It never
mixes the walkthrough into the reviewed case feed.

The same explicit walkthrough flag also adds a read-only Activity Journal
timeline. This is an eight-event, metadata-only synthetic fixture reconstructed
for the demo—not live municipal state. The Mini App requires the complete
ordered segment, recomputes every event SHA-256 and the independently pinned
segment-seal SHA-256, and fails closed on missing, additional, partial or
tampered data. It renders only static allowlisted labels; conversation content,
tool inputs, internal documents, credentials and raw artifact identifiers stay
out of the citizen view.

Only the confined `publicCaseUrl` can be opened through
`sdk.actions.openUrl()`. Proof references and provider-supplied action URLs are
not rendered. In this first slice a `410` hides the old content entirely; a
checksummed public retraction-notice view is a named follow-up rather than an
unverified fallback.

## Deploy (Vercel)

Deployed as a standalone Next.js app; the host loads it by its `homeUrl`. The included
[`vercel.json`](./vercel.json) sets `framework: nextjs` and `frame-ancestors *` so the host can
embed it in a WebView / iframe.

- **Dashboard:** New Project → Root Directory = `apps/mini-apps/roebel-data` → Framework
  **Next.js**.
- Point the manifest's `homeUrl` / `iconUrl` at the deployed origin, then register the app in the
  `mini_apps` table (see the integration note below) so it appears **live** in the Expo store.

## Notes

- `generateInvites` targets **deployed** addresses; a thirdweb smart account deploys on its first
  userOp. If a citizen's account isn't deployed yet, invite after its first on-chain action.
- Rewards are **host-authorized**: budget, rate-limit, and idempotency are enforced server-side. An
  unreviewed app has `reward_budget = 0`, so `grantReward` degrades to "no reward" until an admin
  sets a budget.
