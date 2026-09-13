import { NextResponse } from "next/server";
import { buildReceipt } from "@/core/receipt";

export async function GET(_req: Request, context: { params: Promise<{ runId: string }> }) {
  const { runId } = await context.params;
  const receipt = await buildReceipt(runId);
  if (!receipt) {
    return NextResponse.json({ error: "Run not found." }, { status: 404 });
  }
  return NextResponse.json(receipt);
}
