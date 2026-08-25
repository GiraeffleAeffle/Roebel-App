# ADR 0021: Bounded staging participant gateway beside the read-only Röbel Web

- Status: Accepted boundary for staging; deployment pending
- Date: 2026-08-25

## Context

The public Röbel staging Web is intentionally a read-only presentation surface.
Its ingress permits `GET`/`HEAD` and only the exact Mecky chat `POST`; its
server-side Supabase origin is read-only and the deployment has no database
writer credential. That is a valuable authority boundary, but it also means an
unverified collaborator who successfully signs in cannot create the ordinary
post needed to exercise the first civic tracer.

Adding enrollment routes and writer secrets to the Web would silently turn a
large, public Next.js deployment into a write authority. A mutable flag on the
public `users` table is not an admission boundary either: current table policy
allows user-controlled projections, and the existing posting trigger correctly
rejects a fresh, unverified account. Broadly permitting Web `POST` would also
expose unrelated server actions and APIs.

The staging tracer needs a deliberately weaker identity than a verified
citizen, but a much narrower capability: one invited, wallet-proved tester may
write text in the ordinary feed and later exercise a signed discussion. That
capability must never imply residency, citizenship, organisation control,
voting, treasury, Civic Case, or municipal authority.

## Decision

Run a separate **Staging Participant Gateway** beside the read-only Web. It is a
small Node/esbuild service with one closed interface:

```text
GET  /api/staging-participant/v1/status
POST /api/staging-participant/v1/challenge
POST /api/staging-participant/v1/session
POST /api/staging-participant/v1/posts
POST /api/staging-participant/v1/comments
POST /api/staging-participant/v1/nostr-post
```

The Web calls these same-origin paths from the browser. The existing Web
Deployment receives no participant secret, writer credential, or additional
write route. Ingress routes only those exact methods and paths to the gateway;
all other Web `POST`, unapproved API paths, and methods remain denied.

The gateway issues a short challenge only when the wallet is on a configured
1–8 address allowlist and the caller also presents the bounded invite. It
verifies the returned wallet signature with the shared
Gnosis verifier, including EOA, ERC-1271 and ERC-6492/counterfactual accounts,
then creates a short-lived, wallet-bound, HMAC-authenticated, `HttpOnly`,
`Secure`, `SameSite=Strict` session scoped only to the common participant API
path, so ordinary Web routes never receive either bearer cookie. Challenges are time-limited and claimed
once. The first deployment is explicitly one replica with a bounded,
expiry-pruned process-local challenge store; multi-replica operation requires
an atomically consuming durable adapter. Invite values are never logged or
stored in plaintext. Expiry, revocation, wallet mismatch, origin mismatch,
invalid signature, replay, capacity exhaustion, or unavailable Gnosis
verification fails closed. Ingress applies an independent rate limit.

Database writes go only through dedicated `SECURITY DEFINER` functions. The
functions require a separate gateway writer capability, compare it to a secret
provisioned outside Git, and consult a private admission/revocation record. The
gateway does not receive Supabase's general service-role key. The functions
may create only:

- a trimmed, text-only, `main`-feed user post for the session wallet; or
- a trimmed, text-only comment under an existing published `main`-feed post.

They force `account_id = null`, no media, video, links, polls or organisation
identity, apply bounded per-wallet rate limits, write an audit receipt, and
return the exact created public row. The posting trigger may recognise only a
secret-derived, one-time private reservation plus the exact constrained row shape; no
public column, request field, JWT claim, or mutable user projection can enable
the bypass. If Thirdweb first login has no durable `users` projection, the
same signed write transaction may create only the minimum non-citizen guest
row (`guest`, unverified, pending). It creates no personal account,
organisation membership, citizen status, or civic authority, and rolls back if
the requested post/comment fails.

On the separately armed staging database, direct `anon`/`authenticated`
insert, update, and delete privileges on `posts` and `post_comments` are
revoked. The old caller-asserted post/comment deletion functions are revoked as
well, as is the caller-asserted post-pinning function. Post reactions are also paused atomically because their legacy counter
path requires direct `posts` UPDATE. This is intentionally staging-only and does not silently change the
production application's compatibility contract.

The first gateway slice owns only ordinary post/comment writes. The immediate
follow-on slice is deliberately smaller than a generic signed-discussion
proxy: it adds exactly one post-mirror endpoint,
`POST /api/staging-participant/v1/nostr-post`. The closed request binds a newly
created participant-owned Supabase post, the same wallet's admission proof,
and one already-signed Nostr event. The gateway accepts only an exact text
mirror whose trimmed content equals the source row and whose tags contain only
the explicit Mecky recipient plus `source-app-post`. It verifies the cookie
session wallet, source-row ownership, wallet↔Nostr binding, event signature,
request replay key and the configured Mecky public key before forwarding the
event to a private post-only relay/workbench adapter. The database atomically
reserves an immutable receipt keyed by wallet and source row before any relay
call, binding the first request ID, event ID and source-content SHA-256. A
crash leaves that exact receipt `reserved`; a retry may publish only the same
event, while a changed request, event or content is rejected forever.

