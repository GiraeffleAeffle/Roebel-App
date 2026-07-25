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
