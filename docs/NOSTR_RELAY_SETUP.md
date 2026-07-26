# Nostr Relay Setup

**Date:** 2026-07-26
**Status:** R&D runbook. Nostr/Buzz is the tracked research bet from the
[chat-protocol decision](future-research/2026-07-26_CHAT_PROTOCOL_DECISION.md)
(poly-protocol, unified by identity). Not a production dependency yet.

"A relay" can mean two different things for us: a **bare Nostr relay**, or the
**Buzz workspace-on-a-relay** (the agents-as-members model). This runbook covers
both, plus how either ties back to Röbel ID.

---

## Which to run

- **Prototyping the agents-as-members workplace (the north star)?** → run
  **Buzz** — it *is* a Nostr relay plus the Slack/GitHub-for-agents workspace on
  top. This is the R&D bet from the decision doc.
- **Want a general-purpose relay** (agent experiments, NIP-29 group channels, or
  the community's own relay)? → run **strfry** (the standard, production-grade
  C++ relay).

Both self-host cleanly on **Hetzner** (our sovereign-infra direction) — EU data
residency, we own it.

---

## Path A — bare relay (strfry), ~20 min

On a Hetzner box (Debian/Ubuntu) with Docker installed:

```bash
mkdir -p /opt/strfry/strfry-db && cd /opt/strfry
# minimal strfry.conf (db path + relay info)
cat > strfry.conf <<'CONF'
db = "/app/strfry-db/"
relay {
  bind = "0.0.0.0"
  port = 7777
  info { name = "Röbel Relay"; description = "Sovereign community relay"; }
  writePolicy { plugin = ""; }   # add an allow-list plugin later to gate writes
}
CONF
docker run -d --name strfry -p 127.0.0.1:7777:7777 \
  -v /opt/strfry/strfry.conf:/etc/strfry.conf \
  -v /opt/strfry/strfry-db:/app/strfry-db \
  ghcr.io/hoytech/strfry:latest relay
```

Then put **TLS + `wss://`** in front (relays must be `wss`):

```bash
# Caddy (auto Let's Encrypt). DNS: relay.roebel.app -> the box first.
cat > /etc/caddy/Caddyfile <<'CADDY'
relay.roebel.app {
  reverse_proxy 127.0.0.1:7777
}
CADDY
systemctl reload caddy
```

Test it with `nak` (the "nostr army knife"):

```bash
nak relay wss://relay.roebel.app                              # shows relay info (NIP-11)
nak event -c "hello sovereign relay" wss://relay.roebel.app  # publish
nak req -k 1 wss://relay.roebel.app                          # read it back
```

**For team-channel-like membership** (relay-enforced groups, closest to Slack
channels), run a **NIP-29 groups relay** instead of vanilla strfry — e.g.
`verse-pbc/groups_relay`. That is what you want for org group chat on the Nostr
side.

---

## Path B — Buzz (relay + agent workspace)

```bash
git clone https://github.com/block/buzz && cd buzz
. ./bin/activate-hermit          # provisions the toolchain
just setup && just build && just dev   # relay (ws://localhost:3000) + desktop app
```

Production (self-host): use the bundle in `deploy/compose/` — `docker compose up`
brings up the relay + **Postgres + Redis + MinIO (Blossom media)** + optional
Caddy/TLS. One relay = one workspace = the single source of truth; self-host it
on Hetzner for full sovereignty.

---

## How it ties to Röbel ID (the identity unifier)

- An agent (or human) on the relay uses a **secp256k1 Nostr key derived from
  their smart account** — sign a fixed message with the wallet, then derive the
  Nostr key (Nostr-Wallet-ID pattern), or BIP-39 / NIP-06 from the same seed.
  That maps `wallet ↔ npub`, so the same Röbel identity works on Nostr.
  **Caveat:** Nostr signs **Schnorr**, Ethereum signs **ECDSA** — it is a
  *derived / linked* key, not literally the smart-account key.
- Gate writes with an **allow-list plugin** keyed to our members (or NIP-29
  relay-enforced membership) so it is *our* community's relay, not open to the
  world.

---

## Honest caveats

- **Buzz is v0.4.x, days old** — great for prototyping the agents-as-members
  model, not a production daily-driver yet (no DM E2E in the README; mobile /
  push unfinished).
- A relay is an **append-only signed log** → plan GDPR erasure / retention
  explicitly (NIP-09 delete-requests are advisory; relays may ignore them). For
  citizen-linked data this matters.
- E2E group chat on Nostr (MLS / Marmot / White Noise) is **audited but alpha** —
  do not rely on it for sensitive groups yet.
