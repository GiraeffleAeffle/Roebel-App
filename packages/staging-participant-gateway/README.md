# Röbel staging participant gateway

This package implements ADR 0021's staging-only capability. It lets one
invite-bearing, wallet-signing tester create a plain text post or comment in
the normal Röbel staging feed without being labelled a verified citizen.

It is deliberately not a general API proxy. The complete public surface is:

```text
GET  /api/staging-participant/v1/status
POST /api/staging-participant/v1/challenge
POST /api/staging-participant/v1/session
POST /api/staging-participant/v1/posts
POST /api/staging-participant/v1/comments
POST /api/staging-participant/v1/nostr-post
POST /api/staging-participant/v1/promote-source-post
POST /api/staging-participant/v1/sign-topic-suggestion
```

The optional ADR-0023 eligibility status interface is
`GET /api/civic/v1/eligibility/status/:payloadChecksum`, with one
`x-stadtstack-status-nonce` header containing a 32-byte nonce in lowercase hex.
Its resolver rechecks the original private holder and returns a signed public
`active` or `revoked` observation without wallet or chain evidence. Unknown
receipts return 404; expiry, invalid evidence and the bounded inspection timeout
return generic 503. It has no write capability. Production composition shares
the issuance policy, issuer key and pinned CitizenNFT verifier. Status remains
disabled unless all three dedicated environment inputs below are present;
startup checks the supplemental database contract before opening a socket.
Governed deployment still requires the municipal policy, responsible operator,
separate Case Steward nonce consumer and reviewed operations wiring.
See [ADR 0023](../../docs/adr/0023-city-neutral-citizen-eligibility-and-suggestion-adoption.md).

| Variable | Activation value |
| --- | --- |
| `ROEBEL_STAGING_PARTICIPANT_GATEWAY_CITIZEN_ELIGIBILITY_STATUS` | `enabled` |
| `ROEBEL_STAGING_PARTICIPANT_GATEWAY_CITIZEN_ADOPTION_STATUS_MIGRATION_SHA256` | Reviewed SHA-256 of `20260906_staging_citizen_adoption_status_readiness.sql`, prefixed `sha256:` |
| `ROEBEL_STAGING_PARTICIPANT_GATEWAY_CITIZEN_ADOPTION_STATUS_DATABASE_SCHEMA_SHA256` | SHA-256 of `staging-citizen-adoption-status-schema-contract-v1.json`, prefixed `sha256:` |

Omit all three to preserve the disabled default. Partial inputs and other mode
values are configuration errors. The runtime never installs migrations.

`createRestrictedSupabaseCitizenStatusReader` implements the private read port
with one fixed RPC, pinned municipality/policy, an eight-second transport timeout
and no redirects. The additive
[`20260905_staging_citizen_eligibility_status_lookup.sql`](../../supabase/migrations/20260905_staging_citizen_eligibility_status_lookup.sql)
joins one issued receipt to its consumed challenge and returns only the original
holder and public receipt to the issuer. The Vault-bound gateway header is
mandatory; ordinary browser roles cannot read the private tables. The old public
receipt RPC stays unchanged. Before deployment, operations must independently pin
the holder and exact-event acceptance migrations plus the supplemental
[`20260906_staging_citizen_adoption_status_readiness.sql`](../../supabase/migrations/20260906_staging_citizen_adoption_status_readiness.sql).
Its preflight checks both reviewed function bodies, signatures, owners,
search paths, execution permissions and absence of overloads, then preserves
the older adoption preflight's private-table and catalog checks. It creates no
new table. Startup, internal readiness and every enabled status request use the
same live gate. A status request's eight-second deadline includes that gate;
late work cannot begin another private read or sign an observation.

Case, vote, treasury, administration, municipal publication and arbitrary
workbench actions are not representable by its data adapter.

Request bodies have route-specific UTF-8 limits: 8 KiB for the original six
routes, 16 KiB for source-post promotion, and 64 KiB for the complete signed
topic-suggestion envelope. The browser applies the same limits before writing
its durable outbox. Within the signed protocol, each evidence URL is at most
2,048 characters and each agent name/node identifier at most 120 characters.
An oversized envelope is therefore rejected before persistence instead of
becoming an unrecoverable replay loop.

## Runtime contract

The process fails closed unless all of these are present:

