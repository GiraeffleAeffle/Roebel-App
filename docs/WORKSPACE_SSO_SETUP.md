# Sovereign Workspace SSO — Production Setup

**Date:** 2026-07-26
**Goal:** Stand up the two workspace services the citizen/org dashboards link to —
**Nextcloud + Collabora** (files & collaborative docs) and **Matrix + Element**
(human chat) — both authenticated by the **Röbel ID** keystone (`id.roebel.app`)
and scoped by its group claims. This is the concrete, production build of the
architecture in the
[chat-protocol decision](future-research/2026-07-26_CHAT_PROTOCOL_DECISION.md)
and the [org-workspace spec](superpowers/specs/2026-07-26-org-workspace-suite-design.md).

> Everything self-hosts on **Hetzner** (sovereign infra). The dashboard tiles are
> config-gated: they stay hidden until the two env vars at the end are set, so the
> app ships fine before these services exist.

---

## 0. The model (why this works)

```
                         ┌──────────────────────────────┐
                         │   Röbel ID  (id.roebel.app)   │  OIDC IdP (panva) on Fly
                         │  wallet → SIWE → id_token with │  emits: sub, email, name,
                         │  groups: citizen | attester |  │  picture, groups[]
                         │          org:<accountId>:<role>│
                         └───────────────┬──────────────┘
                    OIDC auth/code        │        OIDC (via MAS upstream)
             ┌───────────────────────────┴───────────────────────────┐
             ▼                                                         ▼
   Nextcloud + Collabora                                     Matrix (Synapse) + MAS
   cloud.roebel.app                                          matrix/auth.roebel.app
   • user_oidc maps `groups`                                 • MAS maps `groups`
   • Group Folder per org, ACL = org:<id>:<role>             • Space/room per org
             ▲                                                         ▲
             └──────────────── Element Web (chat.roebel.app) ─────────┘
```

**One identity, two apps.** Röbel ID is the only place a user "logs in". The
`groups` claim (`org:<accountId>:<role>`) is the ACL: it maps to a Nextcloud
**group folder** and a Matrix **space** per org. Join an org → the claim appears →
access follows. Leave → it disappears. No per-app user management to build.

**Prereqs:** a Hetzner account, DNS control for `roebel.app`, and Röbel ID already
live at `id.roebel.app` (it is). One CPX31/CPX41 box comfortably hosts both stacks
to start; split later if load warrants.

---

## Part A — Nextcloud + Collabora (files & docs)

The existing dev walkthrough is
[`apps/roebel-id/docs/nextcloud-setup.md`](../apps/roebel-id/docs/nextcloud-setup.md)
(local, ngrok). This is the **production** version.

### A1. Server + DNS
- Provision a Hetzner box (Ubuntu 24.04). Install Docker + Docker Compose.
- DNS: `cloud.roebel.app` → the box's IPv4. (Collabora is proxied behind the same
  host, no separate subdomain needed with AIO.)

### A2. Install Nextcloud (AIO recommended)
Nextcloud **All-in-One** bundles Collabora/CODE, backups, and TLS management:
```bash
docker run -d --name nextcloud-aio-mastercontainer --restart always \
  -p 8080:8080 \
  -e APACHE_PORT=11000 -e APACHE_IP_BINDING=0.0.0.0 \
  -v nextcloud_aio_mastercontainer:/mnt/docker-aio-config \
  -v /var/run/docker.sock:/var/run/docker.sock:ro \
  nextcloud/all-in-one:latest
```
Open `https://<box-ip>:8080`, set the domain to `cloud.roebel.app`, and let AIO
provision Nextcloud + Collabora + Let's Encrypt TLS. Put a reverse proxy
(Caddy/nginx) in front on 443 if you prefer terminating TLS yourself.

> Alternative: the repo's [`docker-compose.nextcloud.yml`](../apps/roebel-id/docker-compose.nextcloud.yml)
> is fine for dev but not hardened (no managed backups/TLS) — prefer AIO for prod.

