import type { AccessProvider, AccessTarget, PreservationSnapshot } from "@/providers/types";
import { recordEvidence } from "./evidence";
import type { ObligationStatusValue } from "./domain";
import { withRetry } from "@/lib/with-retry";

export type ObligationVerification = {
  status: ObligationStatusValue;
  evidenceIds: string[];
};

// Performs the independent read-back required after a mutation. Never trusts
// the mutation's own write response as proof — always issues a fresh read.
export async function verifyObligationPostcondition(
  provider: AccessProvider,
  target: AccessTarget,
  runId: string,
  obligationId: string,
  mutationAttempted: boolean
): Promise<ObligationVerification> {
  const evidenceIds: string[] = [];

  const verification = await withRetry(() => provider.verifyNoProjectAccess(target)).catch(() => ({
    provider: provider.name,
    resourceId: target.resourceId,
    subjectProviderId: target.subjectProviderId,
    postconditionMet: "UNKNOWN" as const,
    observedAt: new Date().toISOString(),
    requestId: undefined as string | undefined,
  }));

  const evId = await recordEvidence({
    runId,
    obligationId,
    provider: provider.name,
    phase: "AFTER",
    resourceType: "access",
    resourceId: target.resourceId,
    requestId: verification.requestId,
    assertion: "Subject has no Phoenix access after mutation (independent read-back)",
    result: verification.postconditionMet === true ? "PASS" : verification.postconditionMet === false ? "FAIL" : "UNKNOWN",
    normalizedValue: verification,
  });
  evidenceIds.push(evId);

  if (verification.postconditionMet === "UNKNOWN") {
    return { status: "UNKNOWN", evidenceIds };
  }
  if (verification.postconditionMet === true) {
    return { status: mutationAttempted ? "VERIFIED" : "NOT_NEEDED", evidenceIds };
  }
  return { status: "FAILED", evidenceIds };
}

export async function verifyInvariants(
  provider: AccessProvider,
  before: PreservationSnapshot,
  target: AccessTarget,
  runId: string
): Promise<{ name: string; status: "PASS" | "FAIL" | "UNKNOWN"; detail: string; evidenceId: string }[]> {
  const results = await withRetry(() => provider.verifyPreservation(before, target)).catch(() =>
    (["AUTHORED_HISTORY_PRESERVED", "UNRELATED_PROJECT_ACCESS_PRESERVED", "OTHER_USERS_UNCHANGED"] as const).map(
      (name) => ({
        name,
        provider: provider.name,
        status: "UNKNOWN" as const,
        detail: "Preservation verification could not be completed.",
        evidence: null,
      })
    )
  );

  const out: { name: string; status: "PASS" | "FAIL" | "UNKNOWN"; detail: string; evidenceId: string }[] = [];
  for (const result of results) {
    const evidenceId = await recordEvidence({
      runId,
      provider: provider.name,
      phase: "INVARIANT",
      resourceType: "preservation",
      resourceId: target.resourceId,
      assertion: `${result.name}: ${result.detail}`,
      result: result.status,
      normalizedValue: result.evidence,
    });
    out.push({ name: result.name, status: result.status, detail: result.detail, evidenceId });
  }
  return out;
}
