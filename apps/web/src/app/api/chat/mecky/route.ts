import { NextResponse } from "next/server";

import {
  parsePublicMeckyChatRequest,
  type PublicMeckyChatRequest,
  requestPublicMeckyChat,
} from "@/lib/public-mecky-chat";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TIMEOUT_MS = 35_000;

export async function POST(request: Request) {
  let body: unknown;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > 6 * 1024) {
      return NextResponse.json({ error: "request_too_large" }, { status: 413 });
    }
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "request_invalid" }, { status: 400 });
  }

  let input: PublicMeckyChatRequest;
  try {
    input = parsePublicMeckyChatRequest(body);
  } catch {
    return NextResponse.json({ error: "request_invalid" }, { status: 400 });
  }

  const baseUrl = process.env.PUBLIC_MECKY_CHAT_URL;
  if (!baseUrl) {
    return NextResponse.json({ error: "service_unavailable" }, { status: 503 });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const result = await requestPublicMeckyChat({
      baseUrl,
      question: input.question,
      ...(input.context ? { context: input.context } : {}),
      signal: controller.signal,
    });
    return NextResponse.json(result, {
      headers: { "cache-control": "no-store" },
    });
  } catch {
    return NextResponse.json({ error: "service_unavailable" }, { status: 503 });
  } finally {
    clearTimeout(timeout);
  }
}
