# B0.1 Upstream Discovery Notes — block/buzz (verified 2026-08-01)

> Facts for the B-track ([plan](2026-08-01-buzz-b0-b1-deploy-and-identity.md)). Everything here
> was read from the upstream repo/registry on 2026-08-01. Buzz releases near-daily — date any
> claim you add.

## 1. The pin

- Upstream: `github.com/block/buzz` — Apache-2.0, ~19,970 stars, Rust monorepo, pushed 2026-08-01.
- **Server releases stop at `v0.5.2`** (2026-07-29). `desktop-v0.5.3` (2026-07-31) is a
  desktop-only tag — the plan's "pin v0.5.3" resolves to **v0.5.2** for the server bundle.
- `v0.5.2` is a lightweight tag → commit `3e48f1b2365d326ee1c9582448d86a99b44ecd5d`.
- ghcr publishes **one server image** (`ghcr.io/block/buzz`) with only `main` + `sha-<7>` tags —
  **no semver image tags**. Per the plan's decision rule (published images → pin by digest):
  - **Pin: `ghcr.io/block/buzz:sha-3e48f1b`**
  - **Digest: `sha256:12763e38fd99fe8f4e63466a08ea8e3afbda4da0ebd1f51f0b57d78f9b082abe`**
- The image contains the relay AND the admin tooling (`buzz-admin migrate` is documented as
  runnable at bootstrap), so there are no per-component images to pin.

## 2. `deploy/compose/` inventory (files: `compose.yml`, `compose.caddy.yml`, `compose.dev.yml`, `Caddyfile`, `.env.example`, `run.sh`, `README.md`)

Five services, one docker network (`buzz-net`), four named volumes:

