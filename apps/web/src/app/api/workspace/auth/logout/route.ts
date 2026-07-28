import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/workspace/context";
import { createSessionStore } from "@/lib/workspace/session-store";

export const dynamic = "force-dynamic";

export async function POST() {
  const sessionId = (await cookies()).get(SESSION_COOKIE)?.value;

  if (sessionId) {
    try {
      // Destroy the stored session as well as the cookie: a row left behind
      // is a live Nextcloud token that a logout was supposed to end.
      await createSessionStore().destroy(sessionId);
    } catch (err) {
      // Fail loudly rather than silently. If the delete failed we cannot
      // confirm the session row is gone, so telling the browser it is
      // logged out — and clearing the cookie — would abandon a live
      // credential with no way for the citizen to retry: the cookie is the
      // only handle this app has on that row. Keep the cookie so a retry
      // can find the same session and attempt the delete again.
      console.error("workspace logout: failed to destroy session", err);
      return NextResponse.json({ error: "Serverfehler" }, { status: 500 });
    }
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.delete(SESSION_COOKIE);
  return response;
}
