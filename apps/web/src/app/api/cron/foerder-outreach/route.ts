import { NextRequest, NextResponse } from "next/server";
import { runFoerderOutreach } from "@/lib/outreach/foerder-outreach";

export const runtime = "nodejs";
export const maxDuration = 60;

// Daily proactive Fördermittel outreach: invite eligible orgs to run a funding check.
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await runFoerderOutreach();
    return NextResponse.json(result);
  } catch (error) {
    console.error("foerder-outreach cron error:", error);
    return NextResponse.json(
      { error: "Internal server error", details: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
