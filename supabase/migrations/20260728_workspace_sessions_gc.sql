-- Garbage collection for workspace_sessions.
--
-- NOT APPLIED. Applying migrations is the operator's step (Supabase MCP); this
-- file is written and reviewed but has never run against any project.
--
-- Why it exists: every row in workspace_sessions holds a live Nextcloud
-- refresh token, and nothing in slice 1 ever removes one except an explicit
-- logout. Rows accumulate from three directions:
--   1. Abandoned sessions. The browser closes, the cookie expires at 14 days,
--      and the row — the credential — stays forever.
--   2. Failed refreshes. loadSession now deletes the row in its catch, but a
--      delete that itself fails leaves a stale row behind.
--   3. Login loops. A misconfigured bearer chain used to mint one row per
--      lap. FileBrowser's one-shot hop guard stops the loop; this is the
--      backstop for rows minted before it, and for any future path that
--      re-creates the shape.
--
-- The TTL matches the session cookie's own maxAge (14 days, set in
-- api/workspace/auth/callback/route.ts). Past that, the cookie is gone and no
-- browser can ever present the id again, so the row is unreachable by
-- definition — deleting it removes a credential and loses nothing.
--
-- created_at already exists on the table (20260728_workspace_sessions.sql).

create index if not exists workspace_sessions_created_at_idx
  on public.workspace_sessions (created_at);

-- Also index expires_at: the reaper's second predicate scans it, and it is the
-- cheaper of the two to filter on for a table that is mostly live sessions.
create index if not exists workspace_sessions_expires_at_idx
  on public.workspace_sessions (expires_at);

/**
 * Delete every session no browser can still use.
 *
 * Two independent conditions, either of which is sufficient:
 *   - created_at older than the cookie TTL: the handle is gone.
 *   - expires_at more than the cookie TTL in the past: the access token died
 *     long ago and no refresh has been attempted since, so this is a corpse
 *     even if created_at is somehow recent.
 *
 * SECURITY DEFINER with a pinned search_path, and EXECUTE revoked from the
 * public roles: the anon key ships inside the app bundle, and a callable
 * session-deleting function would be a logout oracle for every citizen.
 */
create or replace function public.reap_workspace_sessions()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  deleted integer;
begin
  delete from public.workspace_sessions
  where created_at < now() - interval '14 days'
     or expires_at < now() - interval '14 days';
  get diagnostics deleted = row_count;
  return deleted;
end;
$$;

revoke all on function public.reap_workspace_sessions() from public, anon, authenticated;

-- Scheduling is deliberately left to the operator rather than hardcoded here,
-- because whether pg_cron is available differs per project. Once it is:
--
--   select cron.schedule(
--     'reap-workspace-sessions',
--     '17 4 * * *',
--     $cron$ select public.reap_workspace_sessions(); $cron$
--   );
--
-- Until it is scheduled, the function is a manual (service-role) sweep. Both
-- are strictly better than the current state, which is no reaper at all.
