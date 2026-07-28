import { requireWorkspace, resolveScope } from "@/lib/workspace/context";
import { errorResponse, parseScopeRequest } from "@/lib/workspace/request";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { session, client } = await requireWorkspace();
    const parsed = parseScopeRequest(new URL(request.url));
    const scope = resolveScope({ session, ...parsed });
    const body = await client.download(scope, parsed.path);
    const name = parsed.path.split("/").pop() ?? "download";
    return new Response(body, {
      headers: {
        "Content-Type": "application/octet-stream",
        // The filename is quoted and stripped of quotes so a crafted name
        // cannot inject extra header directives.
        "Content-Disposition": `attachment; filename="${name.replace(/"/g, "")}"`,
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
