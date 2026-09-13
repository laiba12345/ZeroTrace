import { NextResponse } from "next/server";
import { z } from "zod";
import { executeRun } from "@/core/execute";
import { ZeroTraceError } from "@/core/errors";
import { logger } from "@/lib/logger";

const BodySchema = z.object({
  approvalToken: z.string().min(1),
});

export async function POST(req: Request, context: { params: Promise<{ runId: string }> }) {
  const { runId } = await context.params;
  const json = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body; approvalToken is required." }, { status: 400 });
  }

  try {
    const result = await executeRun(runId, parsed.data.approvalToken);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ZeroTraceError) {
      const status = err.code === "INVALID_APPROVAL_TOKEN" ? 403 : 409;
      return NextResponse.json({ error: err.message, code: err.code }, { status });
    }
    logger.error(runId, "POST /api/runs/[runId]/execute failed", { error: String(err) });
    return NextResponse.json({ error: "Execution failed unexpectedly. See server logs." }, { status: 500 });
  }
}
