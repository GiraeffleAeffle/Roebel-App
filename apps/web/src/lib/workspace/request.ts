import { NextResponse } from "next/server";
import { ScopeViolationError } from "@netizen-labs/workspace";
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
 */
export function errorResponse(error: unknown): Response {
  if (error instanceof WorkspaceAuthError) {
    const status = error.reason === "forbidden" ? 403 : 401;
    return NextResponse.json({ reason: error.reason }, { status });
  }
  if (error instanceof ScopeViolationError) {
    return NextResponse.json({ error: "ungueltiger Pfad" }, { status: 400 });
  }
  console.error("[workspace] unexpected error:", error);
  return NextResponse.json({ error: "Serverfehler" }, { status: 500 });
}