| Variable | Purpose |
| --- | --- |
| `ROEBEL_STAGING_PARTICIPANT_GATEWAY=enabled` | explicit staging kill switch |
| `ROEBEL_STAGING_PARTICIPANT_GATEWAY_ORIGIN` | exact HTTPS browser origin, with no path |
| `ROEBEL_STAGING_PARTICIPANT_GATEWAY_SESSION_KEY` | random 32+ byte cookie HMAC key |
| `ROEBEL_STAGING_PARTICIPANT_GATEWAY_INVITE_SHA256` | SHA-256 of the bounded test invite |
| `ROEBEL_STAGING_PARTICIPANT_GATEWAY_ALLOWED_WALLETS` | comma-separated allowlist of 1–8 lowercase tester wallet addresses |
| `ROEBEL_STAGING_PARTICIPANT_GATEWAY_GNOSIS_RPC_URL` | Gnosis signature verification RPC |
| `ROEBEL_STAGING_PARTICIPANT_GATEWAY_SUPABASE_URL` | staging Supabase HTTPS origin |
| `ROEBEL_STAGING_PARTICIPANT_GATEWAY_SUPABASE_ANON_KEY` | browser-public PostgREST routing key |
| `ROEBEL_STAGING_PARTICIPANT_GATEWAY_SUPABASE_RPC_SECRET` | 32+ byte capability also stored in Supabase Vault |
| `ROEBEL_STAGING_PARTICIPANT_GATEWAY_PORT` | listener port |
| `ROEBEL_STAGING_PARTICIPANT_GATEWAY_MECKY_PUBKEY` | exact 64-hex public key allowed in the only `p` tag |
| `ROEBEL_STAGING_PARTICIPANT_GATEWAY_PRIVATE_WORKBENCH_URL` | exact cluster-local HTTP workbench URL; public URLs fail closed |
| `ROEBEL_STAGING_PARTICIPANT_GATEWAY_PRIVATE_WORKBENCH_ADMISSION_HEADER` | fixed existing gate: `x-stadtstack-e2e:1` |
| `ROEBEL_STAGING_PARTICIPANT_GATEWAY_SOURCE_REVISION` | exact 40-hex deployment pin; must equal the revision compiled into the image |
| `ROEBEL_STAGING_PARTICIPANT_GATEWAY_MANIFEST_DIGEST` | immutable `sha256:<64 hex>` OCI manifest pin |
| `ROEBEL_STAGING_PARTICIPANT_GATEWAY_MIGRATION_SHA256` | raw source SHA-256 of the reviewed migration, bound by release evidence |
| `ROEBEL_STAGING_PARTICIPANT_GATEWAY_DATABASE_SCHEMA_SHA256` | raw SHA-256 of the canonical catalog-contract JSON |
| `ROEBEL_STAGING_PARTICIPANT_GATEWAY_TOPIC_TRACER_MIGRATION_SHA256` | raw SHA-256 of ADR0022's additive durable-ledger migration |
| `ROEBEL_STAGING_PARTICIPANT_GATEWAY_TOPIC_TRACER_DATABASE_SCHEMA_SHA256` | raw SHA-256 of ADR0022's canonical tracer contract JSON |

The RPC secret is sent only to two write functions, one exact
participant-owned-source read, and the two durable mirror-receipt transitions
and three closed source/binding resolvers plus two no-argument catalog
preflights as a private header.
It is not a Supabase service-role key, custom database JWT, citizen credential,
or cluster credential. Do not log request headers.

Challenge issuance requires both a matching invite and membership in the
configured wallet allowlist. The invite alone can never enroll another wallet.

`nostr-post` is not a generic signed-event proxy. It accepts one closed body
only after the normal participant post exists: session wallet, wallet↔Nostr
binding plus Gnosis wallet signature, Nostr kind/signature/fresh timestamp,
exact source ownership/content and exactly these tags must agree:

```text
["p", configuredMeckyPubkey]
["source-app-post", sourcePostId]
```

The private adapter first calls the existing workbench admission endpoint and
then its fixed `intent: "post"` endpoint. It cannot select a workbench method,
event intent, conversation, promotion, argument, case, vote or treasury action.
Its target is pinned byte-for-byte to
`http://e2e-workbench.stadtstack-roebel-staging-lab.svc.cluster.local:18083/`;
another cluster Service, namespace, port, path, credentials, or header fails
closed. A relay failure leaves the same immutable receipt `reserved`, so a
retry can only repeat the identical signed event—not replace it.

Session cookies are always `Secure`, `HttpOnly`, and `SameSite=Strict`; no
runtime flag can weaken that production resolver. The first deployment must
run exactly one replica. Challenge consumption is atomic inside that process
but intentionally in-memory; restart invalidates outstanding challenges. The
store prunes stale/consumed entries, replaces an older challenge for the same
wallet, and has a hard capacity. Ingress must additionally rate-limit these
eight paths. A multi-replica deployment requires a durable atomic
`ChallengeStore` implementation and corresponding replay tests first.

## Activation prerequisite

The code does **not** claim that the required NetworkPolicies already exist.
Before activation, GitOps must review an exact gateway egress allowance only to
the pinned workbench Service on TCP 18083, and a reciprocal workbench ingress
allowance only from the gateway's exact ServiceAccount/pod selector on TCP
18083. DNS, Gnosis RPC and staging Supabase remain separately constrained.
Without both directions, leave `nostr-post` disabled.

## Internal readiness

`GET /status` is an internal Service-only probe and is deliberately absent from
Ingress. It rejects query strings, every non-GET method, `Origin`, and cookies.
It returns `503` with only `schemaVersion` and `not_ready` unless the fixed
Supabase preflight verifies the armed Vault gate, migration marker, current
catalog/ACL/trigger facts (including the live comment-count trigger executable), captured rollback evidence, and the canonical schema
hash. It additionally requires the ADR0022 ledger/RLS/catalog preflight and
its exact additive contract hash. A ready response additionally reports the
compiled source revision and all immutable deployment pins. It grants no civic, Case, vote, treasury,
or administration authority.

The source revision is compiled into the esbuild bundle with JSON escaping. A
full checkout quality build may derive it from `git rev-parse HEAD` only when
the Git worktree is clean; otherwise it fails closed. The protected pruned OCI
build supplies the exact Docker `SOURCE_REVISION` explicitly and fails closed
if it is not a 40-character lowercase Git revision. No runtime environment
variable or writable file supplies that compiled value.

`pnpm start` and the package binary execute only the generated
`dist/staging-participant-gateway.cjs`. They fail closed when that bundle has
not first been built; they never execute the TypeScript source with an
undefined build-time revision constant.

## Source verification

The focused tests need no container build:

```sh
pnpm --filter @roebel/staging-participant-gateway test
pnpm --filter @roebel/staging-participant-gateway typecheck
```

The immutable image uses a small esbuild bundle and a runtime-only Node layer.
It does not compile the Röbel Next.js page inventory.
