import { NextResponse } from "next/server";
import { checkAllConnections } from "@/core/connections";
import { logger } from "@/lib/logger";

export async function GET() {
  try {
    const connections = await checkAllConnections();
    return NextResponse.json({ connections });
  } catch (err) {
    logger.error(undefined, "GET /api/connections failed", { error: String(err) });
    return NextResponse.json({ error: "Failed to check provider connections." }, { status: 500 });
  }
}
