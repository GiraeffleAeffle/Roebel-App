# Arbeitsbereich go-live — the fill-in sheet

**Date:** 2026-08-02 · **Audience:** Max (10-minute paste job, two dashboards)
**Goal:** turn on files, documents, spreadsheets and presentations at
`https://www.roebel.app/arbeitsbereich`, personal scope, on the Röbel node.

Every value below was **verified against the live node and the live keystone on 2026-08-02**,
not copied from a spec. Where a value must be invented, the command to generate it is given.

> **Why two dashboards:** the web app talks to the keystone (`id.roebel.app`, on Fly) as an OIDC
> client. A client only exists if it is registered on **both** sides with the **same** id and
> secret. Today the keystone does not know the web app yet (verified: `client_id=web` returns a
> 400 error page, while `client_id=nextcloud` correctly returns 303). That is the one real blocker.

---

## Step 1 — Fly: register the web app as an OIDC client

The keystone only registers this client when `WEB_CLIENT_ID` is set
(`apps/roebel-id/src/config.ts:69-73`). Pick an id and generate a secret:

```bash
# generate the shared secret once — you will paste the SAME value in Step 2
openssl rand -hex 32
```

```bash
fly secrets set \
  WEB_CLIENT_ID=roebel-web \
  WEB_CLIENT_SECRET=<the value from the command above> \
  -a roebel-id
```

**Redirect URIs must match exactly.** The app sends `${origin}/api/workspace/auth/callback`
(`apps/web/src/app/api/workspace/auth/login/route.ts:53`) and `roebel.app` 307-redirects to
`www`, so the canonical one is the **www** form. Both are now correct in
`packages/protocol/examples/roebel.netizen.json` (fixed 2026-08-02 — the previous entry pointed at
`/api/auth/callback`, a route that does not exist). If the keystone's client registration takes
redirect URIs from its own env rather than the manifest, ensure it lists:

```
https://www.roebel.app/api/workspace/auth/callback     ← the one actually used
https://roebel.app/api/workspace/auth/callback         ← apex fallback
```

---

## Step 2 — Vercel: nine variables + the flag

Project **apps/web**, Production scope. Values marked **verified** are live facts; two must be
generated; one you already know.

| Variable | Value | Where it comes from |
|---|---|---|
| `ROEBEL_ID_ISSUER` | `https://id.roebel.app` | **verified** — the issuer field of the live discovery document |
| `WORKSPACE_CLIENT_ID` | `roebel-web` | **must equal `WEB_CLIENT_ID`** from Step 1 |
| `WORKSPACE_CLIENT_SECRET` | *(the `openssl rand -hex 32` value)* | **must equal `WEB_CLIENT_SECRET`** from Step 1 |
| `WOPI_TOKEN_SECRET` | *generate:* `openssl rand -base64 32` | base64 is required — the app base64-decodes it (`config.ts:54`). Nothing else knows this value; it only signs our own editor tokens |
| `NEXTCLOUD_BASE_URL` | `https://cloud.roebel.app` | **verified** — answers 302, live on the node |
| `NEXTCLOUD_ADMIN_USER` | `RoebelAdmin` | **verified** via `occ user:list` on the box |
| `NEXTCLOUD_ADMIN_PASSWORD` | *(the password you set at install)* | **not stored in the box `.env`** — see the note below if you no longer have it |
| `COLLABORA_BASE_URL` | `https://cloud.roebel.app` | **verified** — Collabora is served same-origin under `/browser/*`, `/hosting/*`, `/cool/*`; `/hosting/discovery` returns 200 `text/xml` |
| `NEXT_PUBLIC_APP_ORIGIN` | `https://www.roebel.app` | **verified** — `roebel.app` 307-redirects to `www`, so www is canonical |

Plus the two optional-but-recommended entries:

| Variable | Value | Why |
|---|---|---|
| `WORKSPACE_ALLOWED_ORIGINS` | `https://www.roebel.app,https://roebel.app` | PKCE cookies are host-only, so the OIDC round trip must follow whichever host the citizen is on |
| `NEXT_PUBLIC_WORKSPACE_NATIVE_FILES` | `1` | the feature flag that shows the native Dateien UI (only `1` or `true` count) |

Then **redeploy** — `NEXT_PUBLIC_*` values are baked at build time.

**Lost the Nextcloud admin password?** Reset it on the box without downtime:

```bash
ssh root@178.105.19.80
docker exec -it -u www-data roebel-nextcloud-1 php occ user:resetpassword RoebelAdmin
```

---

## Step 3 — Verify (in this order)

1. `https://www.roebel.app/arbeitsbereich` renders the Übersicht with a **Dateien & Dokumente** tile.
2. Click it → you are sent to `id.roebel.app`, log in with your wallet, and land back on
   `/arbeitsbereich/dateien` with your personal folder listed.
   *If you get `redirect_uri mismatch`, Step 1's URI list is wrong — that is the usual first failure.*
3. Upload a file; create a document; it opens in Collabora inside the app.
4. Create a **spreadsheet** and a **presentation** — Collabora ships Calc and Impress through the
   same editor, so both work with no extra configuration. This is the whole "documents, sheets,
   presentations" pillar in one step.

---

## What this does and does not turn on

**On after Step 2:** personal files, documents, spreadsheets, presentations for every **citizen**,
web only, on infrastructure you own.

**Still gated (unchanged by this sheet):**
- **Org (Verein/business) workspaces** wait for the RLS lockdown migration
  `20260802_account_membership_lockdown.sql` — which itself waits for an `eas update` so
  already-installed phones do not lose membership writes. Personal scope never depended on it.
- **AI agents drafting into the workspace** is the next build slice (W4), not a configuration step.
- **Video calls** need the Matrix installer graduation (W2) first; **chat and voice with a
  contributor already work today** on `buzz.roebel.app`.

Related: [WORKSPACE_SSO_SETUP.md](WORKSPACE_SSO_SETUP.md) (full production build),
[SOVEREIGN_ARBEITSBEREICH_STATE.md](SOVEREIGN_ARBEITSBEREICH_STATE.md) (what is live and what broke
before — read §5 if anything misbehaves).
