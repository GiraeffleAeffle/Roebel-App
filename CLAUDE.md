# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

The Roebel App is an open-source civic technology platform for Roebel/Mueritz, Germany — designed as a replicable blueprint for small towns. It ships as both a mobile app (Expo/React Native) and a website (Next.js), organized as a Turborepo monorepo.

## Monorepo Structure

```
roebel/
├── apps/
│   ├── web/              # Next.js 15 website (Tailwind CSS)
│   └── expo/             # Expo SDK 55 mobile app (StyleSheet + useTheme)
├── packages/
│   ├── config/           # Shared ESLint, TypeScript configs
│   ├── blockchain/       # Shared contract ABIs, thirdweb utils
│   └── design-tokens/    # Shared color/spacing tokens
├── contracts/
│   ├── governor-contract/    # Hardhat contracts (OpenZeppelin v4.9.6)
│   └── governor-contracts-new/
├── docs/                 # Project documentation
├── turbo.json
├── pnpm-workspace.yaml
└── package.json
```

## Commands

```bash
# Root (Turborepo)
pnpm install              # Install all dependencies
pnpm dev                  # Start all apps in dev mode
pnpm dev:web              # Start only web (Next.js)
pnpm dev:expo             # Start only expo (React Native)
pnpm build                # Build all apps
pnpm lint                 # Lint all apps

# Web app
cd apps/web
pnpm dev                  # localhost:3000
pnpm build
pnpm lint

# Expo app
cd apps/expo
pnpm start                # Expo dev server
pnpm ios                  # Run on iOS simulator
pnpm android              # Run on Android emulator

# Contracts
cd contracts/governor-contract
npx hardhat compile
npx thirdweb deploy -k YOUR_SECRET_KEY
```

## Key Architecture Decisions

### Styling (IMPORTANT)
- **Web (apps/web)**: Tailwind CSS — use utility classes
- **Expo (apps/expo)**: `StyleSheet.create()` + `useTheme()` hook — NO NativeWind
  - Token source of truth: `constants/theme.ts` (lightColors/darkColors)
  - Theme context: `context/ThemeContext.tsx`
  - A previous NativeWind migration attempt broke the app and was reverted. Do NOT attempt NativeWind migration without explicit user approval.
- **Shared tokens**: `packages/design-tokens/` — consumed differently by each app

### Blockchain
- **Gnosis Chain (chain id 100)** + Thirdweb Smart Wallets (invisible Web3) — full Base→Gnosis consolidation **LIVE 2026-06-25**. Identity + governance + Circles currency all run on Gnosis; the Base stack is **archived** (`legacyBase*` in `packages/blockchain/`, `deployments/base.json`).
- `inAppWallet` + `smartAccount` (gasless ERC-4337)
- Contract ABIs and addresses in `packages/blockchain/` — **`packages/blockchain/src/index.ts` (`CHAIN_ID = 100`) is the source of truth for the active chain and address set.**

### Backend
- Supabase (Postgres, Auth, Realtime, Edge Functions)
- Direct messaging: dual-rail since 2026-07-10 — XMTP v3/MLS (E2E, personal↔personal, in-chat Röbel-Münzen payments / reactions / read receipts / blocking; identity = thirdweb Gnosis smart account, SCW/ERC-1271) + Supabase Realtime (conversation registry, org/support chats, fallback rail). READ `docs/XMTP_INTEGRATION_STATE.md` before touching DMs. Needs the ≥2026-07-10 EAS build; remote kill switch `app_settings.xmtp_dms_enabled`.

## Smart Contracts

### Governor Contract (Hardhat — OpenZeppelin v4.9.6)

- **HomeTownVotingNFT.sol** - Soulbound ERC721 NFT (1 NFT = 1 vote)
- **SimpleHomeTownGovernor.sol** - DAO governance (public voting)
- **HomeTownMaciGovernor.sol** - MACI-integrated governance (private voting)

### Deployed Contract Addresses — Base Mainnet ⚠️ ARCHIVED (superseded 2026-06-25 by the Gnosis v2 set below; kept for historical proposal/revocation lookups only — NOT the live stack)
- AttesterNFT: `0x79B837b269f3EB3FB1c5856fE1E21675F05a3aFb` (governance-mutable thresholds)
- CitizenNFT: `0x7eF8308129C47E31415BEfC210aCEbD8ae6861BB` (1 Attester + 1 Citizen for BOTH attestation and revocation; governance-mutable)
- SignUpTokenGatekeeper: `0xc767fa3bbd9f0934Fb419137d7b6506E44105f74` (FRESH — empty `registeredTokenIds`; bound to CitizenNFT + the MACI core below. Replaces `0xcf12E8da…`.)
- MACI core: `0x76e0097D2F1e0D747B3dd58622c76b278e2f587a` (deploy block 47070186; `MACI_DEPLOY_BLOCK` = 47070086)
- Governor (MaciAttesterGovernor): `0xCd3b0feEE7C7dAEf7976A46627E5a6fE310A4F91` (voting + proposals; 5 governance setters: quorumPercentage, quorumAbsolute, tallyGracePeriod, coordinator, coordinatorPubKey)
- Timelock: `0xc93032B37Fb9409996a943978fFE26852B1c4368` (1h min delay; raise via `timelock.updateDelay()` governance proposal)
- Legacy AttesterGovernor (read-only, public-vote, deprecated): `0x84D8ab0FcA4D0689e2E3F036dc461942343c2a5b`
- NOTE: AttesterNFT/CitizenNFT remain owned by the prior Timelock `0xe8B8149F9373a56F55112e5Fc867E58308D014c1`; NFT-threshold governance routes through the prior Governor `0xb5333aFf2A0015aF0d58C0f92c826Fc503e63177`, not the current voting Governor above.

