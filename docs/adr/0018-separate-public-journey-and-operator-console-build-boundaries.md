# ADR 0018: Separate public journey and operator-console build boundaries

## Status

Proposed; no route extraction or deployment split is authorized yet.

## Context

The current `apps/web` image compiles the public Röbel experience and the
operator product as one Next application. Of 226 page routes, 75 live below
`/admin` (one login page and 74 dashboard pages) and 36 below `/dashboard`:
111 routes, almost half of the page graph, belong to administration,
publishing, partner and builder workflows rather than the public feed and
civic journey. The protected staging publisher spends about six minutes on
the verified Web job; the standalone Next build is its dominant step.
Increasing webpack parallelism from two to four changed the exact Next build
from 363.5 seconds to 358.5 seconds, so runner slots are not the limiting seam.

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
