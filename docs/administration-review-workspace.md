# Administration review workspace

Status: local implementation for roadmap 7B; locally browser-verified; not deployed.
The staging review runtime rollout (7A) and public Citizen Brief/Mecky return
(7C) remain separate, unfinished dependencies.

`/verwaltung` displays the adopted Case, the user's assigned test roles and
department packages. Department authors can save a public answer with sources;
department reviewers can accept or reject that exact draft. The coordinator
sees overall brief readiness and can assign configured departments from the page. Brief preparation/publication is not exposed
by this gateway.

## Connection

Browser → `/api/workspace/case-review` → existing server-side OIDC session →
explicit subject-to-role grant → private Stadtstack administration review API.

The page sits outside the organisation dashboard layout: owning a Röbel
organisation or wallet does not establish a municipal role. It reuses the
existing workspace OIDC login and opaque `roebel_ws` session. No new identity
provider, session implementation, frontend deployment or desktop shell is added.

The existing workspace configuration gate still applies. It currently requires
OIDC, Nextcloud and Collabora settings; this change does not decouple them. Verify
the configured issuer, callback, durable session store and actual test-account
subject in the intended deployment before assigning a grant. An existing app
wallet login alone is insufficient. Municipal employment/authority is not claimed.

## Deployment configuration

Set the server-only `ROEBEL_ADMIN_REVIEW_CONFIG_FILE` to a read-only private JSON
file containing the following `ReviewGatewayConfig` fields:

| Field | Meaning |
| --- | --- |
| `environment` | Exactly `staging` |
| `publicOrigin` | Exact HTTPS origin serving the page |
| `upstreamOrigin` | HTTPS origin, or the explicitly admitted staging cluster service origin in `gateway.ts` |
| `caseId` | The one synthetic Case served by this deployment |
| `assignmentTargets` | Optional department directory; absent/empty disables new assignments |
| `grants` | Explicit role mappings below; never a `NEXT_PUBLIC_*` value |

Each grant contains `id` (unique role selector), `label`, `subject` (verified OIDC
`sub`), `actorId`, `actorClass`, `token`, `notBefore` and `expiresAt`. Times are
Unix milliseconds. Each token must be a distinct canonical base64url encoding
of 32 random bytes and match an existing upstream staging grant for that actor
and Case. This file neither creates nor extends an upstream grant. Bind both
ends to the same validity window. Keep the file private and never commit it.

Each assignment target has `departmentId`, `label`, `assignedAgentActorId` and
`assignedReviewerActorId`, matching the upstream department registry. Only the
case steward receives this directory. The gateway rejects an assignment using
unconfigured departments or different actors before forwarding it. Actor
references in the directory are not credentials.

Only the subject's current grants are selectable. Role selection cannot supply
an actor, Case or upstream address. POST requires same-origin JSON; cookie and
browser authorization headers are not forwarded. The upstream remains
responsible for department scope, checksums, versions and write authorization.
Responses are not cached; upstream errors are replaced with fixed messages.

An uncertain write requires reading current state before resubmission. The UI
does not automatically replay a mutation. Every draft/review uses the displayed
Case version and package/draft checksum.

## Verification and remaining acceptance

Run the dependency-free boundary tests with the repository's supported Node:

```sh
node --experimental-strip-types --test apps/web/tests/administration-review-gateway.test.ts
```

Six tests cover grant isolation, expiry, request origin, bounded bodies,
credential forwarding and response containment. On 2026-09-11 these passed;
the gateway, tests and page also passed strict TypeScript checking using
the actual React 19 types. The route passed syntax/transpile checks. A separate local integration check exercised
the published Stadtstack PR70 source with real temporary SQLite state:
admission v3 → assignment v4 → draft v5 → accepted review v6, still accepted
after reopening storage. Its session/fetch adapter was injected; this does not
verify deployed OIDC, HTTP transport or a browser session.

Local browser verification also completed assignment → answer with source →
accepted review → reload with the accepted result visible. This used the actual
page/gateway and temporary Stadtstack SQLite state, with an injected test login
and in-process upstream transport. Six boundary tests include configured
assignment targets and actor-forgery rejection. Duplicate clicks are guarded;
uncertain writes disable mutations until current state is reloaded.

A recorded draft is immutable through this API. The page therefore hides the
new-draft form once a draft exists, and shows review buttons only while review
is pending. Rejected drafts need the separate backend correction operation,
which is not yet exposed by this gateway.

Remaining: full Next typecheck/build and deployed browser/OIDC acceptance,
deployment-specific OIDC/grant configuration, network reachability, active 7A
runtime and hosted rollout. Then verify one account's permitted roles through
the actual page before completing all eight department reviews and the public
return. Do not mark step 7 complete based on this source checkpoint.
