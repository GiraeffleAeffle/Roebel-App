import { NextResponse } from "next/server";

import {
  parsePublicMeckyChatQuestion,
  requestPublicMeckyChat,
} from "@/lib/public-mecky-chat";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TIMEOUT_MS = 35_000;

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "request_invalid" }, { status: 400 });
  }

  let question: string;
  try {
    question = parsePublicMeckyChatQuestion(body);
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
      question,
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
