# @netizen-labs/protocol

The Netizen protocol layer: NSP specs as **zod schemas + TypeScript types**. v1 is
**NSP-0 — the Netizen Node Manifest**: one signed JSON document that fully describes a
sovereign node (identity, governance, treasury, services, AI, agents), so "deployment
#2 is config, not rewrite" (MISSION G7).

Design: [`docs/superpowers/specs/2026-07-26-netizen-node-manifest.md`](../../docs/superpowers/specs/2026-07-26-netizen-node-manifest.md).

## Usage

```ts
import { parseManifest } from "@netizen-labs/protocol";
import roebel from "@netizen-labs/protocol/examples/roebel";

const node = parseManifest(roebel); // throws (ZodError) on drift
console.log(node.identity.idp.issuer, node.chain.chainId);
```

## Principles baked into the schema

- **Secrets by reference, never value** — `$ENV_VAR` or `vault:path`; an inline secret
  fails validation. The manifest is meant to be published, signed, and anchored on-chain.
- **Chain-agnostic** — `chain.chainId` lives in the manifest; a chain move is a config edit.
- **The manifest drives the node** — e.g. `identity.relyingParties` is the source for the
  Röbel ID keystone's client list (`apps/roebel-id`), hand-wired today, generated tomorrow.

## Dogfood

[`examples/roebel.netizen.json`](examples/roebel.netizen.json) is Röbel (Genesis Node #1) —
its scattered truth (`deployments/*.json`, `packages/blockchain`, Vercel/Fly env, the
[workspace runbook](../../docs/WORKSPACE_SSO_SETUP.md)) collapsed into one validated file.

## Follow-ups (not in v1)

- Manifest **signing/verification** (`signature` field is specified; crypto is next).
- On-chain **CommunityRegistry** + live federation (needs node #2).
- Consumers: the one-time **installer** reads this manifest to provision a node; later the
  live app/keystone read it at runtime.

## Test

```bash
pnpm --filter @netizen-labs/protocol test
```
