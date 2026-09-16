# ADR 0026: Connect the workspace and citizen return to the selected Case

- **Status:** source implementation; staging activation pending
- **Date:** 2026-09-15

## Decision

The Town Workspace resolves the discussion's verified public admission receipt
before requesting its roles or private view. Reads and writes include that Case
ID. An unresolved or mismatched discussion does not fall back to another Case.
A workspace opened without a discussion retains the configured default.
After a department review or Brief confirmation advances the Case version, the
graph reloads the verified public return automatically and hides older results
while checking. It never treats the private write receipt alone as public delivery.

The server-owned review configuration keeps `caseId` and accepts up to seven
`additionalCaseIds` in the same municipality. Every grant is scoped by its
`caseId`; an omitted grant Case preserves its original default-only meaning.
A verified login subject sees only its unexpired roles for the selected Case.
The browser cannot choose an upstream, actor or token. The internal service
independently verifies the same Case-bound credential and command version.

The public Citizen Brief reader selects the Case from the verified admission
receipt, checks the explicit deployment list, then validates both the Brief and
return checksums against that discussion and Topic. It forwards no browser
credentials. Mecky's existing synthetic configuration may name additional
`{caseId, discussionId, topicId}` bindings under `additionalBindings`. They use
the same configured origin, transport and municipality. Each is read afresh;
an unavailable or withdrawn return contributes no old passages. Every surviving
passage retains its own Case link, review time, checksum and synthetic authority.

This supplies routing for a second realistic rehearsal while preserving the
original Case. It does not create accounts, mint credentials, admit a new Case,
grant staff roles, publish demo content or change deployment protection. Staging
account access remains a separate allowlist plus expiring role assignment.
Several signed demo identities controlled by one operator are not independent
human participants or real municipal reviewers.

## Validation

Gateway tests cover separate subjects, default-only legacy grants, cross-Case
role attempts, mismatched upstream responses and duplicate selectors. Public
reader tests bind the additional Case through a verified discussion receipt.
Mecky tests retain the correct source and citation when another configured Case
is unavailable. The neutral writer's tests separately prove multi-Case HTTP
review and durable restart without changing the original admission history.
