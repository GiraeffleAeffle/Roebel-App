# Staging Environment — Maintainer Runbook

How to provision the shared **`roebel-staging`** environment that contributors
test against ([docs/FORKING_GUIDE.md](FORKING_GUIDE.md) is their side of it).

This runbook is executed **by the maintainer** — the cloud steps need interactive
Supabase / Vercel / EAS authentication and can't be automated by an agent. The
repo-side scaffolding (EAS `staging` profile, `.env.staging.example` files,
`supabase/seed-staging.sql`) already exists on `main`.

Design spec: [docs/superpowers/specs/2026-07-24-shared-staging-environment-design.md](superpowers/specs/2026-07-24-shared-staging-environment-design.md).

---

## Architecture

```
                    LIVE Gnosis mainnet contracts (chain 100)  ← read-only, shared
                                   ▲
                ┌──────────────────┼──────────────────┐
  stage.roebel.app         EAS "staging" build         local dev
  (Vercel staging project,   (internal distribution,     (contributors,
   FULL secrets)              staging channel)             minimal public env)
                └──────────────────┼──────────────────┘
                                   ▼
                   Supabase project "roebel-staging"
             (migrations + edge functions + seed; anon key public,
              service_role + AI/webhook secrets stay with you)
```

## Golden rules (why this can't hurt production)

1. **Separate projects.** Staging Supabase and staging Vercel are *distinct* from
   prod. Production env and code are never modified by this setup.
