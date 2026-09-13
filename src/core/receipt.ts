import { prisma } from "@/db/client";
import { newReceiptId } from "@/lib/ids";

// The receipt is derived on demand from the already-persisted run,
// obligation, invariant, and evidence rows — those rows are the durable
// source of truth; this function never invents a fact that isn't in them.
export async function buildReceipt(runId: string) {
  const run = await prisma.run.findUnique({
    where: { id: runId },
    include: {
      obligations: { include: { evidenceRecords: true } },
      invariantResults: { include: { evidenceRecords: true } },
      operationLedger: true,
      events: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!run) return null;

  const mutationCount = run.operationLedger.filter((l) => l.result === "SUCCESS").length;

  return {
    receiptId: newReceiptId(),
    runId: run.id,
    generatedAt: new Date().toISOString(),
    rawInstruction: run.rawInstruction,
    compiledIntent: safeParse(run.compiledIntent),
    subject: safeParse(run.resolvedIdentity),
    project: safeParse(run.resolvedProject),
    approvedPlan: safeParse(run.approvedPlan),
    planHash: run.planHash,
    approvedAt: run.approvedAt,
    approvedBy: run.approvedBy,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    finalStatus: run.status,
    mutationCount,
    obligations: run.obligations.map((o) => ({
      provider: o.provider,
      resourceId: o.resourceId,
      subjectId: o.subjectId,
      status: o.status,
      mutationAttempted: o.mutationAttempted,
      error: o.errorSafeMessage
        ? { category: o.errorCategory, providerCode: o.errorProviderCode, safeMessage: o.errorSafeMessage }
        : null,
      evidence: o.evidenceRecords.map(evidenceView),
    })),
    invariants: run.invariantResults.map((i) => ({
      name: i.name,
      provider: i.provider,
      status: i.status,
      detail: i.detail,
      evidence: i.evidenceRecords.map(evidenceView),
    })),
    operationLedger: run.operationLedger.map((l) => ({
      operationType: l.operationType,
      provider: l.provider,
      targetId: l.targetId,
      planHash: l.planHash,
      startedAt: l.startedAt,
      finishedAt: l.finishedAt,
      result: l.result,
      providerRequestId: l.providerRequestId,
    })),
    blockers: safeParse(run.blockers) ?? [],
  };
}

function evidenceView(e: { id: string; phase: string; resourceType: string; resourceId: string; observedAt: Date; requestId: string | null; assertion: string; result: string; payloadHash: string }) {
  return {
    id: e.id,
    phase: e.phase,
    resourceType: e.resourceType,
    resourceId: e.resourceId,
    observedAt: e.observedAt,
    requestId: e.requestId,
    assertion: e.assertion,
    result: e.result,
    payloadHash: e.payloadHash,
  };
}

function safeParse(value: string | null): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
