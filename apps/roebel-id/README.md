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

Each RP is a block of up to four env vars, keyed by an uppercase prefix:
`<PREFIX>_CLIENT_ID`, `<PREFIX>_CLIENT_SECRET`, `<PREFIX>_REDIRECT_URIS`
(comma-separated), `<PREFIX>_POST_LOGOUT_URIS` (optional, comma-separated). The
lowercased prefix becomes `RelyingPartyConfig.name`.

- `NEXTCLOUD` — always required; the keystone won't boot without it.
- `MATRIX`, `WEB`, `ORTIS` — optional; each is registered only when its
  `<PREFIX>_CLIENT_ID` is set, so the keystone boots unchanged on a node that
  hasn't stood up that service yet. Once the id is set, the rest of that
  prefix's vars become required — a missing one throws `Missing required env:
  <VAR>` at boot.
- `FIRST_PARTY_RPS` — optional, comma-separated list of *additional* prefixes
  beyond the three known ones above (e.g. `FIRST_PARTY_RPS=BUZZ`). Every
  prefix listed here is required to resolve fully — there's no "set the id to
  opt in" half-step like the known optional prefixes get; listing it is the
  opt-in.

All first-party RPs share the same trust level (pre-granted consent — see
`src/interaction/router.ts`) and register as `authorization_code` + PKCE-required
`client_secret_basic` OIDC clients (`src/oidc/provider.ts`).

#### Ortis

Ortis (the multi-community consumer of this keystone) registers like any other
first-party RP:

```
ORTIS_CLIENT_ID=ortis
ORTIS_CLIENT_SECRET=__set_in_fly_secrets__
ORTIS_REDIRECT_URIS=https://app.ortis.<domain>/api/auth/callback,http://localhost:3000/api/auth/callback
```

`<domain>` is the Ortis deployment's own domain; the second URI is the local
dev callback for testing Ortis against this keystone.

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

All other variables come from `.env.example` (hardcoded or shared).

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

## Architecture

- **Auth flow:** Nextcloud → OIDC authorize → Gnosis contract check (CitizenNFTv2) → sign & return ID token
- **Sessions:** In-memory; keys signed with JWK from `JWKS_JSON`
- **Smart contract gates:** `CITIZEN_NFT_ADDRESS` (join gate), `ATTESTER_NFT_ADDRESS` (role checks)
