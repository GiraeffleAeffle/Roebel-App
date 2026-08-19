# Röbel staging publisher candidate

`roebel-staging-publish.yml` is a deliberately **non-activating** manual-main
candidate. It is not a deployment workflow and has no Talos, Kubernetes,
Flux, Hetzner, Tailscale, runtime, or application-secret surface.

It names exactly two possible registry destinations:

- `ghcr.io/giraeffleaeffle/roebel-web-staging`
- `ghcr.io/giraeffleaeffle/public-mecky`

The mutable `candidate-<source-sha>` tags in its unreachable skeleton are
transport labels only. A release set must contain only the corresponding
Buildx output digests and may never use those tags as an image identity.
Buildx is configured to emit an SPDX SBOM and maximal provenance; GitHub OIDC
provenance is attached to each exact image digest. The expected workflow
identity is pinned in the release-set assembler to this workflow on
`refs/heads/main`.

## Why it fails closed today

Two independent activation blockers are intentional:

1. `guard` validates the exact `main` commit plus a canonical, non-secret
   previous-head JSON and its digest, then exits non-zero with
   `UNBOUND_REVIEW_REQUIRED`.
2. `publish` is additionally guarded by the literal `if: ${{ false }}`.

There is no assumed source of truth for a release-set head. Replacing either
blocker without an independently reviewed atomic compare-and-swap mechanism
would permit a stale promotion to overwrite a newer release set.

## Required activation authorization and binding work

An authorized maintainer must approve a separate, narrowly scoped binding
change that supplies all of the following:

1. A protected `main` branch and a protected `roebel-staging-publisher`
   environment with required reviewers. The workflow may be manually
   dispatched only from `main`.
2. GitHub Actions package-write, attestation-write, and OIDC availability for
   the two named GHCR packages. These are the sole allowed publication
   permissions; no cluster or provider credentials belong here.
3. A protected release-set-head store with an atomic CAS operation keyed by
   `expected_previous_head_digest`. The checked candidate must be written only
   if that exact head is still current. A non-atomic GitHub artifact upload is
   not a substitute.
4. An immutable verification implementation that reads the pushed image
   digests, validates the GitHub OIDC provenance identity and BuildKit
   SPDX-2.3 SBOM referrers, produces the existing bounded OCI receipts and
   evidence JSON, runs `assemble-roebel-staging-release-set.mjs`, and verifies
   the assembler’s expected previous head before the CAS.
5. A reviewed rule for an existing `candidate-<sha>` registry tag: reject a
   different digest and reuse only an already verified identical digest. The
   digest—not a tag—remains the Release Set identity.
6. An exact, locally or independently verified official commit SHA for every
   third-party Action. In particular, the unreachable
   `docker/build-push-action@v6` labels are intentionally **UNBOUND**: no such
   SHA was retained with this candidate, so it must not be activated by
   trusting or guessing a floating version label.

Until all six are bound and reviewed, this file is useful as a precise
contract only. It cannot publish or modify release state.
