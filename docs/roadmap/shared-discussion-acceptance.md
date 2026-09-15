# Shared discussion and independent accounts

Status: implementation and local verification complete; publication, activation
and independent-user acceptance pending, 2026-09-15.

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

Activation requires the comment migration, new gateway/Web images, and the exact
new ingress method/path. The old ingress denies the new path. Source tests and a
local PostgreSQL rehearsal are not evidence of live deployment or multi-person
onboarding. Preserve the existing B198 Case; use the separate complete fictional
example for the richer demonstration instead of rewriting its historical answers.

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
