import { NextRequest, NextResponse } from "next/server";
import { runStoryOutreach } from "@/lib/outreach/story-outreach";

export const runtime = "nodejs";
export const maxDuration = 60;

// Daily proactive story outreach: invite new eligible orgs to tell their story.
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await runStoryOutreach();
    return NextResponse.json(result);
  } catch (error) {
    console.error("story-outreach cron error:", error);
    return NextResponse.json(
      { error: "Internal server error", details: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