Source of truth: [`contracts/governor-contract/deployments/base.json`](contracts/governor-contract/deployments/base.json) and [`packages/blockchain/src/index.ts`](packages/blockchain/src/index.ts).

### Gnosis Mainnet — Sybil-hardened v2 consolidation (LIVE 2026-06-25)

Full Base→Gnosis consolidation. **Fresh `AttesterNFTv2` + `CitizenNFTv2`** with **scale-aware percentage-band thresholds** (see [`docs/superpowers/plans/2026-06-24-gnosis-consolidation-and-sybil-hardening.md`](docs/superpowers/plans/2026-06-24-gnosis-consolidation-and-sybil-hardening.md)). 20 citizens (15 snapshot + 5 Base stragglers) + 5 attesters migration-minted + finalized. **Identity + governance + Circles currency now all on Gnosis.**

- AttesterNFTv2: `0xC587F383696D3c9DF7A6eE03A9160E40Ae1cdb82` (approval/rejection band 50%/floor3/cap7)
- CitizenNFTv2: `0x59aA26f499D7C2B3EC2c8524Ed06F54fc4E85dE5` (join = 30%/floor2/cap7 attesters + **fixed 1** citizen; revoke = **67%/floor3/no-cap** attesters + fixed 1 citizen; rejection 25%/floor2/cap5; `validUntil` re-attestation dormancy OFF at launch; `attestationSource` reserves the Self.xyz Phase-2 path)
- SignUpTokenGatekeeper (→CitizenNFTv2): `0xc4B9E45F0e84BC0CDe930CE888E4D0e38184f277`
- MACI core: `0x6663eDC8650276fe264710B1A2ba46eB8bd0bF1D` (deploy block 46867803)
- Verifier: `0xC95359cF5d7391cD239c9476393706a8132406dc`; VkRegistry: `0xB21EAA60DF62b7cf06Eb0a2554D9C4e6BA76658f`
- Timelock: `0x5b358A77E89FF3d699607b4fC235b381d67f3d05` (Governor=proposer; deployer renounced admin; original v2 Timelock `0xB5605f9F…` archived 2026-06-27)
- MaciAttesterGovernor: `0x5F5e499Dc1872c2Ce19a4b50cd10f680e78E3Ba3` (wired to v2 NFTs + new MACI; reuses the existing Shamir coordinator pubkey/EOA `0x5e6528D2…`; **re-deployed twice on 2026-06-27** — originals `0x140F0eC6…` + `0xDC250315…` archived under timestamped keys in `deployments/gnosis-v2.json`; source of truth = that manifest + `packages/blockchain/src/index.ts`)
- NFT owner = Attester **Safe** `0x3A08c86Efc5ff38CC35d850F1D4d564e497bFDEa` (threshold changes = Safe tx; D2 keeps Safe ownership for bootstrap — hand to Timelock later for full on-chain governance).
- CommunityRegistry: `0x1c4B243a5f72248aEFcd6F11caf0d3cFAe9fF889` (deployed + Blockscout-verified 2026-07-31 — unowned, admin-free community address book, one per chain; records self-sovereign under each community's timelock/Safe; written by `scripts/community-factory.cjs`, consumed by `netizen deploy --merge`; record: [`deployments/community-registry.json`](contracts/governor-contract/deployments/community-registry.json))
- Source of truth: [`contracts/governor-contract/deployments/gnosis-v2.json`](contracts/governor-contract/deployments/gnosis-v2.json).
- **App cutover SHIPPED — merged to `main` (branch fully merged, 0 unique commits; cutover commit `e75270d`, 2026-06-25).** The chain flip (`base`→`gnosis`), v2-ABI changes, and the apps targeting the v2 contracts are live on `main`: [`packages/blockchain/src/index.ts`](packages/blockchain/src/index.ts) marks the Gnosis v2 addresses as the **active** set and the Base stack as **archived**. `feat/gnosis-v2-sybil-hardening` is now 142 commits behind `main` with nothing to merge. The remaining rollout steps are **operational, not code** (MACI re-signup per citizen; Vercel/Fly env for chain / `GNOSIS_BUNDLER_RPC_URL` / coordinator). The earlier "Gnosis migration" was identity-only (the v1 `0x6FF3…`/`0x7bD6…` NFTs that gate Circles); those are **superseded** by the v2 contracts above.

## Coordinator privacy — Shamir 3-of-5 federation (fully active 2026-06-10)

The MACI coordinator privkey is no longer a single env var on Fly. It
has been replaced with a **3-of-5 Shamir secret-sharing federation**
across 5 AttesterNFT-holder wallets. As of 2026-06-10 10:54 UTC, the
legacy `COORDINATOR_PRIV` env var has been **permanently removed**
(`fly secrets unset COORDINATOR_PRIV -a roebel-maci-coordinator`).
Decrypting any vote now requires 3-of-5 Attester cooperation. There
is no fallback.

- Conceptual deep-dive: [`docs/SHAMIR_CEREMONY.md`](docs/SHAMIR_CEREMONY.md)
- Operational runbook: [`docs/MACI_SHAMIR_OPERATIONS.md`](docs/MACI_SHAMIR_OPERATIONS.md)
- First Shamir tallies: polls 3 + 4 ran the full pipeline end-to-end
  (3 Attester shares → reconstruct → genProofs → on-chain), BUT both
  recorded **0/0/0** — every ballot was invalid because the Expo app
  encrypted votes to a hardcoded, pre-rotation coordinator pubkey
  (fixed in `4da83fd`: client now reads `Poll.coordinatorPubKey()`
  on-chain at vote time; the constant is deleted). Runbook §10.10a.
  The first poll created+voted AFTER `4da83fd` ships will be the first
  with real Shamir-tallied vote counts.

Key implications when working on coordinator code:
- All polls created after 2026-06-09 18:40 UTC (rotation execution)
  are encrypted to the Shamir-split coordinator pubkey. The legacy
  `finalize-poll.js` path is now dead — it exits 1 with `COORDINATOR_PRIV
  not set` on every invocation. `scan-and-finalize.js`'s
  `useLegacy = !!process.env.COORDINATOR_PRIV` is permanently false.
- Tallying a poll requires opening a Tally-Session via
  `/admin/dashboard/coordinator → Tally-Sessions`, then ≥3 Attesters
  submitting their decrypted shares at
  `/admin/dashboard/coordinator/tally/<pollId>`. The legacy Tally button
  has been removed from the admin Vorschläge page.
- Plaintext privkey exists only in the reconstructor child process's
  RAM for ~10 minutes per tally. Never written to disk. Zeroed after
  use. Between tallies the privkey does not exist anywhere.
- `COORDINATOR_ETH_PRIV` (the ETH-tx-signing key) stays on Fly — it
  only authorizes on-chain state transitions that ZK proofs already
  validate. Compromising it does not enable vote decryption.
- The "production lessons" section (§10) of the runbook documents the
  10 bugs caught during the end-to-end rollout (publicnode RPC null
  receipts, smart-account propose decoding via event log, ethers v6
  `Result.values` collision, manifest `Z`-vs-`+00:00`, CORS on
  submissions endpoint, orphan-session race, ERC-1271 fallback for
  submission verify, GovernorDisabledDeposit on survey proposals, etc).
  Read it before touching the coordinator scripts.

## Environment Variables

Each app has its own `.env.example` showing required variables. Copy to `.env.local` (web) or `.env` (expo) and fill in real values.

**NEVER commit real API keys.** Use environment variables and `.env.example` files with placeholder values only.

## Package Manager

This monorepo uses **pnpm** with workspaces. Do not use npm or yarn.

## Commit Convention

```
feat(web): add proposal page
fix(expo): camera permissions
docs: update forking guide
chore(deps): upgrade Expo SDK
```

## Development Notes

- All UI text in German (primary), English (secondary)
- Primary color: `#00498B` (Navy, from Roebel coat of arms; rebranded 2026-06-27 from `#194383`). Secondary text `#6B7280`, borders `#B4B8C1`.
- Font: Inter family (body), Plus Jakarta Sans (headings)
- Mecky = AI chatbot mascot (Claude-powered, German language)

## Supabase — Use the Supabase MCP (mandatory)

This repo registers the Supabase MCP server at project scope in `.mcp.json`
(project ref: `wwbeqhkslxdxhktqzqti`). Every agent and contributor working in
this project MUST use the Supabase MCP for Supabase operations instead of raw
CLI calls or ad-hoc HTTP. The `supabase` CLI is intentionally not installed
in this environment.

Use the MCP for:
- Deploying / updating Edge Functions (`apps/expo/supabase/functions/*`)
- Running ad-hoc SQL or inspecting tables
- Applying or generating migrations (`supabase/migrations/*`)
- Reading function and Postgres logs
- Listing projects, buckets, secrets, branches

First-time setup per machine:
1. Confirm the server loads: `claude mcp list`
2. Authenticate (interactive OAuth, must run outside the IDE extension):
   `claude /mcp` → select `supabase` → Authenticate
3. Optional Supabase Agent Skills: `npx skills add supabase/agent-skills`

If an MCP tool is available for a given Supabase operation, prefer it over
reaching for a shell command, even if you remember the CLI invocation.
