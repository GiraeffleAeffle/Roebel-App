# State of the Netizen Node

**Last verified: 2026-07-28**, by reading the running node. Part of the
[documentation index](README.md); see also
[State of the Netizen Stack](STATE_OF_THE_NETIZEN_STACK.md) and
[State of Nostr](STATE_OF_NOSTR.md).

Röbel's sovereign node is **Genesis Node #1**: the machine the community actually owns,
running the workspace, comms and federation services. Identity (Röbel ID) deliberately
stays on Fly, so the box itself needs very few secrets.

---

## 1. The machine

| | |
|---|---|
| Host | Hetzner CPX42 — 8 vCPU, 16 GB, 320 GB |
| OS | Ubuntu 26.04 LTS |
| Region | Falkenstein (eu-central) — EU data residency |
| IPv4 | `178.105.19.80` |
| Access | `ssh root@178.105.19.80` (ed25519, passphrase-protected) |
| Backups | on |
| Stack root | `/opt/netizen/roebel/` (docker compose) |

DNS is at **IONOS**, not Vercel or Hetzner. A records for `*.roebel.app` that point at the
node are edited there.

## 2. What runs on it

Verified live 2026-07-28:

| Container | Image | Serves |
|---|---|---|
| `roebel-caddy-1` | `caddy:2` | TLS + reverse proxy for every subdomain |
| `roebel-strfry-1` | `strfry` | the **authoring** Nostr relay, members-only writes |
| `roebel-relay-sync-1` | `node:22-alpine` | onchain membership → relay write access |
| `roebel-synapse-1` | Synapse | Matrix homeserver |
| `roebel-mas-1` | MAS | Matrix auth, OIDC upstream to Röbel ID |
| `roebel-element-1` | Element | Matrix web client |
| `roebel-nextcloud-1` | Nextcloud | files |
| `roebel-collabora-1` | Collabora | collaborative documents |
| `roebel-postgres-1` | `postgres:16` | shared database for the above |
| `roebel-mirror-1` | `strfry` | the **federation mirror**, read-only |
| `roebel-federation-1` | `strfry` | pulls declared peers into the mirror |
| `testnode-strfry` | `strfry` | **node #2** — its own members-only relay |
| `testnode-mirror` | `strfry` | node #2's federation mirror |
| `testnode-federation` | `strfry` | node #2 pulling Röbel |

## 3. Public endpoints

| URL | Status 2026-07-28 |
|---|---|
| `wss://relay.roebel.app` | 200 — authoring relay |
| `https://cloud.roebel.app` | 302 — Nextcloud |
| `https://chat.roebel.app` | 200 — Element |
| `https://id.roebel.app/.well-known/openid-configuration` | 200 — Röbel ID (on **Fly**, not this box) |

## 4. Secrets

Secrets live in `/opt/netizen/roebel/.env` (mode 600) and **never** in the repo or a
rendered bundle. The manifest references them by name only, which is what makes it safe to
publish and sign.

Present today: `POSTGRES_PASSWORD`, `MATRIX_CLIENT_SECRET`, `NEXTCLOUD_CLIENT_SECRET`,
`SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `GNOSIS_RPC`, plus Synapse/MAS secrets.

`SUPABASE_SERVICE_KEY` bypasses RLS on the entire project — it is the most powerful
credential on the box, and it is there because the relay allow-list syncer reads the private
wallet↔npub registry. Treat it accordingly.

## 5. Reproducing it

The node is meant to be rebuildable from its manifest, not from memory:

```bash
netizen render <manifest>   # manifest -> deployable bundle
netizen doctor              # check the declaration against reality
netizen up --host           # rsync the bundle, run the idempotent bootstrap
```

Anything configured on the box but **not** declared in the manifest is drift. It will not
survive a rebuild and will not exist on a fork. When you add a service by hand, add it to
the manifest in the same change.

## 6. Operational gotchas

These each cost a debugging cycle. All are now handled by the installer, but they explain
why parts of it look the way they do.

- **The strfry binary is at `/app/strfry`**, not on `$PATH`.
- **strfry's config parser rejects the compact `info { name = "x"; description = "y"; }`
  form** that older docs showed. Keys must be on their own lines.
- **A write-policy script without the exec bit makes strfry fail *closed*** — it blocks
  every event while the relay still looks healthy and the allow-list looks correct. The most
  expensive kind of failure, because every visible signal says fine.
- **A fresh docker volume is root-owned** while strfry runs as uid 1000, so a new store
  fails with `mdb_env_open: Permission denied`. Chown the volume to `1000:1000`.
- **`--env-file` is read at container-create time.** Editing `.env` then running
  `docker restart` does nothing; the container must be recreated.

## 7. Known gaps

- **Node #2 is on the same box.** It proves the protocol, not independence. The
  concentration ratio stays 1 until an outside operator runs one.
- **Node #2's containers are not compose-managed.** It now runs from its own rendered
  manifest (`packages/protocol/examples/testnode.netizen.json`) with its own members-only
  relay and federation mirror, but the containers were started with `docker run`.
- Synapse and MAS have needed attention; check them before relying on Matrix.
