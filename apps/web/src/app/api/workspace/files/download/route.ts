import { requireWorkspace, resolveScope } from "@/lib/workspace/context";
import {
  errorResponse,
  parseScopeRequest,
  sanitizeDownloadFilename,
  withWorkspaceRoute,
} from "@/lib/workspace/request";

export const dynamic = "force-dynamic";

export const GET = withWorkspaceRoute(async (request: Request) => {
  try {
    const { session, client } = await requireWorkspace();
    const parsed = parseScopeRequest(new URL(request.url));
    const scope = await resolveScope({ session, ...parsed });
    const body = await client.download(scope, parsed.path);
    return new Response(body, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${sanitizeDownloadFilename(parsed.path)}"`,
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
});
