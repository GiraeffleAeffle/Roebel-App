# @netizen-labs/cli — `netizen`

The one-time installer for a sovereign node. Reads a
[Netizen Node Manifest](../protocol/) and stands the node up — idempotently,
inspectably, on infra you own. Automates
[WORKSPACE_SSO_SETUP.md](../../docs/WORKSPACE_SSO_SETUP.md).

Design: [`docs/superpowers/specs/2026-07-26-netizen-node-installer.md`](../../docs/superpowers/specs/2026-07-26-netizen-node-installer.md).

## Commands

```bash
netizen render <manifest.json> --out ./bundle   # PURE: manifest → inspectable bundle
netizen up     <manifest.json>                  # render, then apply to the target box   (P2)
netizen doctor <manifest.json>                  # validate + reachability/secret checks   (P2)
```

`render` (P1, built) is a deterministic pure function — no I/O, no infra. It emits every
config the manifest determines: `roebel-id.env` (with the generated first-party client
list), `mas/config.yaml`, `element/config.json`, `nextcloud/setup.sh`, `web.env`, plus
`PLAN.md` (ordered idempotent steps) and `SECRETS.md` (the references you must supply).
**Secrets are never written into the bundle** — only their references.

```bash
pnpm --filter @netizen-labs/cli netizen render packages/protocol/examples/roebel.netizen.json --out ./bundle
pnpm --filter @netizen-labs/cli test
```

## Status

- **P1 render core — built + tested** (5 `node:test` cases; run standalone).
- P2 executor (`up`/`doctor`) and P3 provisioning (Hetzner box + DNS) are designed in the
  spec, built next (they need a real target box).
