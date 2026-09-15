import { loadReviewConfig } from "@/lib/administration-review/configuration";
import { fetchVerifiedPublicCaseBindingReceipt } from "@/lib/stadtstack/public-case-binding-receipt.server";
import { respondSyntheticBrief } from "@/lib/stadtstack/synthetic-citizen-brief-bff";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ rootId: string }> }) {
  try {
    const { environment, caseId, additionalCaseIds, upstreamOrigin } = loadReviewConfig();
    const { rootId } = await context.params;
    return await respondSyntheticBrief(request, rootId, { environment, caseId, additionalCaseIds, upstreamOrigin },
      { readReceipt: id => fetchVerifiedPublicCaseBindingReceipt(id, { signal: AbortSignal.timeout(3000) }) });
  } catch {
    return Response.json({ error: "brief_unavailable" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