2. **Withhold the dangerous secrets on staging.** The crons + coordinator + webhooks
   guard themselves on secrets. If staging doesn't have those secrets, they no-op —
   no code change. See [§6](#6-withhold-list--staging-safety).
3. **Arm before you seed.** `seed-staging.sql` refuses to run unless the DB is
   explicitly marked `roebel_env = 'staging'`.

---

## 1. Create the staging Supabase project

Use the **Supabase MCP** (mandatory per repo policy) or the dashboard.

- New project, EU region (data residency parity with prod), name `roebel-staging`.
- Record: **Project URL**, **anon key** (shareable), **service_role key** (secret).

## 2. Apply the schema

The repo has **two divergent migration dirs** (`supabase/migrations` and
`apps/expo/supabase/migrations`) and neither is cleanly canonical, so **replaying
migrations risks a schema that doesn't match prod.** Prefer cloning the live schema:

**Recommended — clone the production schema (exact match, migration-dir-agnostic):**
```bash
# Dump prod SCHEMA ONLY (no data), then load into staging.
# Use your own prod connection string; NEVER dump prod data into a shared env.
pg_dump --schema-only --no-owner --no-privileges "$PROD_DB_URL" > /tmp/prod_schema.sql
psql "$STAGING_DB_URL" -f /tmp/prod_schema.sql
```
(Or Supabase Dashboard → Database → Backups on prod → restore schema into staging,
or the MCP `apply_migration` with the dumped schema.)

**Fallback — replay migrations:** apply `supabase/migrations/*` then reconcile any
tables that only exist via `apps/expo/supabase/migrations/*`. Verify the result
against prod (`\dt`, spot-check `posts`, `events`, `accounts`) before trusting it.

> **TODO for the maintainer:** once resolved, record here *which* migration dir is
> canonical so the next person skips this ambiguity. (Spec open question **O1**.)

## 3. Deploy edge functions to staging

Deploy `apps/expo/supabase/functions/*` to the staging project (Supabase MCP
`deploy_edge_function`, or dashboard). Set **only** the function secrets you want
staging to have — see the withhold list. Notably **do not** set the push
(`send-notification`) or webhook secrets, so staging can't message real users.

## 4. Arm staging, then seed

```sql
-- STEP 0 — arm this DB as staging (run ONCE, against staging only):
insert into app_settings (key, value) values ('roebel_env', 'staging')
on conflict (key) do update set value = 'staging', updated_at = now();
```
```bash
# STEP 1 — load sample data (idempotent, aborts if not armed):
psql "$STAGING_DB_URL" -f supabase/seed-staging.sql
```

## 5. Web — Vercel staging project

1. New Vercel project from the same repo (or a `staging` Git branch → its own env).
2. Set env from `apps/web/.env.staging.example`:
   - **Set:** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (staging),
     `SUPABASE_SERVICE_ROLE_KEY` (staging), `NEXT_PUBLIC_TEMPLATE_CLIENT_ID`, and any
     AI/maps keys you want working on the hosted staging site.
   - **Withhold:** everything in [§6](#6-withhold-list--staging-safety).
3. Add the domain **`stage.roebel.app`** (Vercel → Domains) and the CNAME on your
   `roebel.app` DNS. This is the stable URL contributors bookmark.
4. Keep [apps/web/vercel.json](../apps/web/vercel.json) as-is — the crons are defined
   there but stay inert on staging because their secrets are withheld (see §6).

## 6. Withhold list — staging safety

Do **NOT** set these on the staging Vercel project / Supabase functions. Leaving them
unset is what keeps staging from touching the real DAO or notifying real users:

| Secret | Effect of withholding on staging |
|---|---|
| `CRON_SECRET` | Mecky, newsletter, dev-ticket, store-metrics crons return 401 → no-op |
| `BASE_RPC_URL` (coordinator RPC) | `/api/coordinator/chain-listener` returns "not configured" → no-op |
| `COORDINATOR_ETH_PRIV` | No on-chain coordinator tx signing from staging |
| `RESEND_WEBHOOK_SECRET`, `NEWSLETTER_ADMIN_EMAIL` | No newsletter emails to real users |
| `MONERIUM_WEBHOOK_SECRET`, `STRIPE_WEBHOOK_SECRET_DONATIONS` | No donation webhooks processed |
| push / `send-notification` secrets | No push notifications to real users |
| `GITHUB_TICKETS_TOKEN` | No GitHub PR dispatch from staging |

If you ever *do* want to test one of these on staging, point it at a **sandbox** of
that service (test Stripe keys, a staging Resend audience, etc.) — never the prod one.

## 7. Thirdweb staging client

Reuse the existing public client id, or create a dedicated staging client at
https://thirdweb.com/dashboard (add `stage.roebel.app` and `localhost:3000` to its
allowed domains). It's a public value; hand it to contributors.

## 8. Mobile — EAS `staging` build

The `staging` profile already exists in [apps/expo/eas.json](../apps/expo/eas.json)
(channel `staging`, internal distribution).

```bash
cd apps/expo
cp .env.staging.example .env          # fill staging Supabase + client id +
                                      # EXPO_PUBLIC_MINIAPP_API_BASE=https://stage.roebel.app
eas build --profile staging --platform ios      # (and/or android)
# Share the resulting internal-distribution QR/link with contributors.
# Later JS-only changes: eas update --channel staging
```
Remember: Expo env **bakes at build time**, so a staging build must be built with the
staging `.env`. OTA (`eas update`) only ships JS on top of an existing build.

## 9. Hand-off to contributors

Give contributors:
- **https://stage.roebel.app** (zero-setup testing)
- Staging **Supabase URL + anon key** and a **thirdweb client id** (for local dev)
- A link to [docs/FORKING_GUIDE.md](FORKING_GUIDE.md)
- (Optional) the EAS `staging` internal-distribution link for a real device build

## 10. Refreshing / resetting staging

- Re-run `supabase/seed-staging.sql` any time (idempotent).
- To wipe: truncate the app tables (or reset the DB), re-apply schema (§2), re-arm
  (§4 STEP 0), re-seed.
- Keep staging's schema in sync with prod after significant prod migrations by
  re-cloning the schema (§2).

---

## Decisions recorded

- **O2 → `stage.roebel.app`** (stable branded subdomain; chosen 2026-07-24).
- **O1 → TODO** — confirm canonical migration dir during first provisioning and
  record it in §2.
