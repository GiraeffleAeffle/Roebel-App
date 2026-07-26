# Netizen Node Manifest — NSP-0 v2 (Design)

**Date:** 2026-07-26
**Status:** Design — **approved to build** ("looks good, commit and push"). Brainstorming output.
**Supersedes:** the NSP-0 sketch in [`2026-07-21-netizen-stack-design.md`](2026-07-21-netizen-stack-design.md) §5 — this is the concrete, comprehensive v2.

## Goal

One **signed, chain-agnostic JSON document** that fully describes a sovereign node —
identity, governance, treasury, services, AI, agents — such that standing up
"deployment #2 is config, not rewrite" (MISSION G7). The manifest is *the DNS record
of a community*: forkable, publishable, later anchored on-chain. Every packaging
target (the one-time installer, Netizen Cloud, someone else's Ansible) reads the
same file.

## Locked decisions

1. **One unified doc, modular underneath.** A single `*.netizen.json` = the node.
   In code it's a `zod` schema (`@netizen-labs/protocol`) composed of one sub-schema
   per dimension, but it validates and signs as one file. (Rejected: a top-level doc
   that `$ref`s per-dimension files — fragments "one doc = the node", doubles the
   versioning surface.)
2. **Secrets by reference, never value.** The manifest is meant to be shared / signed
   / committed, so it names secrets (`$GNOSIS_RPC`, `COORDINATOR via Shamir`,
   `NEXTCLOUD_CLIENT_SECRET from vault`) — never embeds them. This is what makes it
   safe to publish and to anchor on-chain.
3. **Chain-agnostic.** `chain.chainId` lives in the manifest, so a chain move is a
   manifest edit, not an architecture change.
4. **Signed whole = the unit of forkability.** An `eip191` signature over the
   canonicalized doc by the node operator. Later anchored in a `CommunityRegistry`
   on Gnosis for discovery/federation (deferred to node #2).
5. **The manifest drives the running node.** It is the declarative source the
   installer + the keystone read — e.g. `identity.relyingParties` is the source for
   Röbel ID's `firstPartyClientIds` client list (hand-wired today in
   `apps/roebel-id`; generated from the manifest under this design).
6. **Dogfood is the proof.** v1 is not done until Röbel's scattered truth
   (`contracts/**/deployments/*.json` + `packages/blockchain/src/index.ts` + Vercel/Fly
   env + the 40-step [WORKSPACE_SSO_SETUP.md](../../WORKSPACE_SSO_SETUP.md)) collapses
   into one validated `roebel.netizen.json`.

## The manifest — top-level shape

Each section maps to an NSP spec (so this unifies the blueprint rather than competing):

| Section | NSP | Captures |
|---|---|---|
| `id`, `name`, `manifestVersion`, `nsp` | NSP-0 | node identity + spec/version |
| `chain`, `contracts` | NSP-0/1/2/3 | chainId + RPC + the deployed contract addresses |
| `identity` | **NSP-1 (Identity & SSO)** | the sovereign OIDC IdP, auth-bridge seam, relying parties, membership/admission, agent principals, **federation** |
| `governance` | NSP-2 | MACI engine, quorum, coordinator (Shamir), execution matrix |
| `treasury` | NSP-3 | Safe multisig (signers/threshold), fiscal splits, agent budgets (Zodiac) |
| `services` | **NSP-7 (Infra, new)** | host, workspace (Nextcloud/Collabora), chat (Matrix + Nostr), secret-refs |
| `ai` | **NSP-8 (Sovereign AI, new)** | model routing gateway, sovereignty tier, MCP tool bus, data-egress policy |
| `agents` | NSP-6 | agent charter (scopes, kill switch, audit, x402 bounds), A2A transport |
| `branding`, `modules` | NSP-0 | white-label + module on/off flags |
| `signature` | NSP-0 | operator signature over the doc |

### `identity` (the keystone — expanded)

The node runs its **own** OIDC IdP; everything authenticates against it. Federation
is peer-to-peer ("Sign in with `<node>`"), never a central "Sign in as Netizen".

- `idp`: `issuer`, `discovery`, `jwks` (ref), `authMethods` (wallet-siwe + Google/Apple/
  Facebook/email), `scopes`, `claims` (incl. `groups`, `roebel:*`).
- `authBridge`: `provider` (`thirdweb` | `netizen`) — the swappable wallet→account seam
  (G2). Flipping it is a manifest edit.
- `relyingParties[]`: the first-party services `{ id, redirectUris, scopes? }`
  (nextcloud, matrix, web, expo, mini-apps). **Generates the keystone's client list.**
- `membership`: `credential` (CitizenNFTv2), `admission` (attester band, sybil tier),
  `portable`/`exitable` — the wallet holds the credential, not the institution.
- `agentIdentity`: `grant: client_credentials`, `delegation: rfc8693-act`, `killSwitch`
  — agent principals from the same IdP (NSP-6).
- `federation`: `trustedIssuers[]` (peer node issuers), `registry` (CommunityRegistry
  on Gnosis, deferred to node #2).

*(See [`examples/roebel.netizen.json`](../../../packages/protocol/examples/roebel.netizen.json)
for every field populated with Röbel's real values.)*

## Package: `@netizen-labs/protocol`

```
packages/protocol/
  src/manifest.ts     zod schema (per-dimension sub-schemas + the composed root)
  src/index.ts        exports: NetizenManifest type, parseManifest(), validate helpers
  examples/roebel.netizen.json   the dogfood manifest (Röbel, Genesis Node #1)
```

- `parseManifest(json): NetizenManifest` — `zod.parse`, throws a typed error on drift.
- `secret-ref` values are typed as strings matching `/^\$[A-Z0-9_]+$|^vault:/` etc., so
  a manifest that inlines a raw secret fails validation (guards decision #2).
- Signature verification is a separate helper (out of v1 schema scope; the field exists).

## Testing

- Unit (`node:test` via `tsx`, matching repo convention): `parseManifest` accepts
  `examples/roebel.netizen.json`; rejects (a) a missing required section, (b) an inline
  secret where a ref is required, (c) an unknown `nsp` version.
- Dogfood check: `roebel.netizen.json` validates against the schema (run in this repo).

## Non-goals (v1)

- On-chain `CommunityRegistry` + live federation (needs node #2) — the fields exist,
  the anchoring is later.
- Rewiring the running app/keystone to *read* the manifest at runtime — v1 proves the
  shape + validates the dogfood; the installer (next spec) consumes it; wiring the live
  app onto it is a later migration.
- Signing/verification implementation — the `signature` field is specified; the crypto
  is a follow-up.
