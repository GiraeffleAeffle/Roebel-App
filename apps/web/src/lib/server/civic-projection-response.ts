import { NextResponse } from "next/server";

import {
  CivicProjectionNotFoundError,
  CivicProjectionUnavailableError,
} from "./civic-projection-reader";

const NO_STORE = { "cache-control": "no-store" } as const;

export async function civicProjectionResponse(
  read: () => Promise<unknown>
): Promise<NextResponse> {
  try {
    return NextResponse.json(await read(), { headers: NO_STORE });
  } catch (error) {
    if (error instanceof CivicProjectionNotFoundError) {
      return NextResponse.json(
        { error: "public_civic_projection_not_found" },
        { status: 404, headers: NO_STORE }
      );
    }
    if (error instanceof CivicProjectionUnavailableError) {
      return NextResponse.json(
        { error: "public_civic_projection_unavailable" },
        { status: 503, headers: NO_STORE }
      );
    }
    return NextResponse.json(
      { error: "public_civic_projection_unavailable" },
      { status: 503, headers: NO_STORE }
    );
  }
}
