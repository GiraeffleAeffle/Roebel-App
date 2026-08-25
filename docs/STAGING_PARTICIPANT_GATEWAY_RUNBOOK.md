# Staging participant gateway runbook

This is the deployment checklist for [ADR 0021](adr/0021-bounded-staging-participant-gateway.md).
It is intentionally separate from the Kair/openDesk exchange work and from
production citizen verification.

## 1. Read-only database preflight

Before applying the migration, record evidence for the exact staging project:

- its project reference is the dedicated staging reference, not production;
- `app_settings.roebel_env` is exactly `staging`;
- the live columns and constraints of `users`, `posts`, and `post_comments`;
- `pg_get_functiondef('public.enforce_posting_rules()'::regprocedure)` and its
  trigger binding;
- `pg_get_triggerdef` for `trg_post_comment_counts` and
  `pg_get_functiondef('public.post_comment_counts_sync()'::regprocedure)`;
- current policies/grants on those three tables and all five proposed restricted
  RPC names (two writes, one owned-source read, reserve and complete mirror);
- current INSERT/UPDATE/DELETE grants on `app_settings` and `post_likes`;
- the legacy caller-asserted delete and `pin_own_post` RPC definitions and grants;
- Vault and `pgcrypto` availability.

Abort on any mismatch. The source schema contains historical/manual SQL, so a
filename in Git is not proof of the live catalog.

## 2. Provision without copying secrets into Git

Provision the private Vault arm
`roebel_staging_participant_environment_arm=staging-only` only in the exact
reviewed staging project. Its existence—not the client-visible setting—is the
database deployment authority.

Generate three independent random values outside the repository:

1. session HMAC key;
2. one bounded test invite (store only its SHA-256 in Kubernetes);
3. RPC capability (store the same value in Supabase Vault under
   `roebel_staging_participant_rpc_secret` and in the gateway Secret).

Configure `ROEBEL_STAGING_PARTICIPANT_GATEWAY_ALLOWED_WALLETS` with 1–8 exact
lowercase tester wallet addresses. Challenge issuance requires both allowlist
membership and the invite, so disclosure of the invite cannot enroll another
wallet.

The public Web receives none of them. The Supabase anon/publishable key is a
routing key, not the writer capability. Never substitute a service-role key,
database password, custom writer JWT, Hetzner inference token, or cluster-admin
credential.

## 3. Apply and verify the migration

Apply `20260825_staging_participant_gateway.sql` transactionally only to the
armed staging project. Then verify:

- direct anon/authenticated insert, update, or delete on `posts` and
  `post_comments` fails, including a request that spoofs an existing citizen
  wallet or a mutable user projection;
- anon/authenticated mutation of `app_settings`, `post_likes`, or invocation of
  the caller-asserted delete/pin RPCs fails for the activation window;
- missing/wrong RPC header, non-allowlisted wallet, expired/revoked admission, reused
  request ID with changed content, URL/media/poll/account attempts, invalid
  parent, and quota overflow all fail;
- a valid request creates one exact main-feed text row and one private audit
  receipt; retrying the same request ID returns the same row;
- reserve a participant `nostr-post` receipt twice concurrently and after a
  gateway restart; it must retain the first event ID and content SHA-256, retry
  only that event after a relay failure, and reject every replacement;
- the preflighted `trg_post_comment_counts` changes the comment counter exactly
  once; the restricted RPC performs no second manual increment;
- a missing first-login projection is provisioned only as `tier='guest'`,
  `is_verified_citizen=false`, `verification_status='pending'`, without a
  personal account, organisation membership, or civic authority;
- post reactions are paused atomically in this staging activation: both the UI
  and direct `post_likes` INSERT/DELETE privileges are closed;
- neither function can address proposal, Case, vote, treasury, administration,
  citizenship, account ownership, upload, links, or arbitrary tables.

## 4. GitOps boundary

Deploy the gateway as its own immutable image and ServiceAccount with exactly
one replica. Route only the six reviewed method/path pairs from ingress.
Verify that both challenge and session cookies are scoped to
`/api/staging-participant/v1`; requests to `/app`, other `/api` paths and static
assets must not carry them.
NetworkPolicy permits ingress only from the ingress controller and egress only
to DNS, the reviewed Gnosis RPC, staging Supabase, and exactly
`e2e-workbench.stadtstack-roebel-staging-lab.svc.cluster.local:18083`. The
workbench must also have the reciprocal TCP/18083 ingress allowance selected
only for this gateway workload. These are activation prerequisites—not a claim
that operations manifests already contain them. Do not mount a Kubernetes API
token. Keep the current read-only Web and exact Mecky route unchanged.

The ingress must also apply a dedicated request-rate limit to the six gateway
paths. The single-replica challenge store prunes expired/consumed entries,
replaces a wallet's older pending challenge, and caps pending entries; the
ingress limit is the outer protection if an invite is disclosed.

The first browser receipt is:

```text
Thirdweb/passkey wallet
  → invite + wallet signature
  → short participant session (authority:none)
  → ordinary text post
  → ordinary text comment
  → revoke admission
  → next write denied
```

That receipt does not complete the signed-feed slice. The next separately
reviewed activation must bind the same wallet to a signed Nostr event before
discussion promotion and same-thread Mecky are accepted.

The signed post mirror atomically reserves the first wallet/source/request/
event/content receipt before it calls the workbench. A relay outage leaves that
exact receipt pending for retry; no different event may replace it. Until the
reciprocal NetworkPolicies and this route are activated, participant text may
contain `@Mecky`, but the Web must not call the existing workbench routes: those
routes do not validate the participant session and remain closed at ingress.
The UI reports this honestly instead of promising an answer that cannot be
produced safely.

## 5. Deactivation and compatibility rollback

Remove the six ingress routes and roll Flux back to the previous immutable
release first. Then run `supabase/staging_participant_gateway_deactivate.sql`.
That transaction revokes all five gateway RPCs, revokes every admission, restores
the exact prior posting-trigger definition and table/function grants captured
by the activation, and preserves the dedicated schema, audit rows, guest
projection, and public posts/comments as staging evidence. Verify the captured
catalog hashes after restoration. Rotate/delete the Vault and Kubernetes
capabilities only after the receipt is retained. Do not delete source history
or rewrite signed events.
