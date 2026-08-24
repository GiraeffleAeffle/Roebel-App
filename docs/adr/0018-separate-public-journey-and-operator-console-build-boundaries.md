# ADR 0018: Separate public journey and operator-console build boundaries

## Status

Proposed; no route extraction or deployment split is authorized yet.

## Context

The current `apps/web` image compiles the public Röbel experience and the
operator product as one Next application. The corrected 2026-08-24 hosted
baseline at source `42d5ffab4725a6d6f327b991cf97755ae498575c` emitted 361
route entries: 227 page entries and 134 route-handler entries. Separately, the
source tree contains 226 `page.*` files: 75 below the top-level `/admin` tree
and 36 below the top-level `/dashboard` tree. Generated route entries and
source files are different measures and must not be added. The first `/admin`
extraction therefore removes 75 source page files (about one third of the
source pages), not a previously claimed 187 pages; its compile-time effect must
be measured rather than inferred from that ratio.

That exact post-checkout verified pipeline took 325.589 seconds: 1.623 seconds
to prune, 30.738 seconds to fetch the scoped offline inputs, 52.469 seconds to
materialize them, 198.133 seconds in Next, 0.626 seconds assembling the runtime,
19.528 seconds packaging the OCI archive and 22.472 seconds of bounded
unattributed orchestration and verification. The complete hosted Web job took
6 minutes 7 seconds including runner setup and artifact upload. The standalone
Next build is therefore the dominant measured step. Earlier experiments that
increased webpack parallelism from two to four changed an exact Next build from
363.5 seconds to 358.5 seconds, so runner slots alone are not the limiting seam.
Compiler-cache, dependency-cache and Turbopack trials were slower, larger or
failed existing page-data gates and remain rejected.

These surfaces also have different authority. The public app owns ordinary
posts, profiles, topics, discussions and the visible civic journey. The
operator surface owns privileged review, publishing and configuration. Keeping
them in one compiled and deployed artifact increases build time, dependency
reach and the public runtime's authority-shaped code surface.

## Decision

Keep one repository and shared domain language, but move toward two deep
deployable modules:

- **Public Röbel Web** owns signup, the general feed, post detail, profiles,
  civic topics, discussions, Mecky interaction and the attributable journey.
- **Röbel Operator Console** ultimately owns `/admin`, `/dashboard` and other
  privileged publishing or builder workflows on a separately protected
  origin.

The first extraction is deliberately smaller than that destination:

1. a new `apps/roebel-operator` deployable owns canonical `/admin/login` and
   `/admin/dashboard/**` routes;
2. `apps/web` removes its `src/app/admin` tree but keeps `/dashboard`, the
   existing `/api/mini-apps/*` handler family and all public/citizen routes;
3. the public component and image keep their existing `roebel-web-staging`
   identity so public rollback history is not renamed;
4. the new operator component uses an independent
   `roebel-operator-staging` image, digest, deployment and rollback head;
5. after the operator deployment is healthy, the public origin returns a
   temporary `307` transition redirect with `Cache-Control: no-store` for
   historical `GET` and `HEAD` `/admin/:path*` navigation to one allowlisted
   canonical operator origin,
   preserving the path remainder and query string. Other methods, including
   stale Server Action requests, are never redirected across origins.

`/dashboard` is deferred because it currently shares mini-app, developer and
session boundaries with public code. Moving it in the first slice would also
move authority-neutral pages or leave cross-application Server Actions. A
later decision may extract it only after those contracts have their own
ownership and browser acceptance tests.

The extraction also closes the current operator-authentication ambiguity. One
`OperatorSession` interface and one signed server verifier guard the operator
origin. The duplicate unsigned root middleware and legacy hard-coded admin
login are retired. Every privileged command calls `requireOperator()` at the
command seam; a protected layout or route middleware is not sufficient
authorization. `OperatorSession` binds a signed principal, operator role and
capabilities, Röbel municipality scope, issuer, audience, expiry and key
version/rotation policy. `requireOperator()` verifies those claims rather than
wrapping the legacy boolean `isAuthenticated()` check. The operator session
cookie is host-only, `Secure`, `HttpOnly` and `SameSite=Strict`; it is never shared
with the public Thirdweb/citizen session. Shared packages may contain pure
types, UI primitives and domain functions, but never a Next Server Action
owned by the other deployable.

Moving the route tree alone is insufficient. Before the move, an ownership
inventory classifies every `/admin` route, `src/app/actions` module, API route,
component, environment variable and secret as public, operator or neutral.
Operator commands and API handlers move behind operator-owned adapters and
`requireOperator()`. Pure UI and types currently imported across `/admin`,
`/dashboard` and public components move to neutral packages. Retained public
routes do not import the operator application's actions, components, runtime
configuration or credentials.

Shared packages may expose stable domain contracts, UI primitives and typed
adapters. They must not import either application's routes, runtime
configuration or provider-specific session hooks. Each deployable receives its
own least-privilege configuration, image digest, SBOM, provenance, admission
checks and Flux `Kustomization`. A shared-package change builds both
components; a component-only change builds only its owner. The Release Set can
advance either component without rebuilding the unaffected one.

