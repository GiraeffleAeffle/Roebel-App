# ADR 0020: Event-driven handoff of attested staging release sets

- Status: Proposed; bootstrap pending
- Date: 2026-08-24

## Context

The staging publisher already produces an immutable, attested Release Set, but
the operations repository currently discovers it through a cron schedule. The
publisher takes about 7 minutes 45 seconds end to end; the scheduled workflow
then added a measured 19–31 minutes before it started. Run `32726304320`
verified the release but its target `GITHUB_TOKEN` could not create the
operations pull request. An exact manual dispatch then produced the reviewed
operations PR `#20`.

Cron is useful recovery, but it is a poor primary handoff: it is slow, it can
observe a release before the handoff marker is visible, and it obscures which
source revision caused a promotion attempt. The handoff therefore needs a
small, auditable seam between the public publisher and the namespace-scoped
operations reconciler.

## Decision

After publishing and reading back a complete immutable Release Set, the source
publisher invokes one deep **Release Handoff Dispatcher** interface:

```text
dispatchVerifiedReleaseSet(sourceRevision, releaseSetDigest)
```

Its implementation is a dedicated GitHub App installed only on
`GiraeffleAeffle/roebel-staging-operations`. The App has only:

- Actions: write — dispatch the existing operations workflow;
- Pull requests: write — create the reviewed promotion PR when the workflow
  needs that capability;
- Metadata: read.

It has no Contents: write permission and no authority to approve, review,
merge, or bypass branch protection. The source workflow continues to publish
with its scoped `GITHUB_TOKEN`; it never receives operations contents access.
From a protected source-publisher environment it independently mints one
short-lived installation token narrowed to Actions: write and Metadata: read,
uses it only to dispatch, and discards it. The dispatch contains only the
source revision and Release Set digest: no installation token, App private
key, secret-derived value or credential is passed through inputs, artifacts,
outputs or logs.

The operations workflow's own `GITHUB_TOKEN` pushes its generated branch. If
the repository setting that blocked PR creation for run `32726304320` remains
in force, a separately protected operations environment independently mints
a fresh short-lived installation token narrowed to Pull requests: write and
Metadata: read, uses it only for the final PR creation call, and discards it.
The App ID/private-key material is stored separately in the two protected
environments even though both mint against the same repository-scoped App
installation. No token or App credential is copied into the public Web image,
Nostr relay, runtime configuration or Release Set.

The dispatcher sends the exact source revision and Release Set digest to the
existing operations workflow. That workflow remains the second, independent
verification seam. Before opening a PR it must fail closed unless it can
verify all of the following against the protected operations main head:

1. the source revision is an ancestor of the reviewed source main;
2. the Release Set digest and every component digest match the immutable,
   attested publication;
3. the required component attestations and CAS/release-set records are valid;
4. the reviewed render and resource ownership checks match the expected
   namespace-scoped Web and Public Mecky resources.

Only then may it create a normal protected PR. Human CODEOWNER review,
required checks, branch protection, merge policy, Flux reconciliation and
compare-and-swap rollback remain unchanged. Cron and exact manual dispatch
remain recovery paths and must use the same verification interface; they do
not become alternate authority paths.

The source-side dispatcher is idempotent for a `(sourceRevision,
releaseSetDigest)` pair. The target owns a durable claim for that exact pair,
uses a deterministic branch and PR identity, and serializes matching runs
through workflow concurrency plus compare-and-swap against the protected
operations head. A concurrent or replayed delivery may repeat read-only
verification, but must reuse an existing verified branch/PR and cannot create
a second effective promotion or advance a different source revision. The
operations workflow records the event, App installation identity, source
revision, Release Set digest and verification result for audit and rollback;
audit records must never contain token values or private-key material.

## Rejected alternatives

- **Cron-only promotion:** retained only as recovery because its measured
  scheduling delay is unacceptable for an interactive staging loop.
- **A broad personal access token or deploy key:** rejected because it couples
  source publishing to repository contents and bypass-capable credentials.
- **Enabling the repository setting that lets arbitrary Actions create or
  approve pull requests:** rejected because it grants unrelated workflows an
  authority path around the reviewed operations seam.
- **Letting the source publisher mutate operations contents directly:**
  rejected because it would collapse the source and operations trust domains
  and bypass the workflow's independent verification.
- **Letting the App merge or approve:** rejected because promotion remains a
  human-reviewed, protected operation.

## Consequences

The normal handoff becomes near-immediate after publication while retaining a
small interface and a deep implementation: token minting, exact dispatch,
deduplication, verification, audit and failure handling stay behind the seam.
The source publisher still cannot change cluster state, and the operations
workflow still cannot trust a dispatch merely because it arrived from the App.

Bootstrap requires a narrowly scoped App installation and protected secret
provisioning. Until that bootstrap is complete, the existing exact manual
dispatch is the safe interim path and cron remains enabled as recovery. A
failed dispatch, missing secret, digest mismatch, stale source revision or
render drift must leave operations main and the cluster unchanged.

## Acceptance gates

- a verified Release Set dispatch starts the operations workflow within 60
  seconds of publication;
- the workflow receives and promotes the exact source revision and Release
  Set digest, never the moving source or operations branch heads;
- missing, stale, duplicated, unauthenticated or mismatched dispatches fail
  closed without a PR or cluster mutation;
- replayed or concurrent dispatches share a durable target-side claim,
  deterministic branch/PR identity and workflow concurrency/CAS, and reuse an
  existing verified PR rather than creating a duplicate;
- source and operations environments hold separate protected credentials;
- the source mints only a short-lived Actions-write token, the target mints
  only a fresh short-lived Pull-requests-write token, and neither workflow
  transmits credentials through dispatch data, artifacts, outputs or logs;
- the GitHub App is installed only on the operations repository and has no
  Contents: write, approval, review, merge or branch-protection bypass
  capability;
- the operations workflow independently verifies ancestry, attestations,
  immutable component digests, CAS and reviewed render before opening the
  existing protected PR;
- CODEOWNER review, required checks, branch protection and Flux rollback are
  unchanged;
- audit evidence links the App installation identity, publication, exact
  source revision and Release Set digest, dispatch, verification result, PR
  and resulting Release Set without recording tokens or private-key material,
  and a failed verification leaves the previous release head intact;
- cron and exact manual dispatch continue to exercise the same interface as
  recovery paths.
