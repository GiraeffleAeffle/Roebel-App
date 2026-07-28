import { NextResponse } from "next/server";
import {
  bearerAuth,
  checkFileInfo,
  createNextcloudClient,
  decodeFileId,
  verifyWopiToken,
} from "@netizen-labs/workspace";
import { workspaceConfig } from "@/lib/workspace/config";
import { loadSession } from "@/lib/workspace/context";

export const dynamic = "force-dynamic";

/**
 * CheckFileInfo. Collabora calls this itself, with only the WOPI token — there
 * is NO browser cookie on this request. The token is therefore the sole
 * authority, and the citizen's Nextcloud tokens are reached through the
 * session id it carries.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ fileId: string }> },
) {
  const cfg = workspaceConfig();
  const token = new URL(request.url).searchParams.get("access_token");
  if (!token) return NextResponse.json({}, { status: 401 });

  let claims;
  try {
    claims = await verifyWopiToken(token, cfg.wopiSecret);
  } catch {
    return NextResponse.json({}, { status: 401 });
  }

  const { fileId } = await params;
  let path: string;
  try {
    ({ path } = decodeFileId(fileId));
  } catch {
    return NextResponse.json({}, { status: 404 });
  }
  // The token is bound to one path; a mismatch means the file id was swapped.
  if (path !== claims.path) return NextResponse.json({}, { status: 403 });

  // Loading by id also refreshes an access token that expired mid-edit, which
  // is why a document open for two hours still saves.
  const session = await loadSession(claims.sessionId);
  if (!session) return NextResponse.json({}, { status: 401 });

  const client = createNextcloudClient({
    baseUrl: cfg.nextcloudBaseUrl,
    auth: bearerAuth(async () => session.accessToken),
  });
  const entry = await client.stat(claims.scope, claims.path);

  // Never a raw 0x in what Collabora renders as the collaborator's name.
  const friendly = "Bürger:in";
  return NextResponse.json(checkFileInfo(entry, claims, friendly));
}
