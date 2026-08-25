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
```

Case, vote, treasury, administration, municipal publication and arbitrary
workbench actions are not representable by its data adapter.

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

The RPC secret is sent only to two write functions, one exact
participant-owned-source read, and the two durable mirror-receipt transitions
as a private header.
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
six paths. A multi-replica deployment requires a durable atomic
`ChallengeStore` implementation and corresponding replay tests first.

## Activation prerequisite

The code does **not** claim that the required NetworkPolicies already exist.
Before activation, GitOps must review an exact gateway egress allowance only to
the pinned workbench Service on TCP 18083, and a reciprocal workbench ingress
allowance only from the gateway's exact ServiceAccount/pod selector on TCP
18083. DNS, Gnosis RPC and staging Supabase remain separately constrained.
Without both directions, leave `nostr-post` disabled.

## Source verification

The focused tests need no container build:

```sh
pnpm --filter @roebel/staging-participant-gateway test
pnpm --filter @roebel/staging-participant-gateway typecheck
```

The immutable image uses a small esbuild bundle and a runtime-only Node layer.
It does not compile the Röbel Next.js page inventory.
