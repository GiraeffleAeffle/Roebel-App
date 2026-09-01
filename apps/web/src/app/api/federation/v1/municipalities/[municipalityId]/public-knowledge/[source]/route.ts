import { roebelReviewedPublicKnowledge } from "../../../../../../../../lib/mecky/reviewed-public-knowledge";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: {
    params: Promise<{ municipalityId: string; source: string }>;
  }
) {
  const { municipalityId, source } = await context.params;
  const projection = roebelReviewedPublicKnowledge(municipalityId, source);
  if (!projection) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  return Response.json(projection, {
    headers: {
      "Cache-Control": "no-store",
      ETag: `\"${projection.contentSha256}\"`,
    },
  });
}
