import { NextResponse } from "next/server";
import { readSession } from "@/lib/workspace/context";
import { withWorkspaceRoute } from "@/lib/workspace/request";

export const dynamic = "force-dynamic";

/** Who the workspace session belongs to. Never returns token material. */
export const GET = withWorkspaceRoute(async () => {
  const session = await readSession();
  return NextResponse.json({ sub: session?.sub ?? null });
});