That event is the participant's public `@Mecky` mention. The existing watcher
may answer it, and the existing signed-reply projection renders the cited,
zero-authority answer as a comment under the same normal feed post. When the
answer is grounded only in staging fixtures, it must carry the closed
machine-readable evidence mode `synthetic_reviewed`, and the thread must show
that state instead of implying real Röbel news or RIS evidence.

No generic signed-event endpoint is allowed in this slice. `conversation`,
promotion, argument, Case admission, governance, voting, treasury, municipal
publication, administrative completion and arbitrary workbench commands remain
unreachable. A source-comment mirror and explicit promotion intents require
their own later review after the post-only loop works end to end.

The gateway has its own immutable image, ServiceAccount, Deployment, Service,
NetworkPolicy, Secrets, and namespace-scoped GitOps owner. It accepts ingress
only from the cluster ingress controller and egress only to the approved Gnosis
RPC, staging Supabase endpoint, DNS, and—when activated—the internal signed
Nostr workbench at exactly
`http://e2e-workbench.stadtstack-roebel-staging-lab.svc.cluster.local:18083/`.
It receives no Kubernetes API credential. Activation additionally requires a
reviewed exact gateway→workbench TCP/18083 egress rule and reciprocal
workbench ingress rule selected only for the gateway workload; these manifests
are a prerequisite, not asserted as already deployed. Its runtime and
GitOps resources are labelled `stadtstack.io/civic-authority: none` and
`stadtstack.io/environment: staging`.

## Consequences

- A collaborator can use a real Thirdweb/passkey-controlled wallet in staging
  without being misrepresented as a verified Röbel citizen.
- The first UI integration still requires one Web build. Subsequent gateway,
  admission and rate-limit changes build the small package without compiling
  the roughly 300-page Next.js inventory.
- Direct legacy post/comment writes are paused in this staging project. The
  participant capability is the first signature-proved staging seam, not a new
  production identity model; verified-citizen and organisation writes require
  their own compatible signature-verified route before the same lockdown can
  be adopted in production.
- Activation captures the exact prior posting-trigger definition and affected
  grants. The catalog-bound deactivation transaction restores them while
  preserving staging evidence and audit rows.
- A participant-created Supabase post is not yet proof of Slice 1. Slice 1 is
  complete only when the same connected tester also publishes the bound signed
  Nostr event and the normal feed projection can be rebuilt from that record.
- Participant `@Mecky` text does not call the existing browser workbench route.
  Same-thread answers stay disabled until the exact post-only,
  participant-session-bound signed-Nostr mirror above is reviewed and deployed.
- Disabling the gateway route or revoking the admission immediately removes
  the capability without redeploying the public Web or changing citizen state.

## Rejected alternatives

- **Writer secrets and enrollment in the public Web:** rejected because it
  collapses the read-only presentation and writer authority domains.
- **Permit all Web server-action `POST`:** rejected because it exposes a much
  larger unaudited mutation surface than the tracer requires.
- **Authorize with `users.is_staging_test_participant`:** rejected because a
  user-controlled projection is not an admission authority under current RLS.
- **Give the gateway the Supabase service role:** rejected because the tracer
  needs two functions, not unrestricted database bypass.
- **Put feed writes into the signed-Nostr workbench:** rejected because it
  couples a large diagnostic/signed-event runtime to Supabase social writes.
- **Treat a staging participant as a citizen:** rejected because a successful
  product test does not prove residency or grant civic rights.

## Acceptance gates

- the public Web pod has no participant or writer secret and remains unable to
  mutate the database directly;
- only the six exact gateway method/path pairs are externally reachable;
- EOA, deployed smart-account and counterfactual smart-account signature tests
  pass, while RPC outage, replay, mismatch, expiry and revocation fail closed;
- the writer credential can invoke only the two constrained write RPCs, one
  exact owned-source read and two exact durable mirror receipt RPCs; it cannot
  select or mutate arbitrary application tables;
- direct anonymous/authenticated post/comment mutations fail even when the
  caller spoofs a citizen wallet or mutable user projection;
- post/comment length, shape, parent feed, status and per-wallet rate limits are
  enforced in the database as well as the HTTP adapter;
- audit receipts contain wallet, action, target, timestamp and result but no
  invite, signature, session token, HMAC key or writer credential;
- NetworkPolicy and internal path tests prove Case, vote, treasury,
  administration and arbitrary workbench commands remain unreachable;
- one connected invited tester creates a normal text post and comment in
  Talos staging, then revocation prevents the next write;
- the following signed-Nostr slice binds that same wallet to the emitted event
  and the exact participant-owned source post before the roadmap calls the
  general signed-feed tracer complete;
- the post-only mirror rejects cross-wallet sources, content or tag drift,
  invalid Nostr signatures/bindings, replay, non-Mecky events, arbitrary signed
  events and every promotion/case/vote/treasury intent; concurrent/restarted
  retries can only re-publish the first reserved event ID;
- one participant-created `@Mecky` post produces one signed cited Mecky reply
  under that same normal feed post, with `synthetic_reviewed` visibly labelled
  until a separately reviewed real Röbel source runtime is deployed.
