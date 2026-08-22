# ADR 0018: Separate public journey and operator-console build boundaries

## Status

Proposed; no route extraction or deployment split is authorized yet.

## Context

The current `apps/web` image compiles the public Röbel experience and the
operator product as one Next application. Of 226 page routes, 75 live below
`admin` and 36 below `dashboard`: 111 routes, almost half of the page graph,
belong to administration, publishing, partner and builder workflows rather
than the public feed and civic journey. The protected staging publisher spends
about six minutes inside `next build` and roughly ten minutes end to end.
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
- **Röbel Operator Console** owns `/admin`, `/dashboard` and other privileged
  publishing or builder workflows on a separately protected origin.

Shared packages may expose stable domain contracts, UI primitives and typed
adapters. They must not import either application's routes, runtime
configuration or provider-specific session hooks. Each deployable receives its
own least-privilege configuration, image digest, SBOM, admission checks and
Flux `Kustomization`. The Release Set can advance either component without
rebuilding the unaffected one.

The extraction begins only after the first complete Thirdweb-backed civic
journey passes staging. Until then, measured reversible compiler changes may be
accepted independently; they do not count as implementing this ADR.

## Acceptance gates

- route ownership is enumerated before any move, including redirects and links;
- public semantic tests cover signup, feed, post detail and the civic journey;
- operator tests cover every moved privileged route and deny public access;
- the public image contains no operator route bundle or operator-only secret;
- an ordinary public-Web change builds, verifies and becomes GitOps-ready in
  under five minutes on the standard public runner, measured over three runs;
- rollback can independently restore the previous public or operator digest.

## Consequences

The split adds a second deployable and forces currently implicit interfaces to
become explicit. In return, public changes stop compiling an unrelated control
plane, privileged dependencies leave the public artifact and future product
slices can keep one civic journey without keeping one giant build boundary.
