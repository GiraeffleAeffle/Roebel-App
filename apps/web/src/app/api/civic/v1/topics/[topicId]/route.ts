import { projectPublicCivicTopicDetail } from "@/lib/stadtstack/civic-topic-detail";
import { civicProjectionResponse } from "@/lib/server/civic-projection-response";
import {
  CivicProjectionNotFoundError,
  configuredCivicProjectionReader,
} from "@/lib/server/civic-projection-reader";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(
  _request: Request,
  context: { params: Promise<{ topicId: string }> }
) {
  return civicProjectionResponse(async () => {
    const { topicId } = await context.params;
    const feed = await configuredCivicProjectionReader().readPublicFeed();
    const detail = projectPublicCivicTopicDetail(feed, topicId);
    if (!detail) throw new CivicProjectionNotFoundError();
    return {
      schemaVersion: "roebel_public_civic_topic_detail_v1",
      detail,
      authorityBinding: "none",
    };
  });
}
