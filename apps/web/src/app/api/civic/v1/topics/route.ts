import { civicProjectionResponse } from "@/lib/server/civic-projection-response";
import { configuredCivicProjectionReader } from "@/lib/server/civic-projection-reader";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  return civicProjectionResponse(async () => {
    const feed = await configuredCivicProjectionReader().readPublicFeed();
    return {
      schemaVersion: "roebel_public_civic_topic_list_v1",
      topics: feed.posts.filter((entry) => entry.entryType === "topic"),
      authorityBinding: "none",
    };
  });
}
