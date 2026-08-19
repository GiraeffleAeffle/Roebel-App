import { NextResponse, type NextRequest } from "next/server";

import { getComments } from "@/app/actions/posts";

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
  const result = await getComments(
    id,
    boundedInteger(request.nextUrl.searchParams.get("limit"), 50, 100),
    boundedInteger(request.nextUrl.searchParams.get("offset"), 0, 500)
  );
  return NextResponse.json(result, {
    status: result.success ? 200 : 503,
    headers: { "cache-control": "no-store" },
  });
}
