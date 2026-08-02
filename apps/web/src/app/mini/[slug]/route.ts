/**
 * GET /mini/[slug] — serves a single-file AI-built mini app.
 *
 * This is the `home_url` target for apps published by the AI builder: the
 * newest mini_app_versions.html for the slug, returned as text/html. Loaded by
 * the Expo WebView host, the web Playground, and the builder preview. On
 * production each app lives on its own origin — https://<slug>.roebel.site is
 * rewritten to this route by next.config.mjs (wildcard domain on Vercel).
 *
 * Review gating happens at the store/list layer (only 'live' apps are listed);
 * this route also serves pending/approved apps so reviewers and the developer
 * can open them. Suspended/rejected apps are tombstoned (410) — that is the
 * kill-switch for already-distributed home_urls.
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { MINI_APPS_SITE_DOMAIN } from "@/lib/miniapp/siteDomain";
import { hasSupabase } from "@/lib/record";

export const runtime = "nodejs";

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

function htmlMessage(status: number, title: string, body: string): Response {
  return new Response(
    `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title></head><body style="font-family:system-ui,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;background:#fff;color:#111"><div style="text-align:center;padding:24px;max-width:320px"><p style="font-size:15px;font-weight:600;margin:0 0 6px">${title}</p><p style="font-size:13px;color:#6B7280;margin:0">${body}</p></div></body></html>`,
    {
      status,
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    },
  );
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  if (!SLUG_RE.test(slug)) {
    return htmlMessage(404, "Mini-App nicht gefunden", "Diese Adresse gibt es nicht.");
  }

  // The mini-app runtime is a Supabase-only feature (published app HTML
  // lives in mini_app_versions, no record equivalent) — createAdminClient()
  // throws immediately (not lazily) on a missing URL, so this must be
  // checked before ever constructing the client.
  if (!hasSupabase) {
    return htmlMessage(
      503,
      "Mini-Apps nicht verfügbar",
      "Diese Funktion benötigt ein Backend und ist im öffentlichen Datensatz nicht verfügbar.",
    );
  }

  // Served on the app's OWN dedicated origin (<slug>.roebel.site, rewritten
  // here by next.config.mjs)? The host slug must equal the path slug — a
  // mismatch (e.g. other-app.roebel.site/mini/<slug>) must NOT run this app's
  // HTML on another app's origin, so it keeps the sandbox below.
  const requestHost = (request.headers.get("host") ?? "").toLowerCase().split(":")[0];
  const servedOnOwnOrigin = requestHost === `${slug}.${MINI_APPS_SITE_DOMAIN}`;

  const supabase = createAdminClient();
  const { data: app, error } = await supabase
    .from("mini_apps")
    .select("id, name, status")
    .eq("slug", slug)
    .maybeSingle();

  if (error) {
    return htmlMessage(500, "Fehler", "Die Mini-App konnte nicht geladen werden. Versuch es gleich noch einmal.");
  }
  if (!app) {
    return htmlMessage(404, "Mini-App nicht gefunden", "Unter diesem Namen ist keine Mini-App veröffentlicht.");
  }
  if (app.status === "suspended" || app.status === "rejected") {
    return htmlMessage(410, "Mini-App nicht verfügbar", "Diese Mini-App wurde vom Röbel-Team deaktiviert.");
  }

  const { data: version } = await supabase
    .from("mini_app_versions")
    .select("html")
    .eq("mini_app_id", app.id)
    .not("html", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!version?.html) {
    return htmlMessage(404, "Keine Version verfügbar", "Für diese Mini-App wurde noch kein Inhalt veröffentlicht.");
  }

  return new Response(version.html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      // Short shared cache so review-state flips (kill-switch) take effect quickly.
      "cache-control": "public, max-age=0, s-maxage=60, stale-while-revalidate=300",
      "x-robots-tag": "noindex",
      // CRITICAL: the app is untrusted model/developer HTML. On its own
      // subdomain (<slug>.roebel.site) the dedicated origin IS the isolation —
      // no roebel.app cookies/API in reach, and the app gets real
      // localStorage. On the legacy same-origin /mini/ path, `sandbox` forces
      // an opaque origin so a malicious app can't ride an admin session. The
      // bridge (postMessage / ReactNativeWebView) works in both modes.
      ...(servedOnOwnOrigin
        ? {}
        : {
            "content-security-policy":
              "sandbox allow-scripts allow-forms allow-popups allow-modals",
          }),
    },
  });
}
