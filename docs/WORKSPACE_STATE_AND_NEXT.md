# Röbel Sovereign Node — what is live, what remains

**Date:** 2026-07-27 · **Audience:** an agent (or human) who must finish the workspace
so real users can test it. Self-contained; assumes no memory of the session that built it.

---

## 1. The node

| | |
|---|---|
| Host | Hetzner **CPX42** (8 vCPU / 16 GB / 320 GB), Ubuntu, Falkenstein |
| IPv4 | **178.105.19.80** |
| SSH | `root@178.105.19.80`, key `~/.ssh/id_ed25519` (passphrase — run `ssh-add` first) |
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
It is safe to re-run. **Secrets never pass through the CLI** — the box's `.env` supplies them.

## 2. LIVE and verified

| Service | URL | Notes |
|---|---|---|
| **Identity keystone** | `https://id.roebel.app` | panva OIDC on **Fly** (not the box). Wallet login (thirdweb smart account, Gnosis) + Google/Apple/Facebook/email. Discovery 200, issuer correct. |
| **Nextcloud + Collabora** | `https://cloud.roebel.app` | Files live. **SSO works** — verified end to end with a Google login landing in Nextcloud. Apps installed: `user_oidc`, `groupfolders`, `richdocuments`. |
| **Nostr relay** | `wss://relay.roebel.app` | strfry behind Caddy/TLS. **Members-only writes** (CitizenNFT allow-list, currently empty = nobody writes). Reads open. Raw port 7777 is **closed**. |
| **TLS / routing** | Caddy | Auto Let's Encrypt for every declared host. |
| **Postgres** | internal | Per-service role+database created by a rendered init script. |

Running containers: `caddy`, `nextcloud`, `collabora`, `postgres`, `strfry`
(`cd /opt/netizen/roebel && docker compose ps`).

## 3. NOT done — the work that remains

Ordered by what unblocks user testing fastest.

### 3.1 Collabora routing (blocks live document editing) — **small**
Collabora runs but **Caddy has no route to it**, so Nextcloud Office cannot reach the
editor. `richdocuments.wopi_url` was set to `https://cloud.roebel.app/collabora`,
which currently 404s.
- Fix in `packages/cli/src/render.ts` (never hand-patch the box): either a dedicated
  host (`office.roebel.app` → `collabora:9980`, needs a DNS record) or path-based
  proxying on `cloud.roebel.app` for Collabora's paths (`/browser`, `/hosting/discovery`,
  `/cool`). Then set `wopi_url` to match and verify a document opens.

### 3.2 Display name is a hex blob — **small, user-visible**
The keystone emits no `name` claim, so a citizen appears in Nextcloud as
`2f36e31e1cd8…`. Usernames are hashed (good — the raw address is not exposed), but the
**display name** must come from the profile. Fix in `apps/roebel-id/src/claims/`.
Project rule: never show raw wallet addresses in UI.

### 3.3 Per-org group folders — **medium; the actual org feature**
`groupfolders` is installed but no folder exists. The design: one Nextcloud group
folder per org, ACL'd to the `org:<accountId>:<role>` claim the keystone already emits,
so joining an org grants the shared folder and leaving revokes it.
- Provision from the org registry (idempotent, create-if-absent) and render it into
  the installer. See `docs/WORKSPACE_SSO_SETUP.md` §A4.

### 3.4 Matrix (chat) — **large; currently removed from the manifest**
Synapse/MAS/Element are modeled but **not deployed**, because the installer renders
only a fragment of MAS config and **no `homeserver.yaml` at all** — they would
crash-loop. Deliberately removed from `roebel.netizen.json` rather than ship broken.
- Generate a real `synapse/homeserver.yaml` (Postgres, `server_name: roebel.app`,
  MSC3861 delegation to MAS) and a complete `mas/config.yaml` (database, secrets,
  upstream OIDC = the keystone).
- The keystone already has `MATRIX_CLIENT_ID/SECRET/REDIRECT_URIS` set, and the
  Postgres init script already creates `synapse` + `mas` databases when Matrix is declared.
- Then re-add `services.chat.matrix` to the manifest and `netizen up`.

### 3.5 openDesk suite: XWiki, Jitsi, OpenProject, Open-Xchange — **large**
Compose blocks exist but are **scaffolds** (Jitsi needs prosody/jicofo/jvb + UDP 10000;
OX needs an IMAP/SMTP backend). Removed from the manifest for the same reason. Each
needs real config generation + an OIDC provider wired to the keystone.

### 3.6 Nostr allow-list has no members — **blocks relay usage**
Writes are gated to CitizenNFT holders, and the list is empty by design, so **no one
can publish**. A parallel session shipped `@netizen-labs/nostr` +
`@netizen-labs/relay-sync` (derive npub from the wallet signer, verify on-chain
holding, sync the allow-list) — **verified working** (cross-checked against `nak`;
a signed event reached the live relay and was rejected only by policy). Remaining:
deploy the syncer to the box and let citizens register.

### 3.7 Security hardening — **see `docs/NODE_SECURITY_POLICY.md`**
Highest value, quick: disable SSH `PasswordAuthentication`, add fail2ban, enable the
**Hetzner Cloud Firewall** (22/80/443 — `ufw` is bypassed by Docker), nightly
`pg_dump` off-box **with a tested restore**, pin image digests.

### 3.8 `netizen doctor` drift check — **small, high leverage**
Manifest↔keystone drift caused two confusing outages this session (`ISSUER_URL`, and
`NEXTCLOUD_REDIRECT_URIS`), each surfacing only as a cryptic login error. `doctor`
should fetch live OIDC discovery + registered redirect URIs and diff them against the
manifest, before a human clicks anything.

## 4. Known gotchas (learned the hard way — do not rediscover)

1. **Mount the strfry policy DIRECTORY**, never the single `members.txt` file. `sed -i`
   replaces the inode, so a single-file bind mount silently ignores live revokes.
2. **The keystone is external** (`identity.idp.hosted: "external"`). The installer must
   not start a second one — that would shadow the real issuer.
3. **Postgres creates only the default superuser.** Every service needs its own
   role+database, or you get `password authentication failed for user "nextcloud"`.
   Synapse additionally requires `C` collation + `template0`.
4. **`docker compose` plugin ≠ docker engine.** Check them separately in bootstrap.
5. **Fly's CNAME target is app-scoped** (`0pko0lo.roebel-id.fly.dev`), not the bare
   `roebel-id.fly.dev`; the bare one never validates.
6. **Two A records for one host** = requests land on the wrong server ~half the time
   and TLS issuance fails intermittently.
7. **Run `fly deploy` from `apps/roebel-id/`**, not the repo root — otherwise the build
   context is 30 GB and the Dockerfile is not found.
8. **Commit with pathspecs.** `git commit` commits the *whole index*; this repo often has
   another agent's staged work in it.

## 5. Definition of "ready for users"

- [ ] A citizen logs in with their wallet and sees their **name**, not a hash
- [ ] They can upload a file and **co-edit a document** (Collabora working)
- [ ] An org's members share a **group folder**, gated by the org claim
- [ ] Chat works (Matrix) **or** is honestly absent from the UI
- [ ] Citizens can publish to the relay (allow-list synced)
- [ ] Backups run **and a restore has been tested**
- [ ] Firewall on, SSH password auth off
- [ ] `netizen doctor` is clean
