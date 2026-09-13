import { NextResponse } from "next/server";
import { z } from "zod";
import { approveRun } from "@/core/execute";
import { ZeroTraceError } from "@/core/errors";
import { logger } from "@/lib/logger";

const BodySchema = z.object({
  approverIdentity: z.string().min(1).max(200).optional(),
});

export async function POST(req: Request, context: { params: Promise<{ runId: string }> }) {
  const { runId } = await context.params;
  const json = await req.json().catch(() => ({}));
  const parsed = BodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  try {
    const result = await approveRun(runId, parsed.data.approverIdentity);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ZeroTraceError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 409 });
    }
    logger.error(runId, "POST /api/runs/[runId]/approve failed", { error: String(err) });
    return NextResponse.json({ error: "Approval failed unexpectedly." }, { status: 500 });
  }
}
