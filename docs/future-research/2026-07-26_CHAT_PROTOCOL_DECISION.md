# Chat Protocol Decision — Sovereign Humans + AI-Agents Workplace (2026)

> Research + decision for the workplace chat rail(s). Grounded in three deep briefs (Matrix/Element,
> Nostr/Buzz, XMTP+interop), 2026 current-state. Feeds [MISSION_AND_GOALS](../MISSION_AND_GOALS.md)
> G5/G6 and the org collaborative suite (Slice 2 of the interoperable workspace). Companion to the
> buzz/openDesk research and the [Röbel ID keystone](../superpowers/specs/2026-07-24-roebel-id-sso-keystone-design.md).

## Decision (BLUF)

**Poly-protocol, unified at the IDENTITY layer (Röbel ID), NOT at the message layer.** No single
protocol does both mature human collaboration *and* a first-class agent workplace well, and **there is
no production message bridge between Matrix, XMTP, and Nostr** (the only one that ever existed is a dead
2022 PoC). So "bridge where needed" is not viable on the wire — unify by one identity, surface per context.

| Context | Rail | Why | Timing |
|---|---|---|---|
| **Human collaboration** (org, openDesk-grade) | **Matrix / Element** | openDesk's own comms component; mature E2EE groups (Megolm), Spaces/threads/VoIP/moderation; **native OIDC (MAS) → Röbel ID logs users in** exactly like it fronts Nextcloud | **now** (coexist/adopt, don't build) |
| **AI-human & agent chat + payments** | **XMTP** | **already live in the app** (dual-rail DMs); agents already have Gnosis smart accounts = **native XMTP identity (ERC-1271)**; mature `@xmtp/agent-sdk`; **in-chat Röbel Münzen / on-chain settlement** | **now** (extend what exists) |
| **Agents-as-equals workplace** (the "future of work") | **Nostr / Buzz** | most advanced *concept* (agents = keypair members, one signed log, ACP/MCP, DVM job market, zaps); same smart-account key can derive the Nostr identity | **later — R&D bet**, revisit in ~2–4 quarters once Buzz matures past v0.x |

**Identity is the one unifier:** one secp256k1 **smart account** = XMTP identity (native, already true) +
Matrix login (via Röbel ID → MAS upstream OIDC) + optionally Nostr later (NIP-06 derive). This is the
highest-leverage build, and it's already approved/shipped (Röbel ID).

## Why not a single rail (each breaks a dimension we can't give up)
- **Matrix-only:** superb human workspace + openDesk-native, agents can be governed appservice bots — **but not wallet-native; no in-chat Münzen / on-chain settlement.** Loses the agent-economy.
- **XMTP-only:** wallet/agent-native + payments + already live — **but not a workspace** (DMs + flat groups only: no Spaces/threads/files/workflows/moderation) and doesn't coexist with openDesk. Wrong tool for human collaboration.
- **Nostr/Buzz-only:** the right *concept* — but **Buzz is v0.4.x, days old** (launched 2026-07-21): no DM E2E in the README, mobile/push unfinished, MLS-over-Nostr (Marmot/White Noise) audited but alpha, and it ignores openDesk. A 6–12 month bet, not a production platform.

## Why identity-not-bridge (the honest interop reality)
- **Matrix↔Nostr:** one dead 2022 PoC (`8go/matrix-nostr-bridge`); not in Matrix's bridge catalog.
- **Matrix↔XMTP:** does not exist.
- **XMTP↔Nostr:** does not exist (XMTP lists Nostr only as a future *linkable identity*, not a message bridge).
- Matrix is the bridge hub — but only to *centralized* apps (Slack/WhatsApp/Signal…), not to the other two decentralized protocols. **Do NOT architect around any cross-protocol message bridge.** Where two contexts must touch, build a **narrow, purpose-built connector** (e.g. an agent that also holds a Matrix appservice presence, or XMTP agent events surfaced into an Element room), not a general bridge.

### Identity unification — what's real vs aspirational
- **XMTP:** smart account is the inbox root **today** (ERC-1271; already the app's DM identity). Caveat: account must be deployed on the pinned chain (ERC-6492 for counterfactual); 10-installation cap.
- **Nostr:** secp256k1 keypair, derivable from the same seed (NIP-06 `m/44'/1237'`) or a wallet signature — but signs **Schnorr/BIP-340**, not Ethereum's ECDSA, so it's a **derived/linked** key, not literally the smart-account key. No ERC-1271-over-Nostr.
- **Matrix:** device keys are Curve25519/Ed25519, never secp256k1 — wallet participates **only** as an upstream OIDC factor (MSC3861/MAS, shipped 2026). "Röbel ID as MAS upstream" is the pattern; you build the IdP (done).
- Net: **"literally one key, three protocols" is aspirational; "one smart account as shared ROOT — native for XMTP+Nostr, bridged to Matrix via Röbel ID OIDC" is achievable now.**

## Build order
1. **Röbel ID (wallet→OIDC)** — the unifier. Live. Fronts Nextcloud/Collabora today; add it as a **MAS upstream OIDC provider** so it logs users into Matrix/Element too; it's already the XMTP identity.
2. **Human collaboration = adopt/coexist with openDesk's Element (Matrix)**, wired to Röbel ID via MAS. **No custom chat build.** For orgs, surface it as a **group-gated SSO tile** (Element room per org) in the org dashboard — same pattern as the Nextcloud/Collabora tiles.
3. **XMTP = the agent + payments rail.** Extend Mecky / Fördermittel / outbound agents onto `@xmtp/agent-sdk` where they should be first-class in chat and move Münzen. Lowest marginal cost (already shipped in Expo).
4. **Later / R&D — evaluate Buzz/Nostr** for a true agent-native workplace (DVM job market + zaps + git/workflow + portable agent reputation). Same smart-account key → Nostr identity. Strategic option, not a commitment.
5. **No cross-protocol message bridge** in the architecture — per-context connectors only, unified by Röbel ID.

## Honest caveats (track these)
- **XMTP:** `libxmtp` still "Alpha" (breaking revisions); the **network is centralized today** (Ephemera-run; you cannot self-host a production node yet; decentralized mainnet ~roadmap). Payments/agent-SDK are shipped; "autonomous multi-agent settlement" is vendor roadmap.
- **Matrix:** **MLS not shipped** (still PoC — don't count on Matrix-MLS↔XMTP-MLS interop); Element X mid-transition (Spaces read-only, Threads in Labs); AGPLv3 (fine for this AGPL repo).
- **Nostr/Buzz:** v0.4.x; no DM E2E in Buzz's README yet; human-team-chat maturity trails Matrix; GDPR erasure is hard on an append-only signed log.
- **Nextcloud/Element hosting** is real ops (Synapse + Element + Nordeck widgets; Hetzner-friendly, EU-clean) — the SSO tiles are config-gated so the app ships without blocking on it.

## Implication for the org collaborative suite (Slice 2)
- **Shared files + collaborative docs → Nextcloud group folder + Collabora**, group-gated SSO tiles.
- **Human org chat → Element/Matrix room per org**, group-gated SSO tile (Röbel ID → MAS OIDC).
- **Agent/AI-human chat → XMTP** (already in-app), agents = smart-account identities; Münzen in chat.
- **Nostr/Buzz → tracked**; revisit for the agents-as-equals workplace when it matures.
- All surfaced in the org `/dashboard` as the org "Arbeitsbereich", gated by the keystone's `org:<accountId>:<role>` group claim. Reuse-don't-rebuild throughout.
