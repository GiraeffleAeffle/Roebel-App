# K4 — Ortis Dashboard: an operator launches a sovereign community

**Date:** 2026-08-11 · **Status:** kickoff, ready to start · **Owner:** unassigned agent
**Context:** [Strategy — one-click community launch](2026-08-11_STRATEGY_ORTIS_ONE_CLICK_COMMUNITY.md) (read §2–§4 first)

## 1. Mission

Build the Ortis Dashboard: the surface where an operator signs up, describes a
community, presses launch, and ends up with a live, installable PWA for their
town, party, or online community — then manages it afterwards.

**You are building against a contract, not a finished backend.** The launch
pipeline (P1) does not exist yet. §5 of this document *is* the contract; build
the full dashboard against a mock implementation of it. When the pipeline lands,
the mock is swapped for the real service and the UI does not change.

Do not build the pipeline itself. Do not build the multi-tenant app build (P0).

## 2. Where you work — read before writing anything

**Repo: `MaxBrych/Netizen-Labs`** (NOT this repo; clone it separately).

`app.ortis.app` is **already live** and already has a read-only "Meine Community"
section from an earlier kickoff (`netizen_labs/docs/ORTIS_COMMUNITY_KICKOFF`,
~2026-08-09), which established its own route group and made Röbel tenant #1.

**Read that kickoff and the existing Ortis app before designing anything, and
extend what is there. Do not greenfield a second dashboard.** If what you find
contradicts this document, stop and report the contradiction rather than
choosing for yourself.

Also read `netizen_labs/docs/NETIZEN_IDENTITY_KICKOFF` §1b — the identity rules
below come from production incidents, not theory.

## 3. Decisions already made (do not re-open)

| Decision | Value | Source |
|---|---|---|
| Tenant domains | `<slug>.ortis.app`, editable after creation | Strategy §3a |
| Operator accounts | **Open self-serve signup** | Max, 2026-08-11 |
| Backend per tenant | **A database on a Netizen node**, not an external Supabase account — see [K5](2026-08-11_K5_SOVEREIGN_DATA_PLANE.md) | Max, 2026-08-11 (revised same day) |
| Build approach | Contract-first against a mock | Max, 2026-08-11 |
| Chain | Shared Gnosis + existing `CommunityRegistry` | Strategy §7.3 (default) |

## 4. Non-negotiable constraints