### A3. Wire Röbel ID as the OIDC login
Run the same `occ` steps as the dev doc, but with the **production discovery URL**:
```bash
# inside the Nextcloud container (AIO: `docker exec` into nextcloud-aio-nextcloud)
php occ app:install user_oidc
php occ user_oidc:provider Roebel \
  --clientid="nextcloud" \
  --clientsecret="<NEXTCLOUD_CLIENT_SECRET>" \
  --discoveryuri="https://id.roebel.app/.well-known/openid-configuration" \
  --scope="openid email profile roebel" \
  --unique-uid=1 --mapping-uid=sub --mapping-email=email \
  --mapping-display-name=name --mapping-groups=groups
php occ config:app:set user_oidc provisioning_groups --value=1
```
Then register Nextcloud's redirect URI with the keystone (Fly), and redeploy Röbel ID:
```bash
fly secrets set -a roebel-id \
  NEXTCLOUD_REDIRECT_URIS="https://cloud.roebel.app/apps/user_oidc/code"
fly deploy -a roebel-id
```
`NEXTCLOUD_CLIENT_ID` (`nextcloud`) and `NEXTCLOUD_CLIENT_SECRET` are already set on
Fly (the client secret you provisioned when Röbel ID went live).

### A4. Org shared folders (the actual "shared files")
Install **Group Folders** and create one folder per org, ACL'd to the org group:
```bash
php occ app:install groupfolders
# For each org account (id = the accounts.id used in the group claim):
php occ groupfolders:create "Org <orgName>"
# note the returned folder id, then grant the org group access:
php occ groupfolders:group <folderId> "org:<accountId>:member"
```
Because `provisioning_groups=1`, a citizen who is `org:<accountId>:member` in their
Röbel ID token is auto-added to that Nextcloud group on login and immediately sees
the shared folder. Collabora co-editing works inside it out of the box.

---

## Part B — Matrix + Element (human chat)

Stack: **Synapse** (homeserver) + **MAS** (Matrix Authentication Service, the
MSC3861 next-gen auth that speaks upstream OIDC) + **Element Web** (client). Röbel
ID is MAS's upstream identity provider.

### B1. DNS
- `matrix.roebel.app` → Synapse (federation + client API)
- `auth.roebel.app`   → MAS
- `chat.roebel.app`   → Element Web

### B2. Synapse + Postgres + MAS (compose sketch)
Use the official images. Key points, not a full compose dump:
- **Synapse** with `server_name: roebel.app`, `public_baseurl: https://matrix.roebel.app`,
  Postgres backend, and MSC3861 delegation to MAS:
  ```yaml
  # homeserver.yaml
  experimental_features:
    msc3861:
      enabled: true
      issuer: https://auth.roebel.app/
      client_id: "0000000000000000000SYNAPSE"
      client_auth_method: client_secret_basic
      client_secret: "<synapse↔mas shared secret>"
      admin_token: "<mas admin token>"
  ```
- **MAS** (`config.yaml`) with Röbel ID as an **upstream OAuth2 provider**:
  ```yaml
  upstream_oauth2:
    providers:
      - id: 01ROEBELIDPROVIDERULID000000        # generate a ULID once, keep it stable
        issuer: https://id.roebel.app
        human_name: "Röbel ID"
        client_id: "matrix"
        client_secret: "<MATRIX_CLIENT_SECRET>"
        scope: "openid email profile roebel"
        token_endpoint_auth_method: client_secret_basic
        claims_imports:
          subject: { template: "{{ user.sub }}" }
          localpart: { template: "{{ user.sub }}" }   # or a slug of preferred_username
          displayname: { template: "{{ user.name }}" }
          email: { template: "{{ user.email }}" }
  ```
  MAS's callback for this provider is
  `https://auth.roebel.app/upstream/callback/01ROEBELIDPROVIDERULID000000` — that is
  the redirect URI you register with Röbel ID below.

