# Roebel ID — OIDC Provider

OpenID Connect provider for Roebel, integrating Gnosis smart contracts (CitizenNFTv2, AttesterNFTv2) and Nextcloud.

## Development

### Start dev server

```bash
pnpm --filter @roebel/roebel-id dev
```

Server listens on `http://localhost:3010`.

### Generate JWKS

Generate a fresh JWK Set for the `JWKS_JSON` secret:

```bash
pnpm --filter @roebel/roebel-id exec tsx scripts/generate-jwks.ts
```

Output is valid JSON `{"keys":[{...}]}` with fields: `kid` (random UUID), `use` (sig), `alg` (RS256), and the RSA public key material.

Copy the entire JSON output to the `JWKS_JSON` environment variable.

## Environment variables

`src/config.ts` (`loadConfig()`) is the source of truth; this section documents its
schema. Copy `.env.example` to `.env` for local dev.

### Core

| Var | Required | Notes |
| --- | --- | --- |
| `ISSUER_URL` | yes | The keystone's own OIDC issuer URL. |
| `PORT` | no (default `3010`) | |
| `COOKIE_KEYS` | yes | Comma-separated. |
| `GNOSIS_RPC_URL` | yes | |
| `CHAIN_ID` | no (default `100`) | |
| `CITIZEN_NFT_ADDRESS` | yes | |
| `ATTESTER_NFT_ADDRESS` | yes | |
| `SUPABASE_URL` | yes | |
| `SUPABASE_SERVICE_KEY` | yes | |
| `THIRDWEB_CLIENT_ID` | yes | |
| `JWKS_JSON` | yes (prod) | See "Generate JWKS" above. |

### First-party relying parties (RPs)

Each RP is a block of up to six env vars, keyed by an uppercase prefix:
`<PREFIX>_CLIENT_ID`, `<PREFIX>_CLIENT_SECRET`, `<PREFIX>_REDIRECT_URIS`
(comma-separated), `<PREFIX>_POST_LOGOUT_URIS` (optional, comma-separated),
`<PREFIX>_BRANDING` and `<PREFIX>_BRANDING_CONTEXT` (both optional, see
"Login-page branding" below). The lowercased prefix becomes
`RelyingPartyConfig.name`.

- `NEXTCLOUD`, `MATRIX`, `WEB`, `ORTIS` — all optional; each is registered
  only when its `<PREFIX>_CLIENT_ID` is set, so the keystone boots unchanged
  on a node that hasn't stood up that service yet. Once the id is set, the
  rest of that prefix's vars become required — a missing one throws `Missing
  required env: <VAR>` at boot. `NEXTCLOUD` is listed first only so its
  position in `relyingParties` (and hence the registered client order) stays
  first when present — the running `id.roebel.app` instance sets
  `NEXTCLOUD_*` and is unaffected by this being optional.
- **At least one relying party must resolve.** A keystone with zero RPs has
  no OIDC client to serve a login for, so `loadConfig()` throws at boot with
  a message naming the fix (which `<PREFIX>_CLIENT_ID` vars to set, or
  `FIRST_PARTY_RPS`) — never a bare `Missing required env:
  NEXTCLOUD_CLIENT_ID`, which would be actively misleading on an
  Ortis-only instance that never intends to run Nextcloud. This is what
  makes a second, community-specific instance possible — see "Running a
  second instance for another community" below.
- `FIRST_PARTY_RPS` — optional, comma-separated list of *additional* prefixes
  beyond the four known ones above (`NEXTCLOUD` + the three optional ones,
  e.g. `FIRST_PARTY_RPS=BUZZ`). Every prefix listed here is required to
  resolve fully — there's no "set the id to opt in" half-step like the known
  optional prefixes get; listing it is the opt-in. Listing a prefix that's
  already one of the four known ones is a boot failure: `loadRelyingParty`
  runs for it twice, registering the same `client_id` twice, and
  `oidc-provider` throws `client_id must be unique amongst statically
  configured clients` when the `Provider` is constructed.

All first-party RPs share the same trust level (pre-granted consent — see
`src/interaction/router.ts`) and register as `authorization_code` + PKCE-required
`client_secret_basic` OIDC clients (`src/oidc/provider.ts`).

#### Login-page branding

**Pilot-critical:** the login page's copy and colors are resolved per RP by the
requesting `client_id` (`src/interaction/router.ts` → `src/interaction/login-page.ts`),
not hardcoded. A visiting mayor logging in through Ortis must never see Röbel branding.

- `<PREFIX>_BRANDING` — `roebel` or `ortis`. Defaults to `roebel` when unset,
  **except for `ORTIS`, which defaults to `ortis`** (a visiting mayor must
  never see Röbel branding just because an operator forgot this var — see
  "Ortis" below). An unrecognized value throws loudly at boot rather than
  silently falling back.
- `<PREFIX>_BRANDING_CONTEXT` — optional free-text line rendered under the heading
  in secondary (grey) color, e.g. an Amt/org name for the pilot. HTML-escaped.
- The `roebel` preset renders byte-for-byte identical to the page before branding
  was parametrized ("Röbel ID", navy `#00498B`). The `ortis` preset ("Ortis",
  near-black `#111`, no navy) never mentions Röbel.