1. **Self-serve signup provisions real resources.** Every launch creates a tenant database on a Netizen node, a Vercel deployment, a subdomain, and on-chain records. (The node database makes this cheaper than an external vendor project — see [K5 §7](2026-08-11_K5_SOVEREIGN_DATA_PLANE.md) — but it is still finite capacity.) An unguarded "create community" button is a cost and abuse vector. You **must** ship: email verification before launch, a per-account community limit, rate limiting, a reserved-subdomain list (`app`, `id`, `www`, `api`, `admin`, `mail`, `status`, `docs`, …), and a slug collision check. Whether a launch additionally requires payment or manual approval is [open question 1](#8-open-questions-for-max) — build the gate as a **pluggable policy check** so either answer is a config change, not a refactor.
2. **Renaming a community is a migration, not a field edit.** Its PWA is installed on residents' home screens and `start_url`/`scope` are origin-bound; if the old subdomain stops resolving, every installed icon dies. The UI must present renaming with that consequence stated in German, and the contract's rename step keeps the old origin redirecting.
3. **Never show raw wallet addresses** in the UI — resolve to a display name. This is a standing rule across the product.
4. **Never use network-state vocabulary** on the Ortis surface. Operators are towns, parties, and associations; the copy is civic and plain. Likewise never surface Circles/CRC jargon — the currency is named per tenant.
5. **Copy: German primary.** Max reviews every public-facing string before deploy. Code, identifiers, and comments stay English.
6. **Identity trap (production-proven):** one Provider = one issuer. A vanity CNAME in front of an OIDC issuer breaks login, and a single invalid `redirect_uri` invalidates an entire client. If the dashboard registers RP clients per tenant, validate redirect URIs before submission.

## 5. THE CONTRACT — build against this

Implement a mock service fulfilling exactly this. Keep it in one module so it can
be deleted when P1 lands.

### 5.1 `community.json` (the tenant record)

```jsonc
{
  "id": "cmt_01H…",                 // server-assigned
  "slug": "strausberg",             // → strausberg.ortis.app
  "name": "Strausberg",
  "type": "town",                   // "town" | "party" | "online"
  "status": "draft",                // draft | launching | live | failed | suspended
  "owner": "op_01H…",               // operator account id
  "branding": {
    "logo": "https://…/logo.png",   // operator upload; icons are generated from it
    "primaryColor": "#00498B",
    "displayName": "Strausberg"
  },
  "copy": {
    "communityName": "Strausberg",
    "region": "Märkisch-Oderland",
    "currencyName": null             // e.g. "Strausberger Taler", or null = feature off
  },
  "features": {                      // preset-driven, operator-adjustable
    "circlesCurrency": false,
    "citizenVerification": true,
    "maciVoting": true,
    "marketplace": true,
    "administration": false
  },
  "endpoints": {                     // filled by the pipeline, read-only in the UI
    "pwa": "https://strausberg.ortis.app",
    "relay": null,
    "index": null,
    "supabaseUrl": null
  },
  "chain": { "chainId": 100, "contracts": {} },
  "agent": { "persona": "…", "language": "de" },
  "createdAt": "2026-08-11T10:00:00Z"
}
```

### 5.2 Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/slugs/check?slug=` | `{ available, reason? }` — reserved list + collision. Debounced from the form. |
| `POST` | `/api/communities` | Create draft + start launch. Returns `202` with `{ id }`. Body = the editable subset of §5.1. |
| `GET` | `/api/communities` | Operator's communities. |
| `GET` | `/api/communities/:id` | Full record. |
| `GET` | `/api/communities/:id/events` | **SSE** stream of launch progress (§5.3). |
| `PATCH` | `/api/communities/:id` | Branding, copy, features. A `slug` change starts a rename migration and returns a job, not `200`. |
| `POST` | `/api/communities/:id/redeploy` | Rebuild + redeploy the PWA. |
| `DELETE` | `/api/communities/:id` | Tear down. Must require typing the community name. |

### 5.3 Launch progress events

The launch has eight steps. Each emits `{ step, status: "pending"|"running"|"done"|"failed", message, detail? }`. Message text is German and user-facing; `detail` is for a collapsible technical view.

```
1. reserve-subdomain     Adresse wird reserviert
2. provision-backend     Datenbank wird angelegt          (Supabase project)
3. deploy-contracts      Verträge werden veröffentlicht   (+ CommunityRegistry record)
4. render-services       Dienste werden eingerichtet      (netizen render/up)
5. build-app             App wird gebaut                  (slowest — ~5 min; the UI must survive this)
6. deploy-app            App wird veröffentlicht          (+ domain, certificate ~1 min)
7. provision-agent       Assistent wird eingerichtet
8. verify                Abschließende Prüfung
```

The mock must be able to replay a realistic timeline **including failures** —
step 2 failing on quota, step 6 failing on certificate issuance. Build the UI so
a partial failure is recoverable (retry that step), not a dead end.

### 5.4 Managing the tenant's node database

A launched community owns a database on a Netizen node ([K5](2026-08-11_K5_SOVEREIGN_DATA_PLANE.md)). The dashboard is
where an operator sees and controls it — otherwise "sovereign" just means
"someone else's server you cannot inspect". Mock these too:

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/communities/:id/health` | Node + database status: up/degraded/down, storage used, DB size, last backup. |
| `GET` | `/api/communities/:id/backups` | List. Each `{ id, createdAt, size, kind: "auto"\|"manual" }`. |
| `POST` | `/api/communities/:id/backups` | Take one now. |
| `POST` | `/api/communities/:id/backups/:backupId/restore` | Restore. Destructive → same typed-confirmation treatment as delete. |
| `POST` | `/api/communities/:id/export` | Full data export (DB dump + media + the community's signed public record). Returns a job, then a download link. |
| `GET` | `/api/communities/:id/members` | Community members and roles. Display names only — **never raw wallet addresses** (§4.3). |
| `GET` | `/api/communities/:id/storage` | Buckets, usage, and each bucket's `deletable` flag (K5 §4). |
| `GET` | `/api/communities/:id/functions` | Deployed functions + recent invocation status. |
| `GET` | `/api/communities/:id/logs?source=` | Recent logs (app / functions / database), paginated. |

**Export is the sovereignty proof and must be first-class UI, not buried** — an
operator who cannot walk away with their data does not have a sovereign platform.
Treat "Daten exportieren" as a primary action on the community page.

Deliberately **not** in v1: a SQL console or table browser. That is a Studio-sized
feature; if an operator needs it, link out to a Studio instance scoped to their
database rather than rebuilding it. Flag it if the design pulls that way.

## 6. Scope

**In scope:** operator signup/login (self-serve, via the existing `id.ortis.app` issuer) · account settings · community creation wizard (name → slug preview → type/preset → branding → review → launch) · live launch progress · community detail + management (status, endpoints, redeploy, branding, features, agent settings, rename, delete) · **the node-database surface in §5.4 (health, backups, restore, export, members, storage, functions, logs)** · the abuse/limit gates from §4.1 · the mock service.

**Out of scope:** the real pipeline (P1) · multi-tenant app build (P0) · contract deployment · Supabase provisioning · billing implementation (leave the policy hook) · anything in this repo (`Roebel-App`).

## 7. Slices

1. **Read + report.** Read the existing Ortis app and the prior kickoff; report in 10 lines what exists, what you will extend, and any contradiction with this document. **Stop for review.**
2. **Mock service + types** implementing §5 exactly, with a scripted timeline and injectable failures.
3. **Operator auth + account shell** — signup, login, empty state, guarded routes.
4. **Creation wizard** with live slug availability, reserved-list handling, and preset defaults per type.
5. **Launch progress view** — SSE consumption, per-step states, failure + retry, survives reload (reconnects to the stream).
6. **Community management** — detail page, redeploy, branding/feature edits, rename-as-migration with its warning, guarded delete.
7. **Node-database surface** — health, backups + restore, export as a primary action, members, storage, functions, logs (§5.4).
8. **Gates** — email verification, per-account limit, rate limiting, pluggable launch policy.

Slices 2–8 each end with a working, reviewable UI.

## 8. Open questions for Max

1. **Does a self-serve launch require payment or manual approval before resources are provisioned?** Build the pluggable gate either way (§4.1), but the default needs an answer before public signup opens.
2. Free trial shape: should a community be able to start **record-only** (no Supabase, read-only, per [K2](2026-08-11_K2_NOSTR_READ_FALLBACK.md)) and upgrade later? That would make free self-serve safe.
3. Who is the DSGVO controller for a self-serve community, and what must the operator accept at signup? This is a product surface (per-tenant imprint, policy, DPIA), not just legal text — see Strategy §7.2.
4. Can an operator invite co-administrators, or is one owner per community enough for v1?
