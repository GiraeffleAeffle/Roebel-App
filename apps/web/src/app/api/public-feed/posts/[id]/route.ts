import { NextResponse } from "next/server";

import { getPostById } from "@/app/actions/posts";
import { withPublicFeedServerDeadline } from "@/lib/server/public-feed-deadline";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const PUBLIC_POST_ID =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|[0-9a-f]{64})$/i;

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  if (!PUBLIC_POST_ID.test(id)) {
    return NextResponse.json(
      { success: false, error: "Beitrag nicht gefunden" },
      { status: 404, headers: { "cache-control": "no-store" } }
    );
  }
  const outcome = await withPublicFeedServerDeadline(() => getPostById(id));
  if (outcome.timedOut) {
    return NextResponse.json(
      {
        success: false,
        error: "Öffentlicher Feed antwortet gerade nicht. Bitte erneut laden.",
      },
      { status: 503, headers: { "cache-control": "no-store" } }
    );
  }
  const result = outcome.value;
  return NextResponse.json(result, {
    status: result.success ? 200 : 404,
    headers: { "cache-control": "no-store" },
  });
}
