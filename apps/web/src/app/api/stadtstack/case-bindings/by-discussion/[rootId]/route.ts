import { NextResponse } from "next/server";

import {
  fetchVerifiedPublicCaseBindingReceipt,
} from "@/lib/stadtstack/public-case-binding-receipt.server";
import { respondPublicCaseBindingRequest } from "@/lib/stadtstack/public-case-binding-bff";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TIMEOUT_MS = 3_000;
async function respond(rootId: string, method: "GET" | "HEAD") {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await respondPublicCaseBindingRequest({
      method,
      rootEventId: rootId,
      read: (exactRootId) =>
        fetchVerifiedPublicCaseBindingReceipt(exactRootId, {
          signal: controller.signal,
        }),
    });
    return response.body === null
      ? new NextResponse(null, { status: response.status, headers: response.headers })
      : NextResponse.json(response.body, {
          status: response.status,
          headers: response.headers,
        });
  } finally {
    clearTimeout(timeout);
  }
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ rootId: string }> }
) {
  return respond((await params).rootId, "GET");
}

export async function HEAD(
  _request: Request,
  { params }: { params: Promise<{ rootId: string }> }
) {
  return respond((await params).rootId, "HEAD");
}
