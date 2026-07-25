/**
 * POST /api/mecky/story-publish — publish bridge for the Expo "Erzähl deine
 * Geschichte" flow. Thin wrapper around the `publishStory` server action so
 * the Expo app (which has no Next.js session/cookies) can flip a drafted
 * `blog_articles` row to published the same way the web dashboard does.
 *
 * Body: { articleId, accountId, walletAddress }
 * 200 → { success: true, postId? }
 * 4xx/5xx → { success: false, error } (German)
 */
import { NextResponse } from "next/server";
import { publishStory } from "@/app/actions/story";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: { articleId?: string; accountId?: string; walletAddress?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: "Ungültige Anfrage" }, { status: 400 });
  }

  const { articleId, accountId, walletAddress } = body;
  if (!articleId || !accountId || !walletAddress) {
    return NextResponse.json({ success: false, error: "Pflichtfelder fehlen" }, { status: 400 });
  }

  try {
    const result = await publishStory(articleId, accountId, walletAddress);
    return NextResponse.json(result, { status: result.success ? 200 : 400 });
  } catch (error) {
    console.error("[api/mecky/story-publish] failed", error);
    return NextResponse.json(
      { success: false, error: "Interner Fehler beim Veröffentlichen" },
      { status: 500 },
    );
  }
}
