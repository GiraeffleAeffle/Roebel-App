import { loadReviewConfig } from "@/lib/administration-review/configuration";
import { readSession } from "@/lib/workspace/context";
import { withWorkspaceRoute } from "@/lib/workspace/request";
import { createReviewGateway } from "@/lib/administration-review/gateway";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const handle = withWorkspaceRoute(async (request: Request) => {
  try {
    return await createReviewGateway(loadReviewConfig(), { authenticate: readSession })(request);
  } catch {
    return Response.json({ error: "review_unavailable" }, { status: 503 });
  }
}, "identity");

export async function GET(request: Request) {
  const response = await handle(request);
  response.headers.set("cache-control", "no-store");
  response.headers.set("x-content-type-options", "nosniff");
  return response;
}
export const POST = GET;
