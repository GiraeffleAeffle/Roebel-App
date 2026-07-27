# Sovereign Node — Security Policy

**Date:** 2026-07-27 · **Scope:** the Röbel node (Genesis Node #1) and every Netizen
node the installer produces. Findings below come from an audit of the *live* box, not
a checklist.

> **Principle:** sovereignty means you own the infrastructure **and** the
> responsibility. A managed SaaS quietly does this work for you; a sovereign node
> does not. Every item here that can be automated belongs in the installer, so
> node #2 inherits the fix rather than repeating the mistake.

---

## 0. Current posture (audited 2026-07-27)

**Good:**
- Only **22, 80, 443** reachable from the internet. Postgres, Collabora and the
  Nostr relay are `expose`d to the compose network only — not published.
- TLS on every public surface (Caddy + Let's Encrypt, auto-renewing).
- `unattended-upgrades` **enabled** (host OS security patches).
- Secrets live in `/opt/netizen/roebel/.env`, `root:root`, mode `600`, and are
  **not** in the public repo (verified against full git history). The manifest
  schema *rejects* an inlined secret.
- SSH root login is `prohibit-password` (key only).
- Hetzner backups enabled.

**Gaps — ranked by real risk:**

| # | Finding | Risk | Fix |
|---|---|---|---|
| 1 | **The keystone is the crown jewel.** Compromise of `id.roebel.app` (or its JWKS private key) mints valid identities for *every* service on the node. | Critical | Treat its secrets as the highest tier; plan JWKS rotation; alert on unexpected deploys |
| 2 | **SSH `PasswordAuthentication yes`** | High | Set to `no` (you already use keys) + fail2ban |
| 3 | **No firewall; Docker bypasses `ufw`** | High | Hetzner **Cloud Firewall** (outside the box, so Docker can't bypass it) |
| 4 | **Local Nextcloud admin (`RoebelAdmin`) bypasses wallet identity** | High | Long unique password in a manager, 2FA, never used day-to-day |
| 5 | **Floating image tags** (`:latest`, `:stable`) | Medium | Pin digests; update deliberately |
| 6 | **Snapshot ≠ consistent DB backup**; restore never tested | Medium | Nightly `pg_dump`; **test a restore** |
| 7 | **Display name is an opaque hex id** | Medium (privacy/UX) | Emit a real `name` claim; see §4 |
| 8 | Secrets exist in two places (Fly + box), no rotation schedule | Medium | Document owners + rotation |

---

## 1. Blast radius: the keystone

One OIDC provider now gates Nextcloud, Matrix (soon), and everything else. That is
the *point* (one sovereign identity) and the **primary risk**.

- The **JWKS private key** signs every token. Anyone holding it can impersonate any
  citizen at any relying party. It lives in Fly secrets — never export it to a
  laptop, never paste it into a chat, never commit it.
- **Rotation:** plan it before you need it. Publish the new key in JWKS, sign with
  the old until clients refresh, then retire. Untested rotation during an incident
  is how outages become breaches.
- **Client secrets** (`nextcloud`, `matrix`) are per-relying-party. Rotating one
  must not require rotating all — keep them distinct (they are).
- **Watch for drift.** Twice already the keystone disagreed with the manifest
  (`ISSUER_URL`, `NEXTCLOUD_REDIRECT_URIS`) and it surfaced as a cryptic login
  error. `netizen doctor` should compare live discovery + registered redirect URIs
  against the manifest. Drift is a security signal, not only a config bug.

## 2. Host hardening (do these)

```bash
# SSH: keys only
sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
systemctl reload ssh
apt-get -y install fail2ban && systemctl enable --now fail2ban
```

**Firewall — use Hetzner Cloud Firewall, not `ufw`.** Docker writes its own iptables
rules and **bypasses `ufw`**, so a published container port is exposed even when
`ufw` says "deny". A cloud firewall sits *outside* the host and cannot be bypassed.
Allow only **22, 80, 443** (add **UDP 10000** only if Jitsi lands).

## 3. Containers and supply chain

- Every image is a floating tag today. `:latest` silently pulls new code —
  convenient for patches, but it means **an upstream compromise reaches you
  automatically** and a redeploy is not reproducible.
- Pin by **digest** (`image: nextcloud@sha256:…`) and bump deliberately, or accept
  floating tags *knowingly* and re-pull on a schedule. Pick one; do not drift.
- Subscribe to advisories for: Nextcloud, Collabora, Synapse/MAS, Caddy, Postgres,
  strfry. The node is only as current as its slowest component.

## 4. Identity, privacy and citizen data

- **Usernames are hashed** (`user_oidc --unique-uid=1`), so the raw wallet address
  is not the Nextcloud login. Good.
- **But the display name is currently that same hex string**, because the keystone
  emits no `name` claim for this account. Other members see a hex blob in sharing
  dialogs — poor UX and an unnecessary correlatable identifier. Emit a real display
  name from the profile. (Project rule: never show raw wallet addresses in UI.)
- **Group claims are authorisation.** `org:<id>:<role>` decides who reads which
  group folder. Treat the claim pipeline as security-critical: a bug there is a
  data-access bug.
- **GDPR:** citizen files now sit on hardware you control in Germany — good for
  residency, and it makes you the **data controller**. You need: a retention
  policy, a deletion path that actually erases (including backups), and a
  processing record. Note the Nostr relay is **append-only** and NIP-09 deletion is
  advisory — never put erasable personal data on the relay.

## 5. Backups (the gap that bites hardest)

- A Hetzner snapshot of a **running** Postgres is crash-consistent, not
  transaction-consistent — it may restore into a corrupt database.
- Add a nightly `pg_dump` per database plus Nextcloud's data directory, stored
  **off the box** (a snapshot on the same provider is not a backup strategy).
- **Test the restore.** An untested backup is a belief, not a backup.

## 6. Operating rules

1. **No hand-patching the box.** Every change goes through the manifest + installer,
   or it is drift nobody can reproduce or audit.
2. **Secrets never leave their host.** Generate them on the box (as we did), read
   them only when a service needs them, never paste into chat/tickets/commits.
3. **Least exposure by default.** A service gets a published port only if the
   public genuinely needs it; otherwise `expose` + Caddy.
4. **Know your single points of failure:** keystone (identity), Caddy (all TLS),
   Postgres (most services), the box itself (everything). Document what breaks when
   each dies — before it dies.
5. **Watch the second node.** Multi-tenant Netizen Cloud changes the model
   completely: one operator holding many communities' data is a far larger target
   and a legal (processor) relationship. Do not carry these single-node assumptions
   into that product.

---

## Installer follow-ups (so node #2 inherits this)

- [ ] Render SSH hardening + fail2ban into `bootstrap.sh`
- [ ] Emit a cloud-firewall spec (or Hetzner API call) from the manifest
- [ ] Digest-pinning support in the manifest (`services.*.image`)
- [ ] Render a nightly `pg_dump` + off-box upload unit
- [ ] `netizen doctor`: diff live OIDC discovery + redirect URIs against the manifest
- [ ] `netizen doctor`: warn on published ports, floating tags, password SSH