The extraction begins only after the first complete Thirdweb-backed civic
journey passes staging. Until then, measured reversible compiler changes may be
accepted independently; they do not count as implementing this ADR.
Hosted builds record stage timing and route-count regression evidence during
that period. Those measurements protect the budget but do not pretend to be a
latency improvement.

The measurement artifact contains absolute, ordered intervals for prune,
offline fetch, dependency materialization, the Next build, runtime assembly
and OCI packaging. It is bound to the independently re-verified OCI archive
and receipt. Route evidence is aggregate-only: the short-lived artifact keeps
counts and digests, while the canonical manifest containing route names stays
private to the runner and is never uploaded.

Container-local phase offsets are re-anchored to the host pipeline clock before
validation. Host and container wall clocks are never compared directly, so a
runner's virtualization offset cannot fabricate an overlap or push an otherwise
valid phase outside the measured pipeline. The pinned Node runtime supplies
millisecond offsets with `Date.now()` rather than relying on container-specific
`date` formatting. Evidence also records attributed and unattributed duration
and fails when more than two minutes of the verified pipeline are unexplained;
this prevents a seconds-versus-milliseconds clock regression from producing
plausible-looking measurements.

The OCI binding is evaluated from one private archive snapshot, created with
mode `0600` and sealed mode `0400` before verification.
The source archive is opened without following symlinks and without blocking,
is capped at 160 MiB before allocation, and must retain the same device, inode,
size and timestamps before, during and after the copy. The digest is paired
with that post-seal identity, and any mismatch is rejected before member
validation or extraction. Its digest, validation and extraction therefore
refer to the same bytes. The outer archive
accepts only regular OCI metadata/blob members and the two OCI directories;
each member is size-capped before extraction, while sparse, PAX, link and
duplicate members are rejected. Each layer is then opened once with the same
no-follow/non-blocking identity check and copied into a private snapshot.
Prefix inspection and streaming tar validation consume that one snapshot, so a
replacement, symlink or FIFO cannot race those reads. Layer parsing caps every
layer at one GiB expanded data and 250,000 headers, and caps the complete image
at 64 layers, two GiB expanded data and one million headers. Evidence
generation never invokes an unbounded external decompressor or pre-reads an
extracted layer blob. Checksums, receipts, stage timings and route/runtime
manifests use the same bounded, regular-file snapshot discipline before
parsing.

That snapshot is also the delivery boundary. Immediately after Buildx, one
preparation process snapshots and validates the raw runner-private output
before any extraction, derives the receipt, checksum and aggregate evidence
from the validated bytes, and exclusively exposes the same inode at the final
artifact path. The upload step cannot observe the unvalidated Buildx path or a
second archive copy. Direct and deferred OCI verification import the same
64-layer ceiling and enforce it immediately after manifest parsing, before any
layer blob is opened. The pipeline finish timestamp is sampled only after that
snapshot has been extracted and verified, so validation remains visible as
bounded unattributed pipeline time rather than falling outside the evidence.

That aggregate-only statement applies exclusively to the separate measurement
evidence artifact. The existing runtime-delivery artifact remains unchanged in
name, contents and retention; as executable application code, its OCI layers
can inherently contain route strings and are not telemetry. The two upload
boundaries must not be combined.

## Acceptance gates

- route ownership is enumerated before any move, including redirects and links;
- Server Actions, API handlers, shared components, environment variables and
  secrets have an explicit public/operator/neutral owner before routes move;
- the public route manifest contains no `/admin` page or operator-only bundle;
- historical `GET` and `HEAD` `/admin/*` navigation maps to the exact
  allowlisted operator host and preserves path and query only after the new
  deployment passes its health gate; all other methods remain unredirected;
- public semantic tests cover signup, feed, post detail and the civic journey;
- operator tests cover every moved sidebar route, reject missing or invalid
  signed sessions and prove every privileged command invokes
  `requireOperator()`;
- the public image contains no `src/app/admin` or `.next/server/app/admin`
  bundle, moved operator command implementation or operator-only secret;
- public and operator images each have an immutable digest, SBOM, provenance,
  compare-and-swap GitOps head and independent rollback contract;
- public and operator promotion heads advance independently; neither component
  is implicitly promoted because the other one changed;
- an ordinary public-Web change builds, verifies and becomes GitOps-ready in
  under five minutes on the standard public runner, measured over three
  independent runs from job start through verified published digest and
  Release Set candidate; separately gated Flux reconciliation is excluded;
- the first cut retains a pinned pre-split public-Web digest and ingress
  configuration as a time-bounded fallback, and proves compare-and-swap
  removal of the transition redirect plus restoration of that digest;
- after the first successful operator release, rollback can independently
  restore the previous public or operator digest.

## Consequences

The split adds a second deployable and forces currently implicit interfaces to
become explicit. In return, public changes stop compiling an unrelated control
plane, privileged dependencies leave the public artifact and future product
slices can keep one civic journey without keeping one giant build boundary.