### B3. Register the Matrix client with Röbel ID
The keystone now supports a **second, optional** first-party client (this is the
code change shipped alongside this doc — `config.matrix`, additive, boots unchanged
until set). Set the Matrix client env on Fly and redeploy:
```bash
fly secrets set -a roebel-id \
  MATRIX_CLIENT_ID="matrix" \
  MATRIX_CLIENT_SECRET="<generate a strong secret; use the same in MAS above>" \
  MATRIX_REDIRECT_URIS="https://auth.roebel.app/upstream/callback/01ROEBELIDPROVIDERULID000000"
fly deploy -a roebel-id
```
> Before deploying, run `cd apps/roebel-id && pnpm test` — the multi-client change is
> covered by the existing e2e/interaction tests, but I couldn't run them here (local
> disk was full).

### B4. Element Web
Serve Element at `chat.roebel.app` with `config.json`:
```json
{ "default_server_config": { "m.homeserver": { "base_url": "https://matrix.roebel.app" } },
  "default_country_code": "DE" }
```
Login flow: Element → Synapse → (MSC3861) MAS → Röbel ID → wallet sign → back. One
identity, same as Nextcloud.

### B5. Org spaces/rooms
The `groups` claim rides in the token. v1 (lean): a small provisioning script
(run on org creation, or nightly) uses the Synapse admin API to create a **Space**
per org and invite/auto-join the members of `org:<accountId>:member`. Full
claim-driven auto-join is a later automation — the identity mapping is the hard part
and it's already done by MAS.

---

## Part C — Point the dashboards at the services

Set these in **Vercel → roebel-web → Environment** (Production) and in
`apps/web/.env.local` for local dev. Both are `NEXT_PUBLIC_` (the tiles link from
the browser):
```
NEXT_PUBLIC_WORKSPACE_BASE_URL=https://cloud.roebel.app   # Nextcloud + Collabora (files/docs)
NEXT_PUBLIC_CHAT_BASE_URL=https://chat.roebel.app         # Element/Matrix (human chat)
# The rest of the openDesk-equivalent suite — each tile appears ONLY when its var is set,
# so you can roll them out one at a time:
NEXT_PUBLIC_MAIL_BASE_URL=https://mail.roebel.app         # Open-Xchange (mail/calendar/contacts)
NEXT_PUBLIC_WIKI_BASE_URL=https://wiki.roebel.app         # XWiki (knowledge)
NEXT_PUBLIC_VIDEO_BASE_URL=https://meet.roebel.app        # Jitsi (video)
NEXT_PUBLIC_PROJECT_BASE_URL=https://project.roebel.app   # OpenProject (projects/tasks)
NEXT_PUBLIC_AGENTS_BASE_URL=https://agents.roebel.app     # KI-Arbeitsbereich: humans + AI agents
                                                          # as peers (Nostr/Buzz-style; see
                                                          # docs/NOSTR_AGENT_ECOSYSTEM_PLAN.md)
```
Redeploy the web app. The "Dateien & Dokumente" and "Team-Chat" tiles now light up
on both the citizen dashboard (`/app/dashboard`) and the org Arbeitsbereich
(`/dashboard/arbeitsbereich`); each opens the right app via Röbel ID SSO.

---

## Part D — Verification checklist

- [ ] `https://id.roebel.app/.well-known/openid-configuration` reachable from both
      the Nextcloud container and the MAS container.
- [ ] Nextcloud login page shows "Login with Roebel"; logging in creates the account
      and the `groups` claim populates Nextcloud groups.
- [ ] A citizen who is `org:<id>:member` sees the org's group folder + can co-edit in
      Collabora.
- [ ] Element login round-trips through MAS → Röbel ID and lands in a session.
- [ ] The two dashboard tiles appear and open `cloud.roebel.app` / `chat.roebel.app`.
- [ ] Röbel ID still serves Nextcloud after adding the Matrix client (regression:
      `apps/roebel-id` tests green before deploy).

## Ops notes
- **Backups:** Nextcloud AIO has built-in Borg backups — enable them. Back up the
  Synapse Postgres DB and the MAS DB.
- **A relay/homeserver is stateful:** plan retention/GDPR erasure explicitly for
  citizen-linked chat data (Synapse has redaction + account-erasure admin APIs).
- **Secrets** live on Fly (Röbel ID clients) and the Hetzner box (Synapse/MAS/DB) —
  never in the repo.
- **Sovereignty:** everything above runs on infra you own. This is the manual,
  hand-wired version of what Netizen Labs will package for others.
