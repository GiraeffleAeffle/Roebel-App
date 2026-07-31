import { NextResponse } from "next/server";
import { NextcloudError, ScopeViolationError } from "@netizen-labs/workspace";
import { WorkspaceAuthError } from "./context";
import { isWorkspaceEnabled } from "./config";

/**
 * The status every workspace route answers with while the deployment has no
 * workspace configured. 503 rather than 404 or 500: the route exists and the
 * code is fine, the SERVICE is not available here — and a client can tell that
 * apart from "you are signed out" (401) or "we broke" (500), which is exactly
 * the distinction `FileBrowser` needs to fall back to the link-out card
 * instead of starting an OIDC hop that cannot possibly complete.
 */
export const WORKSPACE_UNCONFIGURED_STATUS = 503;

/** The one body shape for "this deployment has no Arbeitsbereich". */
export function unconfiguredResponse(): Response {
  return NextResponse.json(
    { reason: "unconfigured" },
    { status: WORKSPACE_UNCONFIGURED_STATUS },
  );
}

/**
 * The status a write attempt gets when `resolveScope` granted read but not
 * write for this scope — an org member acting on an owner/admin-only path.
 * 403, not 401: the citizen IS signed in and the session is fine: this is an
 * access decision already made, the same reason `WorkspaceAuthError`'s
 * "forbidden" branch also answers 403 rather than sending the client into the
 * OIDC hop.
 */
export const WORKSPACE_READ_ONLY_STATUS = 403;

/**
 * The one body shape for "your role only grants read access here". Shared by
 * upload, folder-create and delete so the three write routes cannot drift on
 * the shape of a check each of them repeats right after `resolveScope`.
 */
export function readOnlyResponse(): Response {
  return NextResponse.json(
    { reason: "read-only" },
    { status: WORKSPACE_READ_ONLY_STATUS },
  );
}

/**
 * THE config gate for every route under /api/workspace. One place, not one
 * check per route — a route added later that forgets the check is the failure
 * mode this exists to remove, so wrapping the handler is the only way to
 * export one.
 *
 * Without it, the merge-day state (no workspace env vars set) played out like
 * this: no cookie -> requireWorkspace() throws WorkspaceAuthError("no-session")
 * -> 401 -> FileBrowser hard-navigates to /api/workspace/auth/login ->
 * workspaceConfig() throws, uncaught -> Next 500. Every visit to a page that
 * mounts FileBrowser, including /dashboard/arbeitsbereich, which worked before
 * this branch existed.
 *
 * The trailing catch is a second safety net: several routes (login, callback,
 * session, logout, the two WOPI handlers) had no try/catch of their own, so an
 * unexpected throw surfaced as a framework 500 with whatever the message
 * happened to be. `errorResponse` never forwards an error message.
 */
export function withWorkspaceRoute<A extends unknown[]>(
  handler: (...args: A) => Promise<Response>,
): (...args: A) => Promise<Response> {
  return async (...args: A): Promise<Response> => {
    if (!isWorkspaceEnabled()) return unconfiguredResponse();
    try {
      return await handler(...args);
    } catch (error) {
      return errorResponse(error);
    }
  };
}

/**
 * Query parameters -> the arguments resolveScope expects.
 *
 * No `orgName` here on purpose: an org's folder name is derived server-side
 * from `accountId` alone (see the incident writeup on `resolveScope`), so a
 * client-supplied name carries no authority and the wire format should not
 * invite anyone to re-trust it later by giving it a place to live.
 */
export function parseScopeRequest(url: URL): {
  scopeKind: string | null;
  accountId: string | null;
  path: string;
} {
  const q = url.searchParams;
  return {
    scopeKind: q.get("scope"),
    accountId: q.get("accountId"),
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
