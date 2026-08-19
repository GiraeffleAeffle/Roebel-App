import { NextResponse, type NextRequest } from "next/server";

import { getComments } from "@/app/actions/posts";
import { withPublicFeedServerDeadline } from "@/lib/server/public-feed-deadline";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const PUBLIC_POST_ID =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|[0-9a-f]{64})$/i;

function boundedInteger(
  raw: string | null,
  fallback: number,
  maximum: number
): number {
  if (raw === null || !/^\d+$/.test(raw)) return fallback;
  return Math.min(Number(raw), maximum);
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  if (!PUBLIC_POST_ID.test(id)) {
    return NextResponse.json(
      { success: false, error: "Beitrag nicht gefunden" },
      { status: 404, headers: { "cache-control": "no-store" } }
    );
  }
  const outcome = await withPublicFeedServerDeadline(
    () =>
      getComments(
        id,
        boundedInteger(request.nextUrl.searchParams.get("limit"), 50, 100),
        boundedInteger(request.nextUrl.searchParams.get("offset"), 0, 500)
      )
  );
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
    status: result.success ? 200 : 503,
    headers: { "cache-control": "no-store" },
  });
}
