import { projectPublicCivicPostLink } from "@/lib/stadtstack/civic-topic-detail";
import { civicProjectionResponse } from "@/lib/server/civic-projection-response";
import {
  CivicProjectionNotFoundError,
  configuredCivicProjectionReader,
} from "@/lib/server/civic-projection-reader";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(
  _request: Request,
  context: { params: Promise<{ sourceAppPostId: string }> }
) {
  return civicProjectionResponse(async () => {
    const { sourceAppPostId } = await context.params;
    const feed = await configuredCivicProjectionReader().readPublicFeed();
    const link = projectPublicCivicPostLink(feed, sourceAppPostId);
    if (!link) throw new CivicProjectionNotFoundError();
    return {
      schemaVersion: "roebel_public_civic_post_link_v1",
      link,
      authorityBinding: "none",
    };
  });
}
