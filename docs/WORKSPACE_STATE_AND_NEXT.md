# Röbel Sovereign Node — what is live, what remains

**Date:** 2026-07-27 (second revision, same day) · **Audience:** an agent (or human) who
must finish the workspace so real users can test it. Self-contained; assumes no memory
of the sessions that built it.

> **Every claim below was checked against the live box on 2026-07-27**, not carried over
> from the previous revision. Three items the earlier revision listed as open had already
> shipped in `93e7bc52` — if this doc and the box ever disagree again, **the box wins**.

---

## 1. The node

| | |
|---|---|
| Host | Hetzner **CPX42** (8 vCPU / 16 GB / 320 GB), Ubuntu, Falkenstein |
| IPv4 | **178.105.19.80** |
| SSH | `root@178.105.19.80`, key `~/.ssh/id_ed25519` (passphrase — run `ssh-add` first). **Password auth is now OFF** |
| Deploy dir | `/opt/netizen/roebel/` (the rendered bundle + `.env`) |
| Secrets | `/opt/netizen/roebel/.env` — `root:root`, mode `600`, **generated on the box**, never in git |
| Manifest | `packages/protocol/examples/roebel.netizen.json` |
| Installer | `packages/cli` (`netizen render` / `up` / `doctor`) |

**Deploy command** (from the repo root, ssh key loaded):
```bash
pnpm --filter @netizen-labs/cli exec tsx src/cli.ts up \
  "$PWD/packages/protocol/examples/roebel.netizen.json" --host root@178.105.19.80
```
`up` = rsync the rendered bundle to the box, then run the idempotent `bootstrap.sh`.
Safe to re-run. **Secrets never pass through the CLI** — the box's `.env` supplies them.

## 2. LIVE and verified

| Service | URL | Verified |
|---|---|---|
| **Identity keystone** | `https://id.roebel.app` | discovery `200`; `netizen doctor` reports **no drift** against the manifest |
| **Nextcloud** | `https://cloud.roebel.app` | `status.php` `200`; SSO end-to-end |
| **Collabora** | same host, `/browser` `/hosting/discovery` `/cool` | `/hosting/discovery` returns the WOPI XML **through Caddy** |
| **Nostr relay** | `wss://relay.roebel.app` | NIP-11 `200`, strfry 1.1.0. Members-only writes; reads open. Raw 7777 closed |
| **TLS / routing** | Caddy | auto Let's Encrypt for every declared host |
| **Postgres** | internal | per-service role+database from a rendered init script |
| **Backups** | `ops/` | nightly timer active; **a restore has been tested** — see §3 |

Containers: `caddy`, `nextcloud`, `collabora`, `postgres`, `strfry`, `relay-sync`
(`cd /opt/netizen/roebel && docker compose ps`).

**Sovereignty score — `netizen doctor` reports 5/8 layers under own control:**

```
✓ hosting        hetzner, eu-central — the installer can rebuild it elsewhere
✓ identity-issuer  id.roebel.app — the node owns its own OIDC issuer
✗ identity-keys  thirdweb — a third party mints citizen accounts
✗ data           supabase — the app's spine is not on the node
✓ workspace      Nextcloud/Collabora on the node
✓ comms          own relay
✗ ai             model calls egress off-node
✓ durability     nightly 02:30 + offsite declared
```

Track it with `netizen doctor <manifest>` (add `--json` for an agent runtime).

## 3. Durability — what exists now

Declared in the manifest under `operations` and rendered by the installer, so **node #2
inherits it** rather than repeating node #1's gap.

- **Nightly `netizen-backup.timer` at 02:30** (`Persistent=true`, so a night the box was
  off is caught at next boot). `journalctl -u netizen-backup.service`.
