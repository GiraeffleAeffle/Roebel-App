import { type NextRequest, NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { countUnreadNotifications } from "@/lib/notifications/unread-count";
import { createSupabaseUnreadCountSources } from "@/lib/notifications/supabase-unread-count";
import {
  parseUnreadCountParameters,
  readUnreadCountQuery,
  UnreadCountRequestError,
  type UnreadCountParameters,
} from "@/lib/notifications/unread-count-request";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
};

function invalidRequest(error: unknown) {
  const message = error instanceof UnreadCountRequestError
    ? error.message
    : "Invalid request body";
  return NextResponse.json(
    { error: message },
    { status: 400, headers: NO_STORE_HEADERS }
  );
}

async function respondWithUnreadCount(parameters: UnreadCountParameters) {
  try {
    const supabase = await createClient();
    const count = await countUnreadNotifications({
      ...parameters,
      sources: createSupabaseUnreadCountSources(supabase),
    });
    return NextResponse.json({ count }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    console.error("[notifications/unread-count] count failed", error);
    return NextResponse.json(
      { error: "Unable to count unread notifications" },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}

/**
 * Read-only transport for staging, where the public ingress permits GET/HEAD
 * but intentionally rejects Next Server Action POST requests.
 */
export async function GET(request: NextRequest) {
  try {
    return await respondWithUnreadCount(readUnreadCountQuery(request.nextUrl.searchParams));
  } catch (error) {
    return invalidRequest(error);
  }
}

/** Retained for clients outside the GET/HEAD-only staging ingress. */
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch (error) {
    return invalidRequest(error);
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return invalidRequest(new Error("Invalid request body"));
  }

  try {
    return await respondWithUnreadCount(parseUnreadCountParameters(body));
  } catch (error) {
    return invalidRequest(error);
  }
}
