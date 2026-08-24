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

The Web runtime-only packaging path builds once in the exact pinned Node image
with networking disabled, a read-only offline pnpm store, no Linux capabilities
and no-new-privileges. The earlier 168 MiB compressed / 2.50-2.91 GiB
unbounded cache trial was rejected after its measured warm run took 6m22s
versus 6m05s cold. A later direct `.next/cache` attempt produced
2,641,798,000 apparent bytes against its 512 MiB save budget, so it saved
nothing and its cold Web job still took 6m15s. That attempt is not a speed
optimization and no compiler cache is now restored, saved or uploaded.

The current title-ready slice is **measure Web compiler cache candidates**.
Only a pull-request Web build inventories the complete `.next/cache` root, all
immediate directories and each immediate Webpack subdirectory. It logs stable
apparent-byte, allocated-byte and regular-file counts, then measures the full
cache's zstd-compressed size and compression time in a temporary runner-local
archive. The archive is deleted in the same step and is never uploaded, saved,
packaged or used by the protected publisher. The measurement fails closed if
the cache root or any descendant is a symlink. Manual dispatch and protected
publication therefore remain cold and receive no compiler-cache state. These
measurements are evidence for selecting a useful remote subset capped at 2 GiB;
they do not claim a warm-build improvement. A staging-only Turbopack trial was
also rejected: it compiled in 4.7 minutes, slower than Webpack's 3.2 minutes,
and then failed page-data collection for an existing newsletter route.

An exact dependency-cache trial was rejected as well. Its cold job took 7m02s,
57 seconds slower than the 6m05s runtime-only baseline, including 33 seconds to
persist the materialization. The measured warm-cache run then failed closed
during the frozen offline install: the restored `node_modules` graph was not a
self-contained pnpm store, the mounted store was empty and read-only, and pnpm
correctly refused when it needed `/pnpm/store/v3`. The publisher therefore fetches a fresh,
lockfile-bound offline store on every run and limits the resulting dependency
installation to 4 GiB. Neither that installation nor a compiler cache is copied
into the runtime image.

After the standalone build, a separate runtime context receives only traced
production dependencies, server output, static assets, public files and the
reviewed runtime-config entrypoint. A tiny runtime-only Dockerfile packages that
context. This removes the measured 149-second `mode=max` BuildKit cache export
and prevents the 2.01 GB pnpm graph from becoming image-cache output. Public
Mecky remains on its small component-scoped `mode=min` registry BuildKit cache.
That mutable `buildcache-main` reference contains only public build inputs, is
never a deployment input, carries no release authority, and cannot bypass the
post-build OCI verifier. That cache may be absent; a clean build remains the
fail-safe path.

`pnpm fetch` writes its virtual store into a runner-only fetch directory and the
source context always starts without `node_modules`. The dependency-manifest
context never contains `node_modules`, and runner-generated fetch shims never
overwrite the builder's platform-specific install.

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
