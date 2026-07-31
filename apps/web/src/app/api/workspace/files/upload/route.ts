import { NextResponse } from "next/server";
import { buildAction } from "@netizen-labs/workspace";
import { requireWorkspace, resolveScope } from "@/lib/workspace/context";
import {
  errorResponse,
  parseScopeRequest,
  readOnlyResponse,
  withWorkspaceRoute,
} from "@/lib/workspace/request";
import { recordWorkspaceAction } from "@/lib/workspace/provenance-sink";

export const dynamic = "force-dynamic";

export const PUT = withWorkspaceRoute(async (request: Request) => {
  try {
    const { session, client } = await requireWorkspace();
    const parsed = parseScopeRequest(new URL(request.url));
    const scope = await resolveScope({ session, ...parsed });
    if (!scope.canWrite) return readOnlyResponse();
    await client.upload(scope, parsed.path, await request.arrayBuffer());
    await recordWorkspaceAction(
      buildAction({
        actor: { kind: "human", sub: session.sub },
        kind: "upload",
        scope,
        path: parsed.path,
      }),
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
});
