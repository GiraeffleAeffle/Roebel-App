import { NextResponse } from "next/server";
import { NextcloudError, ScopeViolationError } from "@netizen-labs/workspace";
import { WorkspaceAuthError } from "./context";

/** Query parameters -> the arguments resolveScope expects. */
export function parseScopeRequest(url: URL): {
  scopeKind: string | null;
  accountId: string | null;
  orgName: string | null;
  path: string;
} {
  const q = url.searchParams;
  return {
    scopeKind: q.get("scope"),
    accountId: q.get("accountId"),
    orgName: q.get("orgName"),
    path: q.get("path") ?? "",
  };
}

/**
 * Map a thrown error to a response.
 *
 * 401 is the signal the client uses to start the OIDC hop, so it must be
 * distinguishable from 403. Nothing below those two describes what failed:
 * a traversal attempt gets a flat "invalid path", and an unexpected error gets
 * no message at all — an internal error message is an information leak.
 *
 * `NextcloudError` gets its own branch, before the catch-all, for the same
 * no-leak reason: its `.message` embeds the resolved WebDAV path
 * (`${method} ${absolutePath} failed with ${status}`), so it is never
 * forwarded — only a fixed, generic string per status. A 401 from Nextcloud
 * is mapped to the *same shape* as WorkspaceAuthError's 401 branch
 * (`{ reason: "expired" }`), because it reports a distinct failure the app's
 * own session checks cannot see (a token revoked out-of-band, an IdP session
 * killed, clock skew, a misconfigured user_oidc) but the client must react to
 * it identically — 401 is the only signal it uses to start the OIDC hop, and
 * that self-healing path must not silently break into an unrecoverable 500.
 * An unmapped Nextcloud status is a 502, not a 500: 500 means "our bug", 502
 * means "the upstream said no" — the distinction that keeps the logs
 * readable later.
 */
export function errorResponse(error: unknown): Response {
  if (error instanceof WorkspaceAuthError) {
    const status = error.reason === "forbidden" ? 403 : 401;
    return NextResponse.json({ reason: error.reason }, { status });
  }
  if (error instanceof ScopeViolationError) {
    return NextResponse.json({ error: "ungueltiger Pfad" }, { status: 400 });
  }
  if (error instanceof NextcloudError) {
    if (error.status === 401) {
      return NextResponse.json({ reason: "expired" }, { status: 401 });
    }
    if (error.status === 404) {
      return NextResponse.json({ error: "nicht gefunden" }, { status: 404 });
    }
    if (error.status === 423) {
      return NextResponse.json({ error: "Datei ist gesperrt" }, { status: 423 });
    }
    if (error.status === 507) {
      return NextResponse.json(
        { error: "kein Speicherplatz mehr verfuegbar" },
        { status: 507 },
      );
    }
    console.error("[workspace] nextcloud error:", error);
    return NextResponse.json({ error: "Serverfehler" }, { status: 502 });
  }
  console.error("[workspace] unexpected error:", error);
  return NextResponse.json({ error: "Serverfehler" }, { status: 500 });
}

/**
 * Reduce a workspace-relative path to a bare filename safe to sit inside the
 * quoted-string of a Content-Disposition header. Only the last path segment
 * is kept; the two characters that end or escape a quoted-string (`"` and
 * `\`) and the two that could otherwise inject a second header (CR, LF) are
 * stripped rather than escaped, so a crafted name cannot break out of
 * `attachment; filename="..."` no matter what it contains. A semicolon is
 * left alone — harmless inside the quotes, no different from any other
 * ordinary character.
 */
export function sanitizeDownloadFilename(path: string): string {
  const base = path.split("/").pop() || "download";
  return base.replace(/["\\\r\n]/g, "") || "download";
}
