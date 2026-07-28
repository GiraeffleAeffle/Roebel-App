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
    const scope = resolveScope({ session, ...parsed });
    await ensureOrgFolder({ session, client, provisioner }, scope);
    return NextResponse.json({ entries: await client.listDirectory(scope, parsed.path) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const { session, client } = await requireWorkspace();
    const parsed = parseScopeRequest(new URL(request.url));
    const scope = resolveScope({ session, ...parsed });
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