- An unrecognized `client_id` at the interaction endpoint (shouldn't happen for a
  first-party-only IdP) falls back to the `roebel` preset.

#### Ortis

Ortis (the multi-community consumer of this keystone) registers like any other
first-party RP. `ORTIS_BRANDING` **defaults to `ortis`** — a plain
`ORTIS_CLIENT_ID`/`ORTIS_CLIENT_SECRET`/`ORTIS_REDIRECT_URIS` setup with no
`ORTIS_BRANDING` var at all still renders the Ortis preset, never `roebel`.
Set it explicitly only to override that default (e.g. `ORTIS_BRANDING=roebel`
if that's ever truly wanted) or to carry a context line:

```
ORTIS_CLIENT_ID=ortis
ORTIS_CLIENT_SECRET=__set_in_fly_secrets__
ORTIS_REDIRECT_URIS=https://app.ortis.<domain>/api/auth/callback,http://localhost:3040/api/auth/callback
ORTIS_BRANDING_CONTEXT=Amt Musterstadt
```

`<domain>` is the Ortis deployment's own domain; the second URI is the local
dev callback for testing Ortis against this keystone. The path and the dev port
are not ours to choose — the Ortis app builds its `redirect_uri` as
`${ORTIS_BASE_URL}/api/auth/callback` and defaults `ORTIS_BASE_URL` to
`http://localhost:3040` (netizen_labs `apps/ortis/.env.example`). A mismatch
here surfaces as `redirect_uri did not match` at the authorize endpoint, so
keep the two in sync when the Ortis side changes.

## Deployment (Fly)

### 1. Set secrets on Fly

```bash
fly secrets set \
  COOKIE_KEYS=change-me-1,change-me-2 \
  SUPABASE_SERVICE_KEY=<service_role_key> \
  NEXTCLOUD_CLIENT_SECRET=<nextcloud_secret> \
  JWKS_JSON='<output_of_generate_jwks>' \
  -a roebel-id
```

Every other variable listed in "Environment variables" above (the core vars,
plus any first-party RP blocks and their branding subvars) needs its own
`fly secrets set` or `fly.toml` entry — none of it is baked in from
`.env.example`, which is local-dev-only and never deployed.

### 2. Deploy

Deploy from **inside `apps/roebel-id/`** — this directory is the Docker build
context, so `fly.toml`, `Dockerfile`, and `.dockerignore` all resolve
relative to it:

```bash
cd apps/roebel-id
fly deploy
```

The Dockerfile is self-contained: it only copies files from `apps/roebel-id/`
(`.dockerignore` excludes `node_modules`, `dist`, and other local build
artifacts so they don't get baked into the image) and installs/builds with
`--ignore-workspace`, so it needs nothing from the rest of the monorepo.

**Note:** `min_machines_running = 1` ensures the service never scales to zero—session state and JWKS are memory-resident and not replicated.

### 3. Verify health

```bash
fly status -a roebel-id
curl https://roebel-id.fly.dev/healthz
```

## Running a second instance for another community

A vanity CNAME on top of `id.roebel.app` cannot give another community (e.g.
Ortis, a product for mayors of *other* municipalities) its own-looking login
domain: `oidc-provider` has one issuer per `Provider` instance, discovery
advertises that issuer's own endpoints, the ID token's `iss` must match it,
and the auth bridge derives its SIWE `expectedDomain` straight from
`config.issuer` (`src/auth-bridge/verify-siwe.ts`) — a mismatch is
hard-rejected. The fix is a **second Fly app running this same image**, with
its own `ISSUER_URL` and its own relying-party set. Nothing in this codebase
is Röbel-specific enough to block that — `NEXTCLOUD` is just another
optional relying-party prefix (see "Environment variables" above), so an
instance can register only `ORTIS` and boot with exactly one client.

Below is the full procedure for standing up `ortis-id`, the Ortis instance,
with issuer `https://id.ortis.app` serving the Ortis app at
`https://app.ortis.app` (OIDC callback
`https://app.ortis.app/api/auth/callback`). Substitute names/domains for any
other community instance.

### 1. Create the Fly app

```bash
fly apps create ortis-id
```

### 2. Generate a SEPARATE JWKS

Every instance signs its own ID tokens — never reuse `roebel-id`'s key
material:

```bash
pnpm --filter @roebel/roebel-id exec tsx scripts/generate-jwks.ts
```

Keep the JSON output for `JWKS_JSON` below.

### 3. Set secrets on Fly

```bash
fly secrets set \
  ISSUER_URL=https://id.ortis.app \
  COOKIE_KEYS=<fresh-random-value-1>,<fresh-random-value-2> \
  GNOSIS_RPC_URL=https://rpc.gnosischain.com \
  CITIZEN_NFT_ADDRESS=0x59aA26f499D7C2B3EC2c8524Ed06F54fc4E85dE5 \
  ATTESTER_NFT_ADDRESS=0xC587F383696D3c9DF7A6eE03A9160E40Ae1cdb82 \
  SUPABASE_URL=https://wwbeqhkslxdxhktqzqti.supabase.co \
  SUPABASE_SERVICE_KEY=<service_role_key> \
  THIRDWEB_CLIENT_ID=<same_thirdweb_project_as_web_and_expo> \
  JWKS_JSON='<output_of_generate-jwks_step_2>' \
  ORTIS_CLIENT_ID=ortis \
  ORTIS_CLIENT_SECRET=<strong_random_secret> \
  ORTIS_REDIRECT_URIS=https://app.ortis.app/api/auth/callback \
  -a ortis-id
```

Notes on this exact list:

- **`ORTIS_BRANDING` is deliberately omitted** — it defaults to `ortis` (see
  `PREFIX_BRANDING_DEFAULT` in `src/config.ts`), so the login page never
  risks rendering Röbel branding for a visiting mayor just because the var
  was forgotten.
- **`COOKIE_KEYS` and `JWKS_JSON` must be instance-specific — never reused
  from `roebel-id`'s secrets.** Session cookies are per-domain already (so
  reuse wouldn't leak a session across instances), but reusing signing key
  material collapses the two issuers' trust boundaries for no benefit.
- No `NEXTCLOUD_*`, `MATRIX_*`, or `WEB_*` vars: this instance's only
  relying party is Ortis. `loadConfig()` requires at least one relying party
  to resolve (see "Environment variables" above) — `ORTIS_*` alone
  satisfies that.
- **Both instances share the same Supabase `oidc_payloads` table.** This is
  safe: record ids are random (no cross-instance collision risk) and
  session cookies are scoped per-domain, so `id.roebel.app` and
  `id.ortis.app` sessions never mix even though they're backed by the same
  table.

### 4. Deploy

```bash
cd apps/roebel-id
fly deploy -c fly.ortis.toml
```

`fly.ortis.toml` (next to `fly.toml`) is the same shape as the default
config — same Dockerfile build, `internal_port = 3010`, `force_https`,
`min_machines_running = 1`, the `/healthz` check — with `app = "ortis-id"`.
It deploys the identical image; only the Fly app name differs, since the
issuer and relying-party set come entirely from the secrets set above.

### 5. Add the TLS cert and DNS record

```bash
fly certs add id.ortis.app -a ortis-id
```

Then create the DNS record `fly certs add` asks for (typically a `CNAME`
for `id.ortis.app` pointing at `ortis-id.fly.dev`, or the `A`/`AAAA` pair
`fly certs show id.ortis.app -a ortis-id` reports) at whichever registrar
hosts `ortis.app`.

### 6. Point the Ortis app at its new issuer

In netizen_labs, `apps/ortis/.env`:

```
OIDC_ISSUER=https://id.ortis.app
```

Once DNS + cert are live and the Ortis app redeploys with that issuer, the
login flow for Ortis runs entirely against `id.ortis.app` — the address bar
never shows `id.roebel.app`.

## Architecture

- **Auth flow:** Nextcloud → OIDC authorize → Gnosis contract check (CitizenNFTv2) → sign & return ID token
- **Sessions:** In-memory; keys signed with JWK from `JWKS_JSON`
- **Smart contract gates:** `CITIZEN_NFT_ADDRESS` (join gate), `ATTESTER_NFT_ADDRESS` (role checks)
