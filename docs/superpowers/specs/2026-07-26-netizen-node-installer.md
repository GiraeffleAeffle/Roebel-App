# Netizen Node Installer — `netizen` CLI (Design)

**Date:** 2026-07-26
**Status:** Design — shape approved ("CLI that renders + runs, hybrid"). Brainstorming output.
**Consumes:** the [Netizen Node Manifest](2026-07-26-netizen-node-manifest.md) (`@netizen-labs/protocol`).
**Automates:** [WORKSPACE_SSO_SETUP.md](../../WORKSPACE_SSO_SETUP.md) + the app backend, from one manifest.

## Goal

Turn one `*.netizen.json` into a live sovereign node with one command — idempotently,
inspectably, on infra the operator owns. This is MISSION G7 made real: "deployment #2 is
config, not rewrite."

## Shape (approved): render + up

```
netizen render <manifest> --out ./bundle     # PURE: manifest → an inspectable bundle
netizen up     <manifest> [--host <ssh>]      # render, then EXECUTE the bundle on the target
netizen doctor <manifest>                     # validate manifest + check reachability/secrets
```

Two layers, always:
- **Pure core (`render`)** — `manifest → { files, plan }`. No I/O, no infra. Deterministic,
  fully unit-testable. This is where the intelligence lives and what we TDD.
- **Executor (`up`)** — takes the rendered bundle and applies it to the target box
  (docker compose up → post-config → verify). Thin, idempotent, ops-only. Not unit-testable
  without a box; covered by `doctor` pre-checks + manual/e2e.

The operator can always `render`, read every generated file, then `up` — nothing hidden.

## The bundle (`render` output)

Everything the manifest uniquely determines:

| File | From manifest | Purpose |
|---|---|---|
| `docker-compose.yml` | `services`, `chain` | Synapse + MAS + Postgres + Element (+ Nextcloud note) |
| `roebel-id.env` | `identity.idp`, `identity.relyingParties`, `chain`, `contracts` | keystone env incl. the generated first-party client list |
| `mas/config.yaml` | `identity.idp`, the `matrix` relying party | MAS upstream OIDC = Röbel ID |
| `element/config.json` | `services.chat.matrix` | Element → homeserver |
| `nextcloud/setup.sh` | `identity`, `services.workspace` | `occ` OIDC + group-folder-per-org commands |
| `web.env` | `services.workspace`, `services.chat` | `NEXT_PUBLIC_WORKSPACE_BASE_URL` + `_CHAT_BASE_URL` |
| `PLAN.md` | all | the ordered, idempotent step list `up` executes |
| `SECRETS.md` | every `$REF` / `vault:` in the manifest | what the operator must supply, and where |

**Secrets never enter the bundle as values.** `render` emits references + a `SECRETS.md`
checklist; `up` resolves them at apply time from env/vault. A manifest with an inline
secret already failed `parseManifest` upstream.

## Idempotency

Every step is convergent (create-if-absent, set-desired-state), so `up` is safe to re-run:
docker compose is declarative; `occ` provider/group-folder creation checks existence first;
OIDC client registration is upsert. Re-running against a healthy node is a no-op.

## File structure

```
packages/cli/
  src/render/            pure renderers, one per bundle file (manifest → string/object)
  src/plan.ts            manifest → ordered Step[]  (the PLAN.md source)
  src/render.ts          composes the renderers → Bundle { files, plan }
  src/executor.ts        applies a Bundle to a target (docker/ssh/occ) — the ops layer
  src/cli.ts             `netizen render|up|doctor` arg parsing → core
  test/                  node:test over the pure renderers + plan
```

`import type { NetizenManifest } from "@netizen-labs/protocol"` (type-only; the CLI calls
`parseManifest` once at entry, then renders from the typed object).

## Phased build

| Phase | Deliverable | Testable now? |
|---|---|---|
| **P1 — render core** *(this slice)* | the pure renderers (roebel-id env, MAS config, Element config, web env, Nextcloud setup, PLAN, SECRETS) + `plan()` + `netizen render` writing the bundle | **Yes** — pure, `node:test` |
| P2 — executor | `netizen up` (docker compose + ssh + occ + OIDC upsert), `doctor` pre-checks | box + e2e |
| P3 — provisioning | box + DNS creation (Hetzner API) from the manifest; backups | box + e2e |
| P4 — Cloud | managed `up` behind a control plane (the business) | later |

## Testing

- P1 unit (`node:test` via `tsx`): each renderer is deterministic for the Röbel manifest;
  the generated `roebel-id.env` contains exactly the manifest's relying-party client ids and
  redirect URIs; no secret VALUE appears in any bundle file (only refs); `plan()` is ordered
  with no forward-dependencies.
- P2/P3: `doctor` unit-tested on manifest checks; `up` validated manually against a scratch box.

## Non-goals (this slice)

- The executor / real provisioning (P2/P3) — designed here, built next (needs a target box;
  and this machine is out of disk).
- Manifest signing/verification (lives in `@netizen-labs/protocol` follow-ups).
- Netizen Cloud control plane (P4).
