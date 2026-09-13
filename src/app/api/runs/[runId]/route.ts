import { NextResponse } from "next/server";
import { prisma } from "@/db/client";

export async function GET(_req: Request, context: { params: Promise<{ runId: string }> }) {
  const { runId } = await context.params;

  const run = await prisma.run.findUnique({
    where: { id: runId },
    include: {
      obligations: true,
      invariantResults: true,
      operationLedger: true,
      events: { orderBy: { createdAt: "asc" } },
    },
  });

  if (!run) {
    return NextResponse.json({ error: "Run not found." }, { status: 404 });
  }

  return NextResponse.json({
    id: run.id,
    rawInstruction: run.rawInstruction,
    status: run.status,
    compiledIntent: safeParse(run.compiledIntent),
    resolvedIdentity: safeParse(run.resolvedIdentity),
    resolvedProject: safeParse(run.resolvedProject),
    beforeState: safeParse(run.beforeState),
    approvedPlan: safeParse(run.approvedPlan),
    planHash: run.planHash,
    blockers: safeParse(run.blockers) ?? [],
    approvedAt: run.approvedAt,
    approvedBy: run.approvedBy,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    obligations: run.obligations,
    invariantResults: run.invariantResults,
    operationLedger: run.operationLedger,
    events: run.events,
    // approvalToken is intentionally never returned in this read-model —
    // it is handed back only once, in the approve response body.
  });
}

function safeParse(value: string | null): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
