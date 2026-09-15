# Shared discussion and independent accounts

Status, 2026-09-15: the four discussion views and signed shared-feed answer are
deployed and verified with the existing test participant. Separate-user
onboarding and the complete fictional demonstration remain open.

The technical synthetic Case return is proved. Independent people completing
that journey in their own browsers is the next acceptance gate. A generated
persona, an operator signing for several accounts, and a real person controlling
an account are different kinds of evidence.

## Next complete demonstration

1. Two citizens sign into Röbel separately, activate an invitation for their own
   allowed test wallet, and publish different comments in the same feed. Signing
   in alone must not imply test participation, residency or voting rights.
2. One citizen mentions `@Mecky` in a comment. Its signed answer, source links and
   synthetic-source label are visible to the other citizen in that same feed.
   A reload preserves the conversation. A lost response cannot duplicate it.
3. Participants develop the argument tree and explicitly adopt a proposal.
   The Case steward accepts it into a separately identified synthetic Case.
4. Department staff sign in with distinct subjects and assigned roles. Each
   sees only its work. Reviewers and the steward confirm the exact response
   versions; an unaffiliated citizen cannot self-select any staff role.
5. The resulting Brief contains usable options, costs, constraints and evidence
   under clearly fictional assumptions. It returns to the same discussion and
   Mecky cites it when participants ask follow-up questions in the feed.
6. Participants compare the returned options. A changed department response
   invalidates the old Brief until reviewed again. A formal decision, budget
   approval or execution requires its own authorized transition and evidence.

## Account access today

- **Citizen App:** existing email/social wallet sign-in is retained. Staging
  first login is deliberately an ephemeral guest view. An invitation and an
  explicit wallet allowlist enable bounded test posts/comments; the first signed
  write creates the minimum unverified guest row. Personal profile persistence,
  recovery and the passkey/Safe migration remain ADR 0014 work.
- **Town Workspace:** the independent staging issuer currently uses a browser
  wallet proof and an allowlist. Server-side OIDC subjects receive explicit,
  expiring department/steward grants. An app wallet does not automatically become
  a staff identity. Account switching must revoke the local workspace session
  and request fresh authentication at the issuer.
- **Remaining onboarding work:** let each intended tester control a credential,
  register the public wallet in the appropriate allowlist, deliver the citizen
  invitation, assign staff roles separately, and verify the resulting sessions
  in independent browsers. The current single operator account is not this
  acceptance proof. A user-friendly bridge from the existing app login into the
  staging issuer is still needed for people without a browser wallet.
- **Municipal integration:** OIDC/municipal identity remains the normal staff
  adapter. Future EUDI credentials and app identity links can carry verified
  claims; roles still need an explicit municipal grant. Neither a Nostr key nor
  a wallet balance grants municipal authority.

## Current implementation slice

The discussion has a compact current-state summary and separate views for
arguments, department responses, proposal and background. Existing deep links
select the relevant view. Signed evidence and the original discussion are kept.

`POST /api/staging-participant/v1/nostr-comment` adds the missing comment mention
path. The gateway verifies the current wallet/Nostr proof and exact comment tags.
Two closed database functions reserve/complete an immutable comment receipt after
checking the saved author, main-feed parent, original write audit and content.
It uses the existing workbench, watcher and public reply projection. It grants no
post-promotion, Case, role, vote or budget capability.

The comment migration and gateway/Web rollout are complete. One labelled test
comment received a signed, source-bound Mecky reply that survived reload. This
proves the shared-feed transport with the existing account, not multi-person
onboarding. Preserve the existing B198 Case; use the separate complete fictional
example for the richer demonstration instead of rewriting its historical answers.

The next source change makes the feed read the same verified synthetic return
as the discussion. It binds the exact signed proposal before advancing the test
journey, rejects unavailable or mismatched returns, and reopens review after
withdrawal. Department source links open Fachantworten while preserving the
original signed URL and digest. Explicit department questions restrict synthetic
retrieval to those departments; broader questions retain cross-department search.
This follow-up is locally verified and awaiting source/image publication.

