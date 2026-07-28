import { NextResponse } from "next/server";
import { readSession } from "@/lib/workspace/context";

export const dynamic = "force-dynamic";

/** Who the workspace session belongs to. Never returns token material. */
export async function GET() {
  const session = await readSession();
  return NextResponse.json({ sub: session?.sub ?? null });
}
