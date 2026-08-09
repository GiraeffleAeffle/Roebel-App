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
- **Invite links** (v0.5.0 "use-limited invite links", PR #3141): **correction — there is a
  server-side REST API, not desktop-only.** `crates/buzz-relay/src/api/invites.rs`:
  `POST /api/invites` mints a code (NIP-98-signed, caller must hold `owner`/`admin` relay role,
  `invites.rs:267-339`); `POST /api/invites/claim` redeems it (NIP-98-signed by the *joining*
  pubkey, deliberately exempt from the membership gate, `invites.rs:347-501`). Params: `ttl_secs`
  (`MIN_INVITE_TTL_SECS..MAX_INVITE_TTL_SECS`, default 72h) and `max_uses` (1..`MAX_INVITE_USES`,
  omitted = unlimited — this is the "use-limited" part). Successful claims publish NIP-43
  `kind:13534` member-added + roster events, same as `buzz-admin add-member`. Optional ToS/privacy/
  age-attestation join-policy gate sits in front, with a signed acceptance receipt bound to the
  code (`invites.rs:99-226`). Since these are plain NIP-98-signed HTTP routes, `buzz-cli` or any
  HTTP client with a Nostr keypair can mint/claim invites — no desktop app required. B1.2/B1.3 can
  drive this straight from the installer/CLI rather than depending on desktop-generated links.
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
- **Known upstream gap — re-verify live before trusting:** `crates/buzz-acp/README.md:53` claims
  "the relay doesn't yet have a REST/event API for managing channel members." But
  `crates/buzz-cli/README.md:123-125` lists working `channels add-member`/`remove-member`/`members`
  commands. This looks like an upstream doc inconsistency (buzz-acp's README stale, or the gap is
  narrower than stated — maybe just *private*-channel visibility, not membership writes in
  general) rather than a real capability gap. Confirm against a running relay before B2/B5 planning
  leans on either doc's claim; don't take it as settled fact from docs alone.
- **`buzz-agent`** (crates/buzz-agent, upstream's own minimal ACP LLM agent): confirms a headless
  agent can run fully server-side with zero desktop dependency — "Not a UI. No TUI, no web, no
  notifications... API keys come from env. Use systemd, Docker secrets, or a wrapper"
  (`crates/buzz-agent/README.md:257-259`). Config is 100% env vars (`BUZZ_AGENT_PROVIDER=
  anthropic|openai|databricks`, no config file). It's Tier-1 in the BYOH runtime catalog (reserved
  id `buzz-agent`) but is not itself a Desktop feature — pairs with `buzz-acp` as a
  systemd/container unit on the node, independent of any desktop process. BYOH's Tier-3
  "custom_harnesses/*.json" mechanism (`crates/buzz-acp/README.md:276-292`) *is*
  Desktop-app-specific (it's how a human picks a locally-installed binary for Buzz Desktop to
  spawn) — don't reach for it when wiring a node-hosted agent; use `buzz-acp`+`buzz-agent` (or
  `buzz-acp`+goose/claude-agent-acp) directly instead.

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

## 8. Addendum — independent verification pass (2026-08-01, second session)

