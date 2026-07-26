# @netizen-labs/cli — `netizen`

The one-time installer for a sovereign node. Reads a
[Netizen Node Manifest](../protocol/) and stands the node up — idempotently,
inspectably, on infra you own. Automates
[WORKSPACE_SSO_SETUP.md](../../docs/WORKSPACE_SSO_SETUP.md).

Design: [`docs/superpowers/specs/2026-07-26-netizen-node-installer.md`](../../docs/superpowers/specs/2026-07-26-netizen-node-installer.md).

## Commands

```bash
netizen render <manifest.json> --out ./bundle              # PURE: manifest → inspectable bundle
netizen doctor <manifest.json>                             # validate + secrets/endpoints/plan/warnings
netizen up     <manifest.json> --dry-run                   # print the ordered plan
netizen up     <manifest.json> --host user@ip [--identity ~/.ssh/key]  # rsync bundle + run bootstrap.sh on the box
```

`up --host` is **operator-run**: it rsyncs the bundle to the box and runs the idempotent
`bootstrap.sh` over ssh. Secrets never pass through the CLI — the box's own `.env` (from
`SECRETS.md`) supplies them. Run it from where your ssh key + secrets live.

`render` (P1, built) is a deterministic pure function — no I/O, no infra. It emits the
full deployable bundle the manifest determines: `docker-compose.yml` (keystone + Matrix +
**Nostr relay/strfry** + Caddy), `Caddyfile`, `roebel-id.env` (with the generated
first-party client list), `mas/config.yaml`, `element/config.json`, `strfry.conf`,
`nextcloud/setup.sh`, `web.env`, plus `README.md`, `bootstrap.sh` (the idempotent on-box
apply script `up` runs), `PLAN.md` (ordered steps) and `SECRETS.md` (the references you
must supply). **Secrets are never written into the bundle** — only their references.

```bash
pnpm --filter @netizen-labs/cli netizen render packages/protocol/examples/roebel.netizen.json --out ./bundle
pnpm --filter @netizen-labs/cli test
```

## Status

- **P1 render core — built + tested** (5 `node:test` cases; run standalone).
- P2 executor (`up`/`doctor`) and P3 provisioning (Hetzner box + DNS) are designed in the
  spec, built next (they need a real target box).
