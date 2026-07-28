import { NextResponse } from "next/server";
import { buildEditorUrl, encodeFileId, mintWopiToken } from "@netizen-labs/workspace";
import {
  readSessionId,
  requireWorkspace,
  resolveScope,
} from "@/lib/workspace/context";
import { workspaceConfig } from "@/lib/workspace/config";
import { errorResponse, parseScopeRequest } from "@/lib/workspace/request";
import { extensionOf, loadDiscovery } from "@/lib/workspace/editor";

export const dynamic = "force-dynamic";

/**
 * How long an editing session's token stays valid. Eight hours covers a real
 * working day on one document; the access token inside the session expires far
 * sooner and is refreshed server-side, so this bound is about the capability,
 * not about the credential.
 */
const WOPI_TTL_SECONDS = 8 * 60 * 60;

/**
 * Mint an editing session: returns the iframe url plus the token the client
 * POSTs into the frame. The token is never put in the url — see wopi.ts.
 */
export async function GET(request: Request) {
  try {
    const { session, client } = await requireWorkspace();
    const cfg = workspaceConfig();
    const parsed = parseScopeRequest(new URL(request.url));
    const scope = resolveScope({ session, ...parsed });

    const discovery = await loadDiscovery(cfg.collaboraBaseUrl);
    const urlsrc = discovery.get(extensionOf(parsed.path));
    if (!urlsrc) {
      return NextResponse.json(
        { error: "Dieses Format kann nicht im Browser bearbeitet werden." },
        { status: 415 },
      );
    }

    // stat before minting: a token for a path that does not exist would send
    // Collabora into a retry loop against a 404.
    await client.stat(scope, parsed.path);

    // The session id rides in the token: Collabora's own calls carry no
    // cookie, so this is how the WOPI endpoints reach the citizen's tokens.
    const sessionId = await readSessionId();
    if (!sessionId) {
      return NextResponse.json({ reason: "no-session" }, { status: 401 });
    }

    const fileId = encodeFileId(scope, parsed.path);
    const token = await mintWopiToken(
      { sub: session.sub, sessionId, scope, path: parsed.path, canWrite: true },
      cfg.wopiSecret,
      WOPI_TTL_SECONDS,
    );

    return NextResponse.json({
      url: buildEditorUrl({
        urlsrc,
        wopiSrc: `${cfg.appOrigin}/api/workspace/wopi/files/${fileId}`,
        lang: "de-DE",
      }),
      token,
      ttlSeconds: WOPI_TTL_SECONDS,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