A parallel B-track session cloned `v0.5.2` independently and reached the same load-bearing
conclusion (§1's digest pin, confirmed byte-for-byte). Two corrections were made directly above
(§4's invite-links and channel-member-API bullets). Additional facts this pass verified that
weren't in the original note:

- **RAM/disk: unstated by upstream for the compose bundle**, confirmed by grep across
  `deploy/compose/README.md`, `.env.example`, and `README.md` — zero sizing guidance anywhere. The
  only quantified numbers upstream publishes at all are the **Kubernetes Helm chart's** defaults
  (`deploy/charts/buzz/values.yaml:160-166`, relay pod: request 500m CPU/512Mi RAM, limit 2 CPU/
  2Gi RAM), which is k8s-pod sizing for the relay process alone — it says nothing about the
  compose bundle's Postgres/Redis/MinIO containers, which have no stated limits at all. Treat any
  RAM/disk figure for the compose stack as an inference to verify with `docker stats` after first
  deploy, not an upstream-sourced fact.
- **Multi-tenancy nuance:** the host→community resolution §3 describes is real and exercised in
  the current test suite (e.g. `code_minted_for_one_community_fails_on_another`,
  `crates/buzz-relay/src/api/invites.rs:1420-1463`) — confirmed working, not aspirational. What
  *is* still in progress is the **formal isolation proof** for it:
  `docs/multi-tenant-relay.md` is headed `draft` and is a TLA+/Tamarin verification effort for
  hardening this exact boundary (row-level security across N stateless relay processes sharing one
  Postgres). The mechanism works today; the rigor of its cross-tenant isolation guarantee is what's
  still being formally nailed down. Doesn't change any B0/B1 decision, but don't cite the "draft"
  doc as either "not implemented" or "already proven" — it's neither.
- **`BUZZ_HUDDLE_AUDIO_AVAILABLE`** exists as a relay-side config flag
  (`crates/buzz-relay/src/config.rs`), and huddle/audio handling lives server-side
  (`crates/buzz-relay/src/audio/{room,join,mesh,handler,wire}.rs`), with `crates/buzz-relay-mesh`
  providing cross-pod huddle audio tunneling for HA/k8s only (irrelevant to our single relay
  process). Could not confirm a "v0.5.3 ships agent transcription" claim specifically, since
  v0.5.3 as a whole-product version doesn't exist (§1) — only `desktop-v0.5.3`. If B-track work
  depends on agent transcription specifically, re-check `crates/buzz-agent` and the desktop
  transcription pipeline directly rather than assuming it landed with any particular tag.

## 8. B0.3 deploy runbook (written 2026-08-01 — waiting on ONE user gate)

Everything below is ready; the only blocker is the SSH key. DNS is DONE
(`buzz.roebel.app → 178.105.19.80`, added by Max 2026-08-01). The manifest half is
committed (`e8992d6f`); render verified locally (33 files, buzz vhost + plan step + 6 refs).

**USER GATE:** in a terminal, run `ssh-add --apple-use-keychain ~/.ssh/id_ed25519` and enter
the passphrase (the shared launchd agent currently holds no identities — batch SSH is denied).
After that, any session can run the steps below.

```bash
# 1. Secrets — generated ON the box, appended to its own .env (never through the CLI)
ssh root@178.105.19.80 'cd /opt/netizen/roebel && {
  echo "BUZZ_POSTGRES_PASSWORD=$(openssl rand -hex 24)";
  echo "BUZZ_REDIS_PASSWORD=$(openssl rand -hex 24)";
  echo "BUZZ_S3_ACCESS_KEY=$(openssl rand -hex 16)";
  echo "BUZZ_S3_SECRET_KEY=$(openssl rand -hex 24)";
  echo "BUZZ_RELAY_PRIVATE_KEY=$(openssl rand -hex 32)";
  echo "BUZZ_GIT_HOOK_HMAC_SECRET=$(openssl rand -hex 32)";
} >> .env && chmod 600 .env && grep -c "^BUZZ_" .env'
# Expect 6. BUZZ_RELAY_PRIVATE_KEY must stay stable forever after (it signs membership).

# 2. Deploy from the Röbel repo copy (the copy the box runs — §6)
cd packages/cli
npx tsx src/cli.ts up ../protocol/examples/roebel.netizen.json --dry-run          # review plan
npx tsx src/cli.ts up ../protocol/examples/roebel.netizen.json --host root@178.105.19.80
# bootstrap.sh restarts caddy itself (render.ts:2039), so the new vhost gets its cert.

# 3. Membership: owner is bootstrapped by env; the declared agent needs one command
ssh root@178.105.19.80 'cd /opt/netizen/roebel && sh buzz/add-members.sh'

# 4. Verify
curl -fsS https://buzz.roebel.app/_liveness && echo OK
ssh root@178.105.19.80 'docker ps --filter name=buzz --format "{{.Names}} {{.Status}}"'
npx tsx src/cli.ts doctor ../protocol/examples/roebel.netizen.json
ssh root@178.105.19.80 'free -m | head -2; df -h / | tail -1'   # record the RAM/disk delta

# 5. The rsync-survival proof (the members.txt lesson): run ONE more unrelated
#    `netizen up`, then confirm Buzz data survived — its state is entirely in named
#    docker volumes (buzz_git_data/buzz_pg_data/buzz_redis_data/buzz_minio_data),
#    which rsync --delete never touches. Check a channel still exists afterwards.
```

Then B0's exit test: Buzz desktop → `wss://buzz.roebel.app` → sign in as Max (import the key
via the app's pilot export flow, commit `74b8b2eb`, gate `buzz_workspace_enabled='true'` in
app_settings) → create a channel → `sh buzz/add-members.sh` has already admitted Mecky's key.

**B1.1 harness note:** upstream ships no buzz-acp image — build ONCE on the box
(`cargo build --release -p buzz-acp` in a throwaway container, or docker build), tag
`netizen/buzz-acp:v0.5.2`, record the digest here, and run it with
`BUZZ_PRIVATE_KEY=<mecky nsec/hex derived from NODE_AGENT_SECRET on the box>` +
`BUZZ_RELAY_URL=wss://buzz.roebel.app` + `claude-agent-acp` (npm) as the ACP harness.
Do NOT wire the build into `netizen up` (the installer applies, it does not compile).

## 9. M0 verification against the box (2026-08-09, Autar kickoff session)

Every B0 claim re-verified against the running node, per the "state docs that disagree
with the box are bugs" rule. Deploying CLI copy confirmed: the **Röbel repo copy**
(`DAO_test/packages/cli`) performed the deploy (§6/§8 stand); netizen_labs carries the
port (`99dd526`) — no drift found in the buzz render surface.

**Verified live:**

- Containers: `roebel-buzz-1` (sha-3e48f1b), `-postgres-1` (17-alpine), `-redis-1`
  (7-alpine), `-minio-1` — all **Up 7 days (healthy)**. 23 containers total; box at
  2.3 GiB RAM used of 16, 15 GB disk of 320.
- Liveness: `/_liveness` → 200 `ok` (via `--resolve` pin to `178.105.19.80`).
- Membership equals the manifest, exactly: `relay_members` = owner `4dbcf581…` (Max) +
  agent `412e639a…` (Mecky) — `buzz/add-members.sh` was applied. `pubkey_allowlist` 0
  rows, `relay_invites` 0 rows.
- Usage: `users` 0, `channels` 0, `channel_members` 0, `events` 2 (bootstrap).
  **The B0 exit test — a channel with Max + one agent — has NOT run. No human has
  ever signed in.** The 08-01 "Buzz live" claim covered infrastructure only.
- Doctor (Röbel-repo copy): buzz present in plan step 8; comms sovereignty ✓
  ("own relay + agentic workspace relay at https://buzz.roebel.app").

**DNS REGRESSION — the one hard gate:** the `buzz` A record is **gone from the IONOS
zone** (absent from 1.1.1.1 and 8.8.8.8 on 2026-08-09). It existed 08-01: the LE cert
(issued 08-01 13:37 UTC, expires 10-30) proves resolution worked at deploy time. NS
unchanged (`ui-dns.*`); `relay`/`cloud`/`chat`/`index` still → `178.105.19.80`; only
`buzz` is missing (the unrelated `app` PWA record is also still unset). Until Max
re-adds `buzz → 178.105.19.80`, no client connects and the cert cannot renew.

**Redeploy-survival proof: deferred, deliberately.** Repo HEAD now carries the
undeployed x402 metering slice, itself user-gated on a settler key — a `netizen up`
today would not be an "unrelated" deploy. Buzz state lives in named docker volumes
(`buzz_git_data`/`buzz_pg_data`/`buzz_redis_data`/`buzz_minio_data`), which the rsync
bundle dir never contains; run the formal proof with the next gated deploy.

**Remaining for M0 exit, in order:**

1. **USER GATE (Max):** re-add the IONOS A record `buzz → 178.105.19.80`.
2. **USER GATE (Max):** Buzz desktop → `wss://buzz.roebel.app` → sign in with the owner
   key (pilot export flow, commit `74b8b2eb`, `app_settings.buzz_workspace_enabled`)
   → create a channel. Mecky's key is already admitted.
3. A *responding* resident agent (buzz-acp harness, §8 note) is B1.1 — first M1 item,
   not M0.

**Gates 1+2 CLEARED (2026-08-09, later the same day):** Max re-added the IONOS A record —
verified authoritative + propagated (1.1.1.1, 8.8.8.8), `/_liveness` 200 and NIP-11 served
over public DNS — and set `app_settings.buzz_workspace_enabled = 'true'` (row verified).
Remaining for M0 exit: Max's Buzz-desktop sign-in with the owner key (export flow in the
Röbel app) + first channel. Mecky is already admitted. M1 (buzz-acp resident agent) starts
on Max's go.

