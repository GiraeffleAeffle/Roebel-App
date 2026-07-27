# Data Sovereignty — the staged exit from managed Supabase

**2026-07-27.** MISSION **G1** ("own the compute + data, in the EU, on hardware we
control"). Companion to
[`2026-07-25-hetzner-sovereign-infra-migration-design.md`](../superpowers/specs/2026-07-25-hetzner-sovereign-infra-migration-design.md).

> **Read this first:** do **not** start stage 1 until off-box backups are running
> (`ops/status.json` reporting `"offsite": "ok"` — see
> [`WORKSPACE_STATE_AND_NEXT.md`](../WORKSPACE_STATE_AND_NEXT.md) §4.1). Moving the
> town's data onto a box you cannot restore from is a **downgrade**, not a migration.
> That mistake has already been made once on this node with Nextcloud files.

---

## 1. What "Supabase" actually means here

`netizen doctor` scores `data` as **not sovereign**: the app's entire spine is managed
SaaS. Measured surface:

| Surface | Size | Difficulty off Supabase |
|---|---|---|
| **Postgres schema** | **40 migrations**, ~149 tables | **Easy** — it is just Postgres. `pg_dump`/`pg_restore`. |
| **Row-Level Security** | ~255 policies | **Easy to move, hard to re-anchor** — see §2. |
| **Edge Functions** | **15** (Deno) | **Medium.** Deno-specific, but small and independent. |
| **Realtime** | 14 files | **Medium-hard.** Postgres logical replication + a WS fan-out. |
| **Storage** | 24 files | **Medium.** S3-compatible (MinIO/Garage) + signed URLs. |
| **Auth** | 4 files | **Trivial** — identity is already the wallet + Röbel ID keystone, not Supabase Auth. |

The good news is structural: **identity already left**. Supabase is a *database with
extras*, not the identity provider. That is why this is a migration rather than a rebuild.

## 2. The one genuinely hard part: RLS is anchored to Supabase's JWT

~255 policies gate rows on Supabase's `auth.uid()` / JWT claims. Self-hosted Postgres has
no `auth` schema and no Supabase JWT.

**Do not port the policies as-is.** Re-anchor them on the **Röbel ID keystone** — which
the node already owns and which already emits `roebel:citizen`, `roebel:tier` and
`org:<id>:<role>` groups. A request arrives with a keystone JWT; a connection-level
`SET LOCAL` carries the verified subject and claims; policies read those instead of
`auth.uid()`.

This is the step that makes the migration *worth doing* rather than merely lateral: after
it, **one identity governs the database, the workspace, and chat**, which is the whole
thesis. It is also where an access-control bug becomes a **data-breach**, so it gets its
own stage, its own tests, and a full policy-by-policy review.

## 3. Agent operability (cross-cutting requirement)

Today agents reach data as either "the service-role key" (all-powerful, unscoped) or "a
user" (wrong). Neither is a real agent identity, and `agents.charter.scopes`
(`read:feed`, `write:story`, `spend:foerder`) is enforced only in application code.

The re-anchoring in §2 is the chance to fix this properly:

- an agent authenticates to the database as **itself**, via a keystone
  `client_credentials` token carrying its charter scopes;
- RLS expresses those scopes, so `read:feed` is enforced **by Postgres**, not by whichever
  code path remembered to check;
- RFC-8693 `act` delegation ("agent X acting for citizen Y") becomes a claim policies can
  read, so a delegated action is auditable at the row level;
- the kill switch becomes real: revoke the agent's token and it loses data access
  immediately, rather than after every caller is patched.

**Design the schema for agent identity in stage 2, before moving data.** Retrofitting
per-agent authorisation onto 255 policies a second time is the expensive path.

## 4. Staged plan

Each stage is independently shippable and reversible. Postgres runs on the node **already**
(it serves Nextcloud), so there is no new component to introduce — only new databases.

### Stage 0 — Prerequisites (blocking)
- Off-box backups verified (`"offsite": "ok"`) **and a restore tested** for the new
  database, not just Nextcloud's.
- Capacity check: current box is 8 vCPU / 16 GB / 320 GB with ~279 GB free and Postgres at
  ~24 MB total. Headroom is not the constraint today; **Realtime fan-out** will be.

### Stage 1 — Schema parity, no traffic
Restore the 40 migrations into a `roebel` database on the node's Postgres. Run the existing
staging-environment tooling (which already proved exact 149-table / 113-function /
255-policy parity against the staging clone) against the node instead. **Schema only, no
PII.** Nothing reads it yet.
**Rollback:** drop the database.

### Stage 2 — Identity re-anchoring (the hard one)
Port RLS onto keystone claims (§2) and add agent-scope policies (§3). Prove equivalence:
for a representative set of (citizen, org, agent) principals, **every** policy must return
the same row set as production Supabase.
**Gate:** no data moves until that equivalence suite is green.
**Rollback:** stage 1 state.

### Stage 3 — Edge Functions → node services
Port the 15 Deno functions. Most are small and independent; take them in dependency order,
`send-notification` and `spend-muenzen` last (push tokens and money). Each becomes a
rendered node service, per the standing installer rule.
**Rollback:** per-function DNS/route flip back to Supabase.

### Stage 4 — Storage
Stand up S3-compatible storage (MinIO or Garage) on the node, mirror buckets, cut over
signed-URL generation. Note **Cloudflare Stream video stays where it is** — that is a CDN,
not a data-sovereignty problem, and self-hosting HLS for a town is not worth it.
**Rollback:** flip the storage base URL.

### Stage 5 — Realtime
The hardest runtime piece: logical replication → a WS fan-out the mobile app can hold open.
Do this **last** and behind a per-feature flag; a broken realtime rail degrades DMs and the
feed simultaneously.
**Rollback:** flag back to Supabase Realtime, which stays running throughout.

### Stage 6 — Cutover and decommission
Dual-write, verify, flip reads, keep Supabase warm as a read-only fallback for **at least
one full backup cycle**, then decommission. Update `services.backend.provider` to
`"postgres"` — at which point `netizen doctor` scores `data` as sovereign, honestly.

## 5. What this costs, honestly

- **It buys**: GDPR data-controller locality on hardware in Germany, one identity across
  database + workspace + chat, real agent authorisation, and no vendor able to change
  pricing or terms under a civic platform.
- **It costs**: you become the DBA. Backups, connection pooling, replication lag,
  vacuum, upgrades, and 3am outages are now yours. Supabase does all of that invisibly.
  Stage 0 exists precisely because the node has already demonstrated it will happily run
  for weeks with no backups at all if nobody renders them.
- **It is not urgent.** Unlike the relay allow-list or off-box backups, nothing is broken
  today. This is a *strategic* migration; do it deliberately, stage by stage, with the
  town running the whole time. **The forcing function is a real town — never paused to
  build infrastructure.**

## 6. Recommended order against the other tracks

1. Off-box backups (§4 stage 0) — hours, unblocks everything.
2. Relay allow-list secret — minutes, un-breaks a shipped feature.
3. Wallet stages 1–3 ([plan](../superpowers/plans/2026-07-27-wallet-sovereignty.md)) — no
   address risk, and the paymaster is the dependency that could silently break the app.
4. **This document, stage 1–2** — schema parity + identity re-anchoring can proceed in
   parallel with the wallet work; they touch different systems.
5. Stages 3–6 — only once 1–2 are proven.
