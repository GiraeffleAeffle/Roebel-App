import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

export const runtime = "nodejs"
export const maxDuration = 30

/**
 * Reap expired workspace sessions.
 *
 * `workspace_sessions` rows hold live Nextcloud access AND refresh tokens. A
 * row outlives its usefulness the moment its cookie does — the citizen closed
 * the browser, the cookie hit its 14-day maxAge, a token refresh failed — but
 * nothing deletes it on those paths, so without this sweep the table becomes an
 * unbounded store of live credentials. That is the whole reason this job
 * exists; it is not housekeeping.
 *
 * The work is done by `public.reap_workspace_sessions()`, a SECURITY DEFINER
 * function with a pinned search_path whose EXECUTE is revoked from anon and
 * authenticated (see supabase/migrations/20260728_workspace_sessions_gc.sql).
 * We reach it with the service role, which is why this route is behind
 * CRON_SECRET like every other cron route here.
 *
 * Deliberately idempotent and safe to run by hand: it deletes only rows older
 * than the 14-day cutoff, so an extra invocation is a no-op returning 0.
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization")
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    // Loud, not silent: a GC that cannot run must not report success, or the
    // table grows unnoticed until someone reads it during an incident.
    console.error("[workspace-gc] missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
    return NextResponse.json({ error: "not configured" }, { status: 503 })
  }

  try {
    const { data, error } = await createClient(url, serviceKey).rpc(
      "reap_workspace_sessions"
    )
    if (error) throw new Error(error.message)

    const deleted = typeof data === "number" ? data : 0
    console.log(`[workspace-gc] reaped ${deleted} expired workspace session(s)`)
    return NextResponse.json({ ok: true, deleted })
  } catch (error) {
    console.error("[workspace-gc] failed:", error)
    return NextResponse.json(
      {
        error: "Internal server error",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    )
  }
}
