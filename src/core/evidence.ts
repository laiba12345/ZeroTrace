import { prisma } from "@/db/client";
import { newEvidenceId, hashCanonical } from "@/lib/ids";
import { redactDeep } from "@/lib/redact";
import type { ProviderName } from "@/providers/types";

export type EvidencePhase = "BEFORE" | "MUTATION" | "AFTER" | "INVARIANT";
export type EvidenceResult = "PASS" | "FAIL" | "UNKNOWN";

export type RecordEvidenceInput = {
  runId: string;
  obligationId?: string;
  invariantResultId?: string;
  provider: ProviderName | "system";
  phase: EvidencePhase;
  resourceType: string;
  resourceId: string;
  requestId?: string;
  assertion: string;
  result: EvidenceResult;
  normalizedValue: unknown;
};

// Every provider read/mutation that matters to an obligation or invariant
// must pass through here — this is the single place evidence rows are
// created, so redaction and hashing are never skipped by a call site.
export async function recordEvidence(input: RecordEvidenceInput): Promise<string> {
  const id = newEvidenceId();
  const redacted = redactDeep(input.normalizedValue);
  const payloadHash = hashCanonical(redacted);

  await prisma.evidenceRecord.create({
    data: {
      id,
      runId: input.runId,
      obligationId: input.obligationId,
      invariantResultId: input.invariantResultId,
      provider: input.provider,
      phase: input.phase,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      observedAt: new Date(),
      requestId: input.requestId,
      assertion: input.assertion,
      result: input.result,
      normalizedValue: JSON.stringify(redacted),
      payloadHash,
    },
  });

  return id;
}

export async function appendRunEvent(input: {
  runId: string;
  phase: string;
  provider?: string;
  message: string;
  data?: unknown;
}): Promise<void> {
  await prisma.runEvent.create({
    data: {
      runId: input.runId,
      phase: input.phase,
      provider: input.provider,
      message: input.message,
      data: input.data === undefined ? undefined : JSON.stringify(redactDeep(input.data)),
    },
  });
}

export async function appendLedgerEntry(input: {
  runId: string;
  operationType: string;
  provider: ProviderName;
  targetId: string;
  planHash: string;
  startedAt: Date;
  finishedAt?: Date;
  result?: "SUCCESS" | "FAILED" | "BLOCKED";
  providerRequestId?: string;
}): Promise<string> {
  const entry = await prisma.operationLedgerEntry.create({
    data: {
      runId: input.runId,
      operationType: input.operationType,
      provider: input.provider,
      targetId: input.targetId,
      planHash: input.planHash,
      startedAt: input.startedAt,
      finishedAt: input.finishedAt,
      result: input.result,
      providerRequestId: input.providerRequestId,
    },
  });
  return entry.id;
}
