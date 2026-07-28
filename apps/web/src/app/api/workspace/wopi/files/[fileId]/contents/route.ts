import { NextResponse } from "next/server";
import {
  bearerAuth,
  buildAction,
  createNextcloudClient,
  decodeFileId,
  verifyWopiToken,
  type WopiClaims,
} from "@netizen-labs/workspace";
import { workspaceConfig } from "@/lib/workspace/config";
import { loadSession } from "@/lib/workspace/context";
import { recordWorkspaceAction } from "@/lib/workspace/provenance-sink";
import { withWorkspaceRoute } from "@/lib/workspace/request";

export const dynamic = "force-dynamic";

async function authorise(
  request: Request,
  fileId: string,
): Promise<WopiClaims | null> {
  const cfg = workspaceConfig();
  const token = new URL(request.url).searchParams.get("access_token");
  if (!token) return null;
  try {
    const claims = await verifyWopiToken(token, cfg.wopiSecret);
    // decodeFileId throws on a malformed id — an id swapped for another
    // document's must be refused the same as any other mismatch, not turned
    // into a 500.
    return decodeFileId(fileId).path === claims.path ? claims : null;
  } catch {
    return null;
  }
}

/**
 * A client authenticated as the citizen who opened the document. There is no
 * cookie on a Collabora request, so the tokens come from the server-side
 * session the WOPI token names — refreshed here if the edit outlived them.
 */
async function nextcloud(claims: WopiClaims) {
  const cfg = workspaceConfig();
  const session = await loadSession(claims.sessionId);
  if (!session) return null;
  return createNextcloudClient({
    baseUrl: cfg.nextcloudBaseUrl,
    auth: bearerAuth(async () => session.accessToken),
  });
}

/** GetFile — Collabora loading the document. */
export const GET = withWorkspaceRoute(async (
  request: Request,
  { params }: { params: Promise<{ fileId: string }> },
) => {
  const claims = await authorise(request, (await params).fileId);
  if (!claims) return NextResponse.json({}, { status: 401 });
  const client = await nextcloud(claims);
  if (!client) return NextResponse.json({}, { status: 401 });

  const body = await client.download(claims.scope, claims.path);
  return new Response(body, {
    headers: { "Content-Type": "application/octet-stream" },
  });
});

/** PutFile — Collabora saving the document. */
export const POST = withWorkspaceRoute(async (
  request: Request,
  { params }: { params: Promise<{ fileId: string }> },
) => {
  const claims = await authorise(request, (await params).fileId);
  if (!claims) return NextResponse.json({}, { status: 401 });
  if (!claims.canWrite) return NextResponse.json({}, { status: 403 });
  const client = await nextcloud(claims);
  if (!client) return NextResponse.json({}, { status: 401 });

  await client.upload(claims.scope, claims.path, await request.arrayBuffer());
  await recordWorkspaceAction(
    buildAction({
      actor: { kind: "human", sub: claims.sub },
      kind: "update",
      scope: claims.scope,
      path: claims.path,
    }),
  );
  return NextResponse.json({});
});
