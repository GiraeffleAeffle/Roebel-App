# Nostr write policy — CitizenNFT-only

A [strfry write-policy plugin](https://github.com/hoytech/strfry/blob/master/docs/plugins.md)
for a Netizen node's Nostr relay: **reads are open to everyone; only Röbel
CitizenNFT holders may publish (write).** This is the v1 policy — broader access
and other policies (per-kind, per-org, paid-write via x402) come later.

## Files

| File | Runs where | What |
|---|---|---|
| `citizen-write-policy.sh` | in the strfry container | the plugin strfry invokes (`#!/bin/sh` → `exec awk -f policy.awk`) |
| `policy.awk` | in the strfry container | per-event decision: accept iff the author pubkey is in the allow-list; else reject. Re-reads the allow-list per event (live grants/revokes) and `fflush()`es so strfry never blocks on a buffered pipe |
| `citizens.txt` | mounted read-only | the allow-list: one lowercase 64-hex Nostr pubkey per line (`#` comments ignored) |
| `add-citizen.sh` | on the host | append a pubkey to the allow-list (live; no relay restart) |

## How the allow-list is populated (the identity bridge)

A Nostr pubkey is **secp256k1 Schnorr / x-only** — not an Ethereum address — so a
Citizen's Nostr key is **derived from their wallet** (sign a fixed message → derive
the Nostr key, NIP-06 style) and registered. To grant write access, a pubkey must:

1. be derived from / linked to a wallet, and
2. that wallet holds a **CitizenNFTv2** on Gnosis.

v1 populates the list manually (`add-citizen.sh`) / from a small registry; the app
will auto-populate it (derive each Citizen's Nostr key on setup, verify the on-chain
CitizenNFT, write the allow-list). Revoking a CitizenNFT → remove the line.

## Deploy (how it's wired on the Röbel node)

Mount the **directory** (not individual files) into the strfry container, and point
`strfry.conf` at the plugin:

```
# strfry.conf
relay { ... writePolicy { plugin = "/etc/strfry/citizen-write-policy.sh" } }
```
```bash
docker run -d --name strfry --restart unless-stopped --network netizen -p 7777:7777 \
  -v /root/strfry.conf:/etc/strfry.conf \
  -v /root/strfry-policy:/etc/strfry:ro \      # DIRECTORY mount — see gotcha
  -v strfry_db:/app/strfry-db \
  ghcr.io/hoytech/strfry:latest relay
```

**Gotcha (learned the hard way):** bind-mount the *directory*, never the single
`citizens.txt` file. Editors/`sed -i` replace the file's inode, and a single-file
bind mount keeps pointing at the old inode — so revokes silently don't take effect.
A directory mount resolves by name each read, so grants (`>>`) *and* revokes
(`sed -i`) are live.

## Grant / revoke

```bash
/root/strfry-policy/add-citizen.sh <64-hex-nostr-pubkey>     # grant (live)
sed -i '/^<pubkey>$/d' /root/strfry-policy/citizens.txt      # revoke (live)
```

## Verified

- non-Citizen publish → `blocked: only Roebel CitizenNFT holders may publish`
- granted pubkey → `success`; after revoke → blocked again; reads open throughout.

## Follow-ups

- Wire into `netizen render` from a manifest field (`services.chat.nostr.writePolicy`).
- Auto-populate the allow-list from CitizenNFTv2 holders' derived Nostr keys.
- Broader/other policies: read-auth (NIP-42) for private events, per-kind rules,
  x402 paid-write for external agents.
