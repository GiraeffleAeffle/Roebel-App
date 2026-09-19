import { roebelReviewedPublicKnowledge } from "../../../../../../../../lib/mecky/reviewed-public-knowledge";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: {
    params: Promise<{ municipalityId: string; source: string }>;
  }
) {
  const { municipalityId, source } = await context.params;
  let projection;
  try {
    projection = await roebelReviewedPublicKnowledge(municipalityId, source);
  } catch {
    // Never expose source paths, malformed content or a stale fallback.
    return Response.json({ error: "source_unavailable" }, {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }
  if (!projection) {
    return Response.json({ error: "not_found" }, {
      status: 404,
      headers: { "Cache-Control": "no-store" },
    });
  }
  return Response.json(projection, {
    headers: {
      "Cache-Control": "no-store",
      ETag: `\"${projection.contentSha256}\"`,
    },
  });
}
