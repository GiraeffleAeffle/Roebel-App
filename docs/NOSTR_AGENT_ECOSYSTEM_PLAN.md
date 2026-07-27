# Nostr + AI-Agent Open Ecosystem — State, Migration, and Buzz-like Workspace

**Date:** 2026-07-26
**Audience:** a builder agent with zero prior context. This is a self-contained handoff
to (a) understand what is live, (b) migrate Röbel's data toward Nostr + decentralized
storage, and (c) build a Buzz-like workspace where **humans and AI agents operate as
peers in one open ecosystem**.
**Read alongside:** [chat-protocol decision](future-research/2026-07-26_CHAT_PROTOCOL_DECISION.md),
[Nostr relay setup](NOSTR_RELAY_SETUP.md), the write policy
[`packages/cli/policies/nostr-citizen-write/`](../packages/cli/policies/nostr-citizen-write/README.md),
the [Netizen Node manifest](superpowers/specs/2026-07-26-netizen-node-manifest.md).

---

## 0. The thesis (why Nostr)

Röbel is a **sovereign node**; the goal is *many* such nodes (individuals, businesses,
clubs, institutions, AI agents — see `manifest.type`). Nostr fits because it is **many
sovereign relays with key-only identity**, not one global network. Each node runs its own
relay (its data plane); nodes federate through **identity**, and data becomes **openly
indexable** or **x402-metered** so agents across nodes can read, pay, exchange signals,
and coordinate. Farcaster (on-chain FID + globally-replicated Snapchain, public-broadcast
only) is the wrong shape for community-scoped, mostly-private, GDPR-bound civic data — we
adopt its *patterns* (signed data, Frames/mini-apps), not its foundation.

---

## 1. What is LIVE right now

**Sovereign node:** Hetzner CPX42 (8 vCPU / 16 GB / 320 GB), Ubuntu, Falkenstein.
IPv4 `178.105.19.80`. Docker installed. SSH `root@178.105.19.80` (key
`~/.ssh/id_ed25519`, passphrase — `ssh-add` it).

**Nostr relay (strfry):**
- Container `strfry` (`ghcr.io/hoytech/strfry:latest relay`), `-p 7777:7777`, config
  `/root/strfry.conf`, DB volume `strfry_db`.
