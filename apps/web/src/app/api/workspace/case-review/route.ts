import { closeSync, fstatSync, openSync, readFileSync } from "node:fs";
import { readSession } from "@/lib/workspace/context";
import { withWorkspaceRoute } from "@/lib/workspace/request";
import { createReviewGateway } from "@/lib/administration-review/gateway";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const handle = withWorkspaceRoute(async (request: Request) => {
  // Deployment-owned private file. No grant/token belongs in NEXT_PUBLIC_*.
  const path = process.env.ROEBEL_ADMIN_REVIEW_CONFIG_FILE;
  if (!path) return Response.json({ error: "review_not_configured" }, { status: 503, headers: { "cache-control": "no-store" } });
  // Contain parse errors here: a JSON parser can include private file contents
  // in its message, and the general workspace wrapper logs unexpected errors.
  let fd: number | undefined;
  try {
    fd = openSync(path, "r");
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > 65_536) throw Error();
    const config = JSON.parse(readFileSync(fd, "utf8"));
    return await createReviewGateway(config, { authenticate: readSession })(request);
  } catch {
    return Response.json({ error: "review_unavailable" }, { status: 503 });
  } finally { if (fd !== undefined) closeSync(fd); }
}, "identity");

export async function GET(request: Request) {
  const response = await handle(request);
  response.headers.set("cache-control", "no-store");
  response.headers.set("x-content-type-options", "nosniff");
  return response;
}
export const POST = GET;
