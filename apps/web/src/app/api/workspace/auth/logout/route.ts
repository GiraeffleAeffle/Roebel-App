import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/workspace/context";
import { createSessionStore } from "@/lib/workspace/session-store";

export const dynamic = "force-dynamic";

export async function POST() {
  // Destroy the stored session as well as the cookie: a row left behind is a
  // live Nextcloud token that a logout was supposed to end.
  const sessionId = (await cookies()).get(SESSION_COOKIE)?.value;
  if (sessionId) await createSessionStore().destroy(sessionId);

  const response = NextResponse.json({ ok: true });
  response.cookies.delete(SESSION_COOKIE);
  return response;
}
