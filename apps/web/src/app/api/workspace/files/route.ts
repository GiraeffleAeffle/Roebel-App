import { NextResponse } from "next/server";
import { buildAction } from "@netizen-labs/workspace";
import { ensureOrgFolder, requireWorkspace, resolveScope } from "@/lib/workspace/context";
import { errorResponse, parseScopeRequest } from "@/lib/workspace/request";
import { recordWorkspaceAction } from "@/lib/workspace/provenance-sink";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { session, client, provisioner } = await requireWorkspace();
    const parsed = parseScopeRequest(new URL(request.url));
    const scope = await resolveScope({ session, ...parsed });
    // Best-effort and only after the ACL + account-registry checks inside
    // resolveScope above: a transient OCS admin-API hiccup here (a separate
    // credential path from the citizen's own bearer-token listing call
    // below) must not blank an otherwise-healthy file list. ensureOrgFolder
    // is already a no-op for a personal scope and for any org this process
    // has already confirmed provisioned.
    await ensureOrgFolder({ session, client, provisioner }, scope).catch((error) => {
      console.error("[workspace] ensureOrgFolder failed:", error);
    });
    return NextResponse.json({ entries: await client.listDirectory(scope, parsed.path) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const { session, client } = await requireWorkspace();
    const parsed = parseScopeRequest(new URL(request.url));
    const scope = await resolveScope({ session, ...parsed });
    await client.remove(scope, parsed.path);
    await recordWorkspaceAction(
      buildAction({
        actor: { kind: "human", sub: session.sub },
        kind: "delete",
        scope,
        path: parsed.path,
      }),
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
