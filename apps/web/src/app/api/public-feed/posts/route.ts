import { NextResponse, type NextRequest } from "next/server";

import { getPostsForFeed } from "@/app/actions/posts";
import { withPublicFeedServerDeadline } from "@/lib/server/public-feed-deadline";
import type { FeedType } from "@/types/post";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const FEED_TYPES = new Set<FeedType>(["main", "rathaus", "app"]);

function boundedInteger(
  raw: string | null,
  fallback: number,
  maximum: number
): number {
  if (raw === null || !/^\d+$/.test(raw)) return fallback;
  return Math.min(Number(raw), maximum);
}

export async function GET(request: NextRequest) {
  const feedTypeRaw = request.nextUrl.searchParams.get("feedType");
  const feedType = FEED_TYPES.has(feedTypeRaw as FeedType)
    ? (feedTypeRaw as FeedType)
    : undefined;
  const categoryRaw = request.nextUrl.searchParams.get("category");
  const category =
    categoryRaw && /^[a-z0-9_-]{1,40}$/i.test(categoryRaw)
      ? categoryRaw
      : undefined;
  const outcome = await withPublicFeedServerDeadline(
    () =>
      getPostsForFeed({
        limit: boundedInteger(
          request.nextUrl.searchParams.get("limit"),
          20,
          50
        ),
        offset: boundedInteger(
          request.nextUrl.searchParams.get("offset"),
          0,
          500
        ),
        feedType,
        category,
      })
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