**M0 PASSED (2026-08-09 ~20:00):** Max signed into Buzz desktop with the owner key (exported
from the Röbel app, imported via "Use a different key" after first landing on a burned
throwaway identity — retired, never admitted) and the workspace came alive: relay-side
verified 4 users, 3 channels (`general`, `welcome-everyone`, `Welcome`), 6 channel
members, 83 events. An agent (Buzz's desktop-managed starter agent "Fizz") and Max
exchanged messages in the private `Welcome` channel — the B0 exit test ("a channel with
Max + one agent works on buzz.roebel.app") is met. NOTE: Fizz/Honey/Bumble are
desktop-spawned local harness agents (per-(agent,community) since v0.4.23) running on
Max's Mac under his management — they sleep when the app closes. Node-resident 24/7
agents under canonical Netizen identities (Mecky via server-side buzz-acp) = M1/B1.1,
which starts on Max's go.

## 10. Upstream claims reported by the desktop starter agents (2026-08-09 — RE-VERIFY before relying)

During the M0 session Max asked the desktop-managed starter agents (Fizz/Honey/Bumble,
local harnesses on his Mac) what they knew; Bumble cited its own 2026-07-25 verification
pass. Recorded here as dated CLAIMS, not facts — verify against upstream before M2/B5
planning leans on any of them:

1. **Rate limiting defined but not enforced** — four tiers exist as config, only
   `AlwaysAllowRateLimiter` implemented. Matters before any external pilot.
2. **Approval gates not wired end-to-end** — `request_approval` suspends but the run is
   marked `Failed`. If true, the M2 decision queue must OWN the approval surface (batched
   sell/sign/decide in our layer) rather than lean on upstream workflow approvals — which
   is how M2 is designed anyway.
3. **Zero payment/wallet/treasury surface in Buzz** — coordination, not settlement;
   confirms two-lines B4 (money bounds = Zodiac-scoped budgets in our layer).
4. **openDesk federation is OIDC-only (v1.4.0+), users matched by username, no inbound
   SCIM through v1.17.0** — federation authenticates, it does not create identities.
   Consistent with our line-A research.

Provenance: desktop-agent output relayed by Max, upstream ground truth as of ~2026-07-25.
Buzz ships near-daily — date-check everything above at B2/M2 planning time.