| Service | Image | Notes |
|---|---|---|
| `relay` | `${BUZZ_IMAGE}` (default `ghcr.io/block/buzz:main`) | Axum WS relay on :3000; health :8080 (`/_readiness`, `/_liveness`); metrics :9102; git data volume `/data/git`; healthcheck via bash `/dev/tcp` (image has no curl) |
| `postgres` | `postgres:17-alpine` | events (monthly range-partitioned), channels, members, workflows, audit chain |
| `redis` | `redis:7-alpine` | pub/sub fan-out, presence, typing; `--requirepass` + AOF |
| `minio` | `minio/minio:RELEASE.2025-09-07T16-13-09Z` | Blossom/S3 media; path-style addressing pinned (`BUZZ_S3_ADDRESSING_STYLE=path` — Docker DNS can't resolve `<bucket>.minio`) |
| `minio-init` | `minio/mc:RELEASE.2025-08-13T08-35-41Z` | one-shot bucket create + `mc anonymous set none` |

Volumes: `buzz-git-data`, `buzz-postgres-data`, `buzz-redis-data`, `buzz-minio-data`.

**Env contract** (from `.env.example`; upstream relay uses `env_file: .env` — our render house
rule forbids `env_file` for third-party containers, so enumerate exactly these):

- Public shape: `BUZZ_DOMAIN`, `RELAY_URL` (wss://…), `BUZZ_MEDIA_BASE_URL`
  (`https://<domain>/media`), `BUZZ_MEDIA_SERVER_DOMAIN`, `BUZZ_CORS_ORIGINS`.
- Closed-relay mode (production default): `BUZZ_REQUIRE_AUTH_TOKEN=true`,
  `BUZZ_REQUIRE_RELAY_MEMBERSHIP=true`, `BUZZ_ALLOW_NIP_OA_AUTH=true`,
  `RELAY_OWNER_PUBKEY=<64-hex nostr pubkey>` (deliberately un-prefixed; bootstraps the owner).
- Stable secrets (generate once, keep on box): `BUZZ_RELAY_PRIVATE_KEY` (64-hex — the relay's own
  signing key; membership events are signed with it), `BUZZ_GIT_HOOK_HMAC_SECRET` (64-hex),
  `POSTGRES_PASSWORD`, `REDIS_PASSWORD`, `BUZZ_S3_ACCESS_KEY`, `BUZZ_S3_SECRET_KEY`.
- Bootstrap: `BUZZ_AUTO_MIGRATE=true` for first boot (or run `buzz-admin migrate`); embedded SQLx
  migrations are in the published image.
- Wired-by-compose (not free config): `DATABASE_URL`, `REDIS_URL`, `BUZZ_S3_ENDPOINT=http://minio:9000`,
  `BUZZ_S3_BUCKET` (default `buzz-media`), `BUZZ_GIT_REPO_PATH=/data/git`, `BUZZ_BIND_ADDR`,
  `BUZZ_HEALTH_PORT=8080`, `BUZZ_METRICS_PORT=9102`.

**Caddy/TLS story:** upstream's optional `compose.caddy.yml` is a single-vhost
`reverse_proxy relay:3000` (WebSocket passthrough is implicit in Caddy v2). It composes cleanly
with the node's existing Caddy — we add one vhost to OUR Caddyfile and skip upstream's caddy
container entirely. No conflict; no B5 candidate here.

**Client reachability:** desktop/mobile clients take `RELAY_URL` (wss) — one hostname serves WS,
REST (`/api/…`), and media. `buzz.roebel.app` → relay:3000 is the whole routing story.
Requires Docker Compose ≥ 2.24.4 only for upstream's `!reset` TLS override, which we don't use.

## 3. Protocol & membership (NOSTR.md)

- NIPs: 01, 09, 10 (kind:9 replies), 11, **17 (gift-wrapped DMs — DMs ARE encrypted)**, 25,
  **29 (relay-based groups — core)**, **42 (WS auth, proactive challenge)**,
  **43 (relay membership: `relay_members` table, fail-closed on DB errors)**, 50, 70.
- Custom kinds: 9000–9022 group ops, 9030–9033 NIP-43 admin ops, **13534 relay-signed membership
  roster**, 20001/20002 presence/typing, 39000–39002 group discovery, 40002–40003 rich content,
  44100–44101 membership notifications.
- Multi-tenancy: host→community resolution before any handler; `community_id` is the tenant
  boundary in Postgres and Redis keys; unknown hosts fail closed. (Directly relevant to the later
  hosted-workspaces product — one deployment can serve many communities.)

## 4. Admin / invite / agent surfaces (B1 depends on these)

- **`buzz-admin`** (in the server image): `generate-key` (prints hex keypair, secret never
  stored), `add-member --pubkey <hex>` — publishes a **kind:13534 membership event signed with
  `BUZZ_RELAY_PRIVATE_KEY`**. Membership add/remove is therefore an auditable relay-signed event,
  not a DB poke. This is the B1.1 revocation surface.
- **Invite links** (v0.5.0 “use-limited invite links”, PR #3141): a desktop-client flow; no CLI
  surface found. B1.2 pilots onboard via desktop-generated invite links.
- **`buzz-cli`** (crates/buzz-cli): agent-first, JSON in/out. Auth = `BUZZ_PRIVATE_KEY`
  (NIP-98 Schnorr-signed requests), relay = `BUZZ_RELAY_URL`. Surface: messages
  (send/get/thread/search/edit/delete/send-diff), channels (list/create/join/topic), reactions,
  users/presence/status, DMs, **workflows (list/trigger/approve)**, canvas (get/set), votes.
- **`buzz-acp`** (crates/buzz-acp): the BYOH bridge — `Relay ──WS──→ buzz-acp ──stdio──→ agent`,
  replies via buzz-cli. Speaks ACP to **goose, codex (codex-acp), and Claude Code
  (`claude-agent-acp`)** — our Mecky harness path exists upstream. Config is just
  `BUZZ_PRIVATE_KEY` + `BUZZ_RELAY_URL`; the harness discovers member channels
  (`GET /api/channels?member=true`) and auto-subscribes on membership notifications. Desktop
  spawns a harness per (agent, community) since v0.4.23; server-side we run buzz-acp ourselves.
- **Known upstream gap:** no REST/event API for managing *channel* members (only relay
  members) — buzz-acp README calls it out. Recorded as a B2/B5 watch item, NOT something we patch
  (fork-last).

## 5. Surprises vs. the spec's assumptions

1. **Spec §2 said "Buzz does NOT use NIP-29" — outdated.** Current main implements NIP-29 as the
   core group protocol plus NIP-42 auth and NIP-43 relay membership. The trust model conclusion
   stands (the relay is the boundary; channels are relay-gated, not E2EE), but B1 rides standard
   membership events, which is better than assumed.
2. **DMs are NIP-17 gift-wrapped** — "no message E2EE" is true for channels only. Copy nuance for
   line B marketing: E2EE documents (Fileverse) + E2EE DMs (NIP-17) + relay-gated channels.
3. **v0.5.3 is desktop-only; the server pin is v0.5.2** (`sha-3e48f1b`).
4. **No semver image tags on ghcr** — digest pin recorded above.
5. Upstream brings **Postgres 17** — the node's shared Postgres is 16. The plan's dedicated-
   containers decision is thereby confirmed twice over (isolation AND version skew).
6. Upstream `env_file: .env` for the relay violates our enumerate-vars rule — render enumerates.

## 6. The CLI-copy question (plan asked: which copy deployed the node last?)

**Answer: the Röbel repo copy (`DAO_test/packages/cli`).** Proof: the box's live manifest
includes the `record` (NSP-12) block and the extended indexer kinds — `DAO_test`'s protocol
schema parses that manifest; **`netizen_labs`'s schema has no `record` field and cannot**
(strict schema → parse failure). Conversely `netizen_labs` carries signer/sponsorship/rails
blocks the Röbel copy lacks. The fork is bidirectional:

- `DAO_test` copy: + `record` block, + NIP-62 deletion pipeline (07-31), + indexer kinds/datasets.
- `netizen_labs` copy: + signer, + sponsorship/paymaster rails, + accounts (07-31/08-01).

**B0 decision: build `services.buzz` in BOTH copies (same block, same tests)** — primary in
`DAO_test` (it renders the box), ported to `netizen_labs` (the company repo carries the product
surface). A dedicated reconciliation session should merge the two copies; filed as follow-up.

## 7. Seeds for B2+ (Fileverse slice)

- The agent harness reaches tools through ACP; buzz-cli is auto-configured for replies. The
  Fileverse MCP joins on the agent side (tool bus), not the relay side — no Buzz changes needed.
- Buzz **workflows** (list/trigger/approve via CLI) are the approval-gate surface the two-toolset
  demo (B3) should exercise: agent triggers, human approves.
- Owner bootstrap: `RELAY_OWNER_PUBKEY` should be Max's wallet-derived pubkey (hex form of his
  existing npub from the identity bridge) — decided at B0.3, no fresh keypair for the owner.