## Options, simulations, map and game connection

The owner confirmed this direction on 2026-09-15. Keep one connected sequence:
discussion and meetings → options → department review → Citizen Brief →
comparison and further discussion → decision and funding → execution and return.
Mecky can explain the permitted records at each stage. Argument trees, sunbursts
and polls show their own inputs; argument counts do not stand for people or votes.

| View | Shared context it consumes | Next bounded integration |
| --- | --- | --- |
| Citizen App and Town Workspace | Discussion, Case, exact reviewed Brief and option versions | Two controlled citizen accounts and separately assigned staff subjects complete the fictional example. |
| Option comparison and simulation | Status quo and alternatives, inputs, units, time horizon, source versions, assumptions and uncertainty | Present capital cost, annual operation, construction time and benefits together; reproduce each scenario from its inputs. The existing local comparison is fictional review scaffolding, not a deployed simulator. |
| Treasury view | Cost scenario plus separately recorded available, requested, approved, committed and spent amounts | Show projected funding gaps without treating a simulated balance or preferred option as a payment authorization. Budget decisions retain their own owner and evidence. |
| Map and timeline | Reviewed public project/Case binding, option geometry, dated milestones and evidence | Add an optional Röbel map layer through the Atlas projection Adapter; retain a list for missing geometry. Layer toggle and 3D rendering do not change Case state. |
| Game chapter | A pinned public scenario snapshot with the same option and source identifiers | Let the player explore different outcomes locally, with a return link to the real discussion. A played outcome cannot advance the live project or cast a vote. |

Before implementing the map/game Adapter, specify a versioned snapshot binding
municipality, topic, discussion, optional Case, project and option identifiers;
source/Brief checksums; scenario/model version; units, baseline and horizon;
geometry CRS and precision; review, withdrawal and freshness. Distinguish observed
facts, estimates and fictional inputs. A project may exist without a Case; matching
titles or map proximity never create that binding. Reviewed municipal context and
research-only Atlas records remain distinguishable.

The existing Atlas exposes `project-atlas-map-v1`, WGS84 geometry and source
references. Its local validator is not yet the trusted remote publication
contract. Röbel retains its Mapbox implementation; Atlas uses MapLibre. The Mecky
game already has a local fictional shade-project chapter, two options, costs and
one project journal. Its participation revision and a live context connection
remain pending. The game uses a local UTM-derived coordinate frame and needs an
explicit geometry Adapter; it must not assume that WGS84 degrees are game metres.

Implement these consumers after the independent-user return demonstration.
Neither a 3D engine rewrite nor a new treasury backend is a prerequisite for step 8.

## Following workflow work

After the independent-user demonstration, add the advisory participation round,
explicit decision owner, execution milestones and returned evidence. The public
project map/timeline and Mecky should read that same permitted Case projection.
openDesk/OpenProject/Matrix and other municipal tools remain adapters to the shared
Case record. Game engagement, passkey/recovery migration and measured frontend /
backend build separation remain separate roadmap items.

## Focused checks

Run `pnpm test:web` and `pnpm --filter @roebel/staging-participant-gateway test`.
The latter exercises comment/post bindings through the real workbench and watcher
with in-memory relays and a deterministic evidence answer. Signature-verifier
fixtures do not prove real Gnosis or browser enrollment.

For database behavior, install `@electric-sql/pglite@0.3.14` in a disposable local
directory and run `packages/staging-participant-gateway/scripts/rehearse-comment-mirror.mjs`
with `PGLITE_MODULE` pointing to that installation's `dist/index.js`. This runs the
actual new migration with minimal source/audit fixtures and verifies 13 ownership,
retry, content, parent, stale-event and privilege cases without a live database.
