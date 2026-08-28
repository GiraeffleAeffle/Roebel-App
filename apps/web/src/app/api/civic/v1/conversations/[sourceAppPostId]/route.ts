import { civicProjectionResponse } from "@/lib/server/civic-projection-response";
import { configuredCivicProjectionReader } from "@/lib/server/civic-projection-reader";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(
  _request: Request,
  context: { params: Promise<{ sourceAppPostId: string }> }
) {
  return civicProjectionResponse(async () => {
    const { sourceAppPostId } = await context.params;
    return configuredCivicProjectionReader().readConversation(sourceAppPostId);
  });
}
