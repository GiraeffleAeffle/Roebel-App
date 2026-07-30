# State of the Netizen Node

**Last verified: 2026-07-29**, by reading the running node. Part of the
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

**Measured footprint (2026-07-30):** the full stack — 18 containers including Nextcloud,
Collabora, Matrix, Postgres, three relays and the indexer — uses **2.1 GiB RAM, 11 GB disk,
and rounds to 0% CPU**. The relay + mirror + indexer alone are under 100 MB combined. The box
is dramatically oversized for the civic stack, which is what makes a town-local mini-PC or a
€50 light mirror realistic — see [roadmap #19](ROADMAP_AND_DEFERRED.md); what would actually
consume a sovereign machine is local AI inference
([State of Sovereign AI §3](STATE_OF_SOVEREIGN_AI.md)).

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
| `roebel-indexer-1` | `node:22-alpine` | cross-node query API over both stores |
| `testnode-strfry` | `strfry` | **node #2** — its own members-only relay |
| `testnode-mirror` | `strfry` | node #2's federation mirror |
| `testnode-federation` | `strfry` | node #2 pulling Röbel |

## 3. Public endpoints

| URL | Status 2026-07-28 |
|---|---|
| `wss://relay.roebel.app` | 200 — authoring relay |
| `https://cloud.roebel.app` | 302 — Nextcloud |
| `https://chat.roebel.app` | 200 — Element |
| `https://index.roebel.app` | 200 — cross-node query API (public read) |
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
- **Caddy does not pick up a new Caddyfile on its own.** Shipping a route and setting DNS is
  not enough — `caddy reload` (or a restart) is what triggers certificate issuance. A new
  subdomain that returns nothing is usually this, not DNS.
- **A new service needing Postgres must be in `postgresDatabases()`**, or its role is never
  created. Matrix once failed with `password authentication failed for user "mas"` for exactly
  this reason: the entrypoint hook only fires on an empty data directory.

## 7. Backups, restore and leaving

A nightly systemd timer runs `ops/backup.sh` at 02:30, keeping 14 days under
`/var/backups/netizen/<timestamp>/`. Each run writes `ops/status.json` so an agent can read
the node's health without a human.

It captures every live database — `nextcloud`, `synapse`, `mas`, `indexer` — plus the
Nextcloud data tree, the strfry event export and the relay allow-list. It does **not** capture
`.env`; secrets are copied by hand at export time, deliberately, so dumps at rest hold no keys.

**Verified 2026-07-29, on the live node, not in theory:**

- **Restore works.** All 18 indexer rows were deleted outright, then recovered from the dump to
  the same count. The indexer was the chosen target because it is derived data — a broken
  restore path would have cost nothing to discover.
- **Exit works.** A clean-room stack (fresh LMDB, fresh Postgres, empty policy directory) was
  built from backup output alone and passed all five checks in `EXPORT_AND_RELAUNCH.md` (in the
  Netizen Labs repo) — including the sharpest one, where a proof link created before the move
  still resolved through the rebuilt index.
- **Identity survives.** Mecky's key was re-derived from `NODE_AGENT_SECRET` by a script sharing
  no code with `@netizen-labs/nostr`, and matched the live pubkey exactly. This is what makes
  the managed tier's exit non-lossy, and it is why that secret must be escrowed to the
  community at setup rather than held only by a host.

The half that is **not** backed up is the half that rebuilds itself: the federation mirror
re-syncs from peers, the index re-reads the relays, Caddy re-issues its certificates. That is
the practical payoff of treating the protocol as the source of truth — an export is small.

## 8. Known gaps

- **Backups are on-box only.** `offsite` reports `unconfigured`, so every dump shares the fate
  of the machine it protects. `ops/backup.sh` warns on each run and `status.json` says so,
  because silence here would read as safety. Closing it means setting
  `BACKUP_RESTIC_REPOSITORY` / `BACKUP_RESTIC_PASSWORD`.
- **The agent watcher is not in the manifest.** It is the one service started by a hand-written
  `agent-watcher/up.sh` rather than declared and rendered like everything else — which is
  exactly the drift §5 warns about, and it is *why* a stray duplicate container was possible at
  all. It will not survive a rebuild and will not exist on a fork. Declaring it is the fix.
- **A duplicate Mecky watcher is still running.** A one-shot `docker run` from 2026-07-28
  (container `great_galileo`) never exited and has polled alongside `roebel-agent-watcher`
  since. It answered nothing — the `already-answered` bound refused every duplicate — and since
  the 2026-07-29 key rotation it holds the *retired* secret, whose pubkey is no longer on the
  allow-list, so it cannot publish at all. It still spends Anthropic tokens thinking. Remove
  with `docker rm -f great_galileo`.
- **Node #2 is on the same box.** It proves the protocol, not independence. The
  concentration ratio stays 1 until an outside operator runs one.
- **Node #2's containers are not compose-managed.** It now runs from its own rendered
  manifest (`packages/protocol/examples/testnode.netizen.json`) with its own members-only
  relay and federation mirror, but the containers were started with `docker run`.
- Synapse and MAS have needed attention; check them before relying on Matrix.
