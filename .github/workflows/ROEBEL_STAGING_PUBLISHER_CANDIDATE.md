# Röbel staging publisher foundation

`roebel-staging-publish.yml` is the protected remote build and publication
module for two secret-free staging images:

- `ghcr.io/giraeffleaeffle/roebel-web-staging`
- `ghcr.io/giraeffleaeffle/public-mecky`

Relevant changes merged into protected `main` automatically select that exact
merge commit. A manual exact-SHA dispatch remains available for bounded
recovery or re-verification. The workflow builds each component once
as a bounded `linux/amd64` OCI archive, verifies runtime identity and absence of
embedded runtime secrets with the source revision's verifier, and copies that
exact manifest to GHCR. It then generates an SPDX-2.3 SBOM and attaches both an
SBOM attestation and GitHub OIDC build provenance to the immutable digest.

Mutable `source-<sha>` tags are transport labels only. An existing identical
tag is reused; a different digest is never overwritten. Talos, Release Sets
and Flux may consume only `image@sha256:...` identities from the resulting
publication receipts.

After both parallel publications finish, a read-only assembly job downloads
only those two same-run evidence artifacts. It revalidates their receipt and
SBOM hashes, verifies the GitHub OIDC provenance and SPDX attestations against
the protected workflow identity and exact source revision, reads the current
public operations head once, and emits an effect-free Release Set candidate.
The job publishes that candidate and the exact verification bundles under the
immutable `release-set-<source-sha>` tag in the existing Web GHCR package. An
existing byte-identical handoff is reused; a conflicting tag is rejected. This
makes the handoff anonymously readable by the public operations repository and
moves the repeatable evidence plumbing off the operator laptop without giving
the publisher access to the operations repository or cluster.

## Publication is not promotion

The workflow deliberately has no Talos, Kubernetes, Hetzner, Flux, Tailscale,
runtime-secret or application-secret input. It cannot deploy, change a Release
Set head, update a reviewed render, activate Flux or exercise civic authority.
It does not merge or deploy a pull request. A protected-main push merely
publishes immutable, attested images for the exact merge commit and assembles a
candidate against the observed head. Publishing the value-free candidate in
the already-approved Web package does not advance the Release Set head or
change a cluster object. A manual run likewise requires the maintainer to
supply one exact same-repository commit.

Promotion remains a separate protected module:

1. consume the already verified candidate and its immutable evidence bundle;
2. atomically compare the expected and current Release Set head;
3. admit a checksum-bound reviewed render with the required live adoption
   preconditions;
4. atomically advance the head; and
5. let namespace-scoped Flux reconcile only the admitted Deployments.

This separation keeps the publisher deep and narrow: callers need to know only
the source commit and receive verified immutable image evidence plus a
CAS-bound candidate, while all promotion authority, deployment ordering,
rollback and civic boundaries remain elsewhere.

## Activation and visibility

Before the workflow can run, it must exist on protected `main` and use the
`roebel-staging-publisher` GitHub environment. The image jobs receive only the
built-in `GITHUB_TOKEN` with `contents:read`, `packages:write`,
`attestations:write` and `id-token:write`. The assembly job has read-only
source, artifact and attestation access plus `packages:write` solely for the
value-free Release Set handoff in the existing Web package. It has no
operations-repository or deployment credential.

GitHub initially creates personal-account packages as private. After the first
successful publication, the owner must make exactly these two packages public
and verify anonymous digest pulls. GitHub warns that public visibility cannot
be reversed. This is acceptable here only because the repository and built
application code are public and the OCI verification rejects embedded runtime
credentials.

The first bounded staging use is:

1. publish exact reviewed digests;
2. make both package identities public;
3. verify anonymous `@sha256:` pulls;
4. have all three Talos nodes pull those exact digests; and
5. run the separately reviewed six-object, self-cleaning web canary.

Routine deployment through Flux remains disabled until its own adoption gate
and browser rollback proof pass.