- **TLS: `wss://relay.roebel.app`** via a `caddy:2` container (ports 80/443, docker
  network `netizen`, `reverse_proxy strfry:7777`, `/root/Caddyfile`, Let's Encrypt cert).
  Raw `ws://178.105.19.80:7777` also works.
- DNS `roebel.app` is at **IONOS** (`ns*.ui-dns.*`) — add records there, not Hetzner.
- Deployed from `netizen render` (see the [installer](superpowers/specs/2026-07-26-netizen-node-installer.md)).

**Write policy — CitizenNFT-only (v1):** reads open; writes accepted only if the author
Nostr pubkey is in the allow-list. busybox-`awk` strfry plugin, re-reads the list per
event + `fflush()`. Files in `/root/strfry-policy/` (versioned at
`packages/cli/policies/nostr-citizen-write/`). Grant: `add-citizen.sh <hexpubkey>`
(live). Revoke: `sed -i` the line (live). **Mount the DIRECTORY** `/root/strfry-policy
→ /etc/strfry:ro`, never single files (inode gotcha). Allow-list currently **empty** →
no one writes until a Citizen registers a Nostr key.

---

## 2. The identity bridge (wallet / smart account → Nostr)

Nostr identity = **secp256k1 Schnorr (BIP-340), x-only pubkey**. Ethereum = ECDSA on the
same curve — so an Ethereum address/signature is **not** a Nostr key. A smart account
(ERC-4337) has **no private key of its own** (it's a contract). Therefore:

- Derive a **stable Nostr keypair from the controlling signer** behind the smart account
  (the thirdweb/Netizen enclave/passkey key): sign a fixed canonical message → hash →
  Nostr privkey (NIP-06 style). Deterministic ⇒ same wallet always yields the same npub.
- Register the mapping `smart-account address ↔ npub` (in the node's Postgres, and/or as
  a signed Nostr profile event referencing the address).
- **On-chain gating lives at the relay-policy layer**, not in Nostr: derive npub → verify
  the wallet holds `CitizenNFTv2` on Gnosis → add npub to the relay allow-list. This is
  the seam the write policy already implements.

**Build task:** an app-side flow (expo + web) that, on a Citizen's first Nostr use,
derives their npub from the wallet, verifies the CitizenNFT, and writes the allow-list
(replace the manual `add-citizen.sh` with an automated, on-chain-verified populator —
e.g., a small service or a cron that syncs CitizenNFTv2 holders' registered npubs).

---

## 3. Migration plan — Supabase → Nostr + decentralized storage

Nostr is an **append-only signed-event log**, not a database. Move what fits; keep the
rest. Target data-layer map:

| Data | Home | Notes |
|---|---|---|
| **Public / social** — feed posts, profiles, reactions, comments, public org content | **Nostr events** (relay) **+ an indexer** | signed, portable, openly indexable by agents; the payoff for "open data other agents consume" |
| **Media / blobs** | **Blossom** (Nostr-native) or self-hosted **MinIO** / IPFS | events stay small |
| **Private / relational / transactional** — accounts, memberships, ledgers, points, RLS-gated | **self-hosted Postgres on the node** (own it; drop managed Supabase) | Nostr has no joins/txns/consistency; deletion is advisory (NIP-09) → wrong for GDPR-erasable citizen data |
| **Consensus-critical** — identity NFTs, MACI votes, Safe treasury, Circles | **Gnosis (on-chain)** — already live | trust rails |

**Kinds mapping (suggested):** notes/posts → kind 1 (or a NIP-23 long-form for stories);
profiles → kind 0; reactions → kind 7; comments → kind 1 with `e`/`p` tags; DMs → NIP-17;
group/channel messages → **NIP-29** (relay-enforced groups) or NIP-28. Keep a stable
`d`-tag / app namespace for Röbel-specific kinds.

**The indexer (required — Nostr can't query):** a service that subscribes to the relay,
writes events into a queryable store (Postgres/Meilisearch), and exposes read APIs the
apps already use. Plan: dual-write during migration (write to both Supabase and the relay;
read from the indexer), then cut reads over, then retire the Supabase table.

**Phasing:**
1. **Identity bridge** (§2) so Citizens have npubs + the allow-list auto-populates.
2. **Public feed → Nostr**: dual-write posts/reactions/comments as events; stand up the
   indexer; switch the feed read path to the indexer. Media → Blossom/MinIO.
3. **Retire** the migrated Supabase tables; keep Postgres for private/relational.
4. **Cross-node / x402**: expose open data for free indexing + **x402-metered** endpoints
   for gated/premium data (thirdweb ships x402; pay in EURe/Circles per request).

---

## 4. Buzz-like workspace — humans + AI agents as peers, one open ecosystem

Buzz is "a Nostr relay + a Slack/GitHub-for-agents workspace on top." Recreate that shape
on **our** relay + identity, so **agents are first-class members, not tools**:

- **Channels/spaces** = **NIP-29** relay-enforced groups (closest to Slack channels);
  membership gated by the same CitizenNFT / org-group policy pattern as the write policy.
- **Agent identity** = each agent is a **smart account** (the Agent Runtime v0 already
  gives agents their own keypair, `client_credentials` login, RFC-8693 `act` delegation,
  Safe budget, kill-switch, audit) → derive its **npub** (§2) → it joins channels and
  publishes/reads events exactly like a human. Same primitive, same relay.
- **Agent workers** (manifest `ai.workers`) = long-running processes that subscribe to
  channel events, reason (LiteLLM gateway; Opus/Sonnet/Haiku routing; EU-GPU/EuroLLM for
  sovereignty tier), and act (post results, call MCP tools, spend within budget).
- **In-chat value** = payments/tips as events (Circles/EURe), and **x402** for
  agent-to-agent paid data/services.
- **One ecosystem** = because humans and agents share (a) the relay (data plane), (b) the
  identity model (smart account → npub), and (c) the money/governance rails (Gnosis), they
  interoperate natively. A human posts a task in a channel; an agent member picks it up,
  does work, posts back, gets paid — all signed Nostr events on the sovereign relay.

**Build tasks:**
1. Stand up a **NIP-29 groups relay** (e.g. `verse-pbc/groups_relay`) or extend strfry
   with group semantics; reuse the CitizenNFT/org-group gating.
2. A **workspace client** (web + expo): channels, threads, membership, human + agent
   participants, in-chat payments — or evaluate self-hosting **Buzz** (`block/buzz`,
   `deploy/compose/`: relay + Postgres + Redis + MinIO) as the reference.
3. **Agent worker runtime**: give an agent an npub, subscribe to its channels, wire the
   AI gateway + MCP tools + budget; A2A over Nostr (an agent's secp256k1 key also signs
   Nostr events — the transport-level interop with Buzz/Nostr from the decision doc).
4. **x402** endpoints for cross-node/agent data exchange.

---

## 5. Caveats / open questions (be honest with the user)

- **Deletion/GDPR on Nostr is weak** (NIP-09 advisory) — never put erasable citizen-private
  data on the relay; keep it in Postgres.
- **You must run an indexer** — Nostr doesn't query.
- **smart-account↔npub is a derived link** needing a registry + the derivation flow (not
  built yet).
- **Buzz is v0.4.x** (days old) — great to prototype the agents-as-members model, not a
  production daily-driver; treat as a bet.
- **x402 agent-data-markets are early** — thirdweb ships x402, ecosystem is nascent.
- NIP-29 group relays + E2E group chat (MLS/Marmot) are alpha — don't rely on them for
  sensitive groups yet.

---

## 6. Repo pointers

- Relay + policy: `packages/cli/policies/nostr-citizen-write/`, `docs/NOSTR_RELAY_SETUP.md`.
- Node manifest + installer: `packages/protocol/`, `packages/cli/`, the two specs dated
  2026-07-26.
- Identity keystone: `apps/roebel-id/` (Röbel ID OIDC; Agent Runtime on
  `feat/roebel-id-agent-runtime`).
- Chat/agents strategy: `docs/future-research/2026-07-26_CHAT_PROTOCOL_DECISION.md`.
- Live node ops state: memory `project_netizen_node_hetzner.md`.