- **Postgres** via `pg_dump -Fc`, databases enumerated live. **Nextcloud** files + DB
  inside one maintenance window (with a `trap`, so a failed backup can never leave the
  town's cloud offline). **strfry** via its own exporter — never a live LMDB copy.
- **Restore tested 2026-07-27**, non-destructively into a scratch database:
  145 tables / 1 user / 202 filecache rows — exact match against live. Archive gzip OK.
  ```bash
  bash ops/restore.sh /var/backups/netizen/<stamp> --yes
  ```
- **`ops/status.json`** is the machine-readable result (written atomically; `ok` is false
  whenever `errors > 0`; a zero-byte dump counts as an error).

**Still on-box only.** `status.json` reports `"offsite": "unconfigured"` until both refs
exist in `/opt/netizen/roebel/.env` — see §4.1. That is deliberately loud: silence would
read as safety.

## 4. NOT done — the work that remains

Ordered by what unblocks real use fastest.

### 4.1 Off-box backups — **small, and the highest-value item on this page**
Local dumps protect against *corruption*, not against *losing the box*. Buy a **Hetzner
Storage Box** (BX11, ~€3.81/mo, 1 TB) and add to `/opt/netizen/roebel/.env`:
```
BACKUP_RESTIC_REPOSITORY=sftp:uXXXXXX@uXXXXXX.your-storagebox.de:/backups/roebel
BACKUP_RESTIC_PASSWORD=<long random string>
```
**Store that password somewhere you will still have if the box is gone** — without it the
backups are unreadable ciphertext. Then `bash ops/backup.sh` and confirm
`"offsite": "ok"`. Nothing else needs changing; the code path is already rendered.

### 4.2 The relay allow-list is still empty — **one secret away**
`strfry-policy/members.txt` contains **zero pubkeys** (only comments), so **nobody can
publish**. The syncer now runs as a compose service and fails with exactly one message:
```
missing required env var: SUPABASE_SERVICE_KEY
```
Add the Supabase **service-role** key to `/opt/netizen/roebel/.env` (never to git, never
into a chat), then:
```bash
cd /opt/netizen/roebel && docker compose up -d relay-sync && docker compose logs -f relay-sync
```
It then syncs on-chain CitizenNFTv2 membership into the allow-list every 5 minutes;
revocation follows automatically. Old hand-wired copy at `/root/relay-sync/` is now
**dead weight** — delete it once the compose service is confirmed working.

### 4.3 Hetzner Cloud Firewall — **small**
`ufw` is **inactive and would not help anyway**: Docker writes its own iptables rules and
bypasses it, so a published container port stays reachable regardless. Use the **Cloud
Firewall** (outside the host, unbypassable): allow **22, 80, 443** only. This is the one
hardening item the installer deliberately cannot do for you.

*Already done:* SSH password auth off (verified via `sshd -T`), fail2ban active — it had
already logged 53 failed SSH attempts, so the box is actively probed.

### 4.4 Per-org group folders — **DONE in code 2026-07-28, gated off**
`groupfolders` is installed but no folder exists. One Nextcloud group folder per org,
ACL'd to the `org:<accountId>:<role>` claim the keystone already emits, so joining an org
grants the shared folder and leaving revokes it. Provision from the org registry
(idempotent, create-if-absent) and render it into the installer.
See `docs/WORKSPACE_SSO_SETUP.md` §A4.

### 4.5 Matrix (chat) — **large; currently removed from the manifest**
Synapse/MAS/Element are modeled but **not deployed**: the installer renders only a
fragment of MAS config and **no `homeserver.yaml` at all**, so they would crash-loop.
Deliberately removed from `roebel.netizen.json` rather than ship broken.
- Generate a real `synapse/homeserver.yaml` (Postgres, `server_name: roebel.app`,
  MSC3861 delegation to MAS) and a complete `mas/config.yaml`.
- The keystone already has `MATRIX_CLIENT_ID/SECRET/REDIRECT_URIS`; the Postgres init
  script already creates `synapse` + `mas` databases when Matrix is declared.
- Read `docs/future-research/2026-07-26_CHAT_PROTOCOL_DECISION.md` first — the decision is
  poly-protocol unified by identity, not a message bridge.

### 4.6 openDesk suite: XWiki, Jitsi, OpenProject, Open-Xchange — **large**
Compose blocks exist but are **scaffolds** (Jitsi needs prosody/jicofo/jvb + UDP 10000;
OX needs an IMAP/SMTP backend). Removed from the manifest for the same reason. Each needs
real config generation + an OIDC provider wired to the keystone.

### 4.7 Pin image digests — **small**
Every image floats (`nextcloud:stable`, `caddy:2`, `postgres:16`, `collabora/code:latest`,
`ghcr.io/hoytech/strfry:latest`). Convenient for patches, but an upstream compromise
reaches the node automatically and a redeploy is not reproducible. Pin by digest and bump
deliberately, or accept floating tags *knowingly*. Pick one; do not drift.

### 4.8 The three non-sovereign layers — **large, strategic**
See §2's score. `identity-keys` (thirdweb) and `data` (Supabase) are the two that matter;
each has its own document:
- `docs/superpowers/specs/2026-07-27-thirdweb-independence.md` — kickoff spec
- `docs/future-research/2026-07-27_DATA_SOVEREIGNTY_SUPABASE_EXIT.md` — staged exit plan

## 5. Known gotchas (learned the hard way — do not rediscover)

1. **Mount the strfry policy DIRECTORY**, never the single `members.txt` file. `sed -i`
   replaces the inode, so a single-file bind mount silently ignores live revokes.
2. **`members.txt` is generated state, not bundle content.** `netizen up` rsyncs with
   `--delete`; without an exclude it overwrites the live allow-list with the empty stub
   and revokes write access for the whole town. Same for `ops/status.json`. Both are now
   excluded in `executor.ts`.
3. **Never pipe a long producer into `grep -q` under `set -o pipefail`.** `grep -q` exits
   at the first match, the producer takes SIGPIPE and returns 141, and `pipefail` promotes
   that to the pipeline status — so the test reads as "no match". This made the hardening
   script report "SSH password auth already off" while changing nothing, and it is
   *non-deterministic* (an interactive shell without `pipefail` matches fine). Capture into
   a variable and use `case`. **A security check that cannot measure must say so, never
   assume it is already compliant.**
4. **`strfry` is not on `PATH`** in the official image — call `/app/strfry`.
5. **The keystone is external** (`identity.idp.hosted: "external"`). The installer must
   not start a second one — that would shadow the real issuer.
6. **Postgres creates only the default superuser.** Every service needs its own
   role+database. Synapse additionally requires `C` collation + `template0`.
7. **`docker compose` plugin ≠ docker engine.** Check them separately in bootstrap.
8. **Caddy's Caddyfile is a bind mount.** `compose up -d` writes it without restarting,
   and `caddy reload` inside the container reported success while still serving the OLD
   routes. Restart the container (~1s) — the only reliable apply.
9. **Bare `handle` directives do not preserve written order** — use mutually exclusive
   `handle` blocks, or Collabora's paths fall through to Nextcloud and Office 404s.
10. **Fly's CNAME target is app-scoped** (`0pko0lo.roebel-id.fly.dev`), not the bare
    `roebel-id.fly.dev`; the bare one never validates.
11. **Two A records for one host** = requests land on the wrong server ~half the time and
    TLS issuance fails intermittently.
12. **Run `fly deploy` from `apps/roebel-id/`**, not the repo root — otherwise the build
    context is 30 GB and the Dockerfile is not found.
13. **Commit with pathspecs.** `git commit` commits the *whole index*; this repo often has
    another agent's staged work in it.

## 6. Definition of "ready for users"

- [x] A citizen logs in with their wallet and sees their **name**, not a hash
- [x] They can upload a file and **co-edit a document** (Collabora working)
- [x] Backups run **and a restore has been tested**
- [x] SSH password auth off, fail2ban active
- [x] `netizen doctor` is clean (no keystone drift)
- [ ] **Backups leave the box** (§4.1) ← highest value
- [ ] Citizens can publish to the relay (§4.2 — one secret)
- [ ] Cloud firewall on (§4.3)
- [x] An org's members share a **group folder**, gated by the org claim (§4.4) — built; see [SOVEREIGN_ARBEITSBEREICH_STATE.md](SOVEREIGN_ARBEITSBEREICH_STATE.md), not enabled until the RLS finding is fixed
- [ ] Chat works (Matrix) **or** is honestly absent from the UI (§4.5)
