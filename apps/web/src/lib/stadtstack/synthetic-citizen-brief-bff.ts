import { readSyntheticBriefResponse, syntheticBriefPath } from "@roebel/stadtstack-federation-client";
import { fetchReviewWithPinnedHost } from "../administration-review/transport";
import { verifyPublicCaseBindingReceipt, type PublicCaseBindingReceipt } from "./public-case-binding-receipt-contract";

const INTERNAL = "http://roebel-case-steward-control.stadtstack-roebel-staging-lab.svc.cluster.local:18090";
const headers = { "cache-control": "no-store", "x-content-type-options": "nosniff" };
const error = (status: number) => Response.json({ error: status === 404 ? "not_found" : "brief_unavailable" }, { status, headers });

/** GET only, no browser credentials or administrative view crosses this hop. */
export async function respondSyntheticBrief(request: Request, rootId: string, config: {
  environment: string; caseId: string; upstreamOrigin: string;
}, dependencies: { readReceipt(id: string): Promise<PublicCaseBindingReceipt | null>; fetch?: typeof fetch }) {
  if (request.method !== "GET") return new Response(null, { status: 405, headers: { ...headers, allow: "GET" } });
  try {
    const url = new URL(request.url);
    if (url.pathname !== syntheticBriefPath(rootId) || url.search) return error(404);
    if (config.environment !== "staging" || config.upstreamOrigin !== INTERNAL) return error(503);
    const value = await dependencies.readReceipt(rootId);
    if (!value) return error(404);
    const receipt = verifyPublicCaseBindingReceipt(value);
    if (receipt.schemaVersion !== "public_synthetic_case_binding_receipt_v1" || receipt.rootEventId !== rootId ||
      receipt.caseId !== config.caseId) return error(404);
    const upstream = await (dependencies.fetch ?? fetchReviewWithPinnedHost)(`${INTERNAL}/v1/staging/administration/citizen-brief`, {
      method: "GET", headers: { host: "127.0.0.1", accept: "application/json" }, credentials: "omit",
      redirect: "error", cache: "no-store", signal: AbortSignal.timeout(10_000),
    });
    const result = await readSyntheticBriefResponse(upstream, { caseId: receipt.caseId, discussionId: rootId, topicId: receipt.topicId });
    return Response.json(result, { headers });
  } catch { return error(503); }
}
