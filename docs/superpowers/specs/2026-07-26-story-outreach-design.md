# Story Outreach — v1 Design (Local News Phase 3 / Outbound Runtime)

**Status:** Built 2026-07-26 · **Wave:** 3 · See [[project_local_news_model]] / [[project_mecky_agent_roadmap]] (backbone B).

## Goal
Mecky *initiates*: proactively invites new eligible orgs (Verein/business/Stadt) to tell their story — the first slice of the reusable **Outbound Agent Runtime**. Approved: **new org registers, opt-out**.

## Design
- **Trigger/detection:** daily Vercel cron `/api/cron/story-outreach` (`CRON_SECRET`-gated, mirrors `/api/cron/mecky`). Scans org accounts; invites eligible, opt-in, not-yet-invited ones.
- **Consent/dedupe (reusable backbone):** `mecky_outreach_log` (account_id, type, recipient_wallet, result, sent_at; `UNIQUE(account_id,type)`) → one `story_invite` per org ever. Opt-out via new `accounts.story_outreach_opt_in` (default true). Fördermittel outreach later reuses the log with `type='foerder_match'`.
- **Delivery:** fan out to `account_owners` (owner/admin), insert per-owner `notifications` row ("Erzählt ihr eure Geschichte? 💛", link `/dashboard/stories`), log once. Best-effort per target (try/catch + `failed` count).
- **Safety cap:** `MAX_PER_RUN=25` — first run doesn't blast every existing org; backfill spreads over days; bounds any bug's blast radius.
- **Testable core:** pure `selectOutreachTargets(candidates, alreadyInvited)` (eligibility + opt-out + dedupe) — node:test 3/3.

## Guardrails
Server-side (cron secret, no client keys) · opt-out default-on · one-per-org dedupe (log + unique index) · orgs-with-owners only · owner/admin only · generic copy (no raw wallets) · best-effort.

## Files
`supabase/migrations/20260726_mecky_outreach_log.sql` (migration) · `apps/web/src/lib/outreach/select-targets.ts` (+ test) · `apps/web/src/lib/outreach/story-outreach.ts` (runtime) · `apps/web/src/app/api/cron/story-outreach/route.ts` · `apps/web/vercel.json` (cron entry, 0 8 * * *).

## Gates / follow-ups
- ⚠️ Migration NOT applied (Supabase MCP offline) — apply to prod before the cron runs (else it 500s on missing table). `CRON_SECRET` already set (existing crons use it).
- Notification-tap deep-link routing into the story flow (web link works; Expo deep-link a follow-up).
- Opt-out toggle in dashboard settings (column exists; UI a follow-up).
- Pagination if org count grows large (currently loads all org accounts).
- Later: Fördermittel outreach (type='foerder_match'), citizen story outreach, proactive DM (not just notification).
