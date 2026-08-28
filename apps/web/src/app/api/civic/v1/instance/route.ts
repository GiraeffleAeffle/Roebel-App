import { civicProjectionResponse } from "@/lib/server/civic-projection-response";
import { configuredCivicProjectionReader } from "@/lib/server/civic-projection-reader";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  return civicProjectionResponse(() =>
    configuredCivicProjectionReader().readInstance()
  );
}
