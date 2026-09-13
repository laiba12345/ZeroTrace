import type { Obligation, InvariantResult, WorkflowStatus } from "./domain";

// Pure, deterministic. No LLM call belongs anywhere near this function.
// Priority order (highest wins), per ZEROTRACE_AI_BUILD_INSTRUCTIONS.md section 2:
//   1. SAFETY_VIOLATION  — any invariant failed
//   2. BLOCKED           — any obligation blocked, or run was blocked pre-execution
//   3. INCOMPLETE        — any obligation failed
//   4. UNVERIFIED        — any obligation unknown
//   5. COMPLETE          — every obligation VERIFIED/NOT_NEEDED and every invariant PASS

export function determineWorkflowStatus(
  obligations: Obligation[],
  invariants: InvariantResult[],
  options: { preExecutionBlock?: boolean } = {}
): WorkflowStatus {
  if (invariants.some((inv) => inv.status === "FAIL")) {
    return "SAFETY_VIOLATION";
  }

  if (options.preExecutionBlock) {
    return "BLOCKED";
  }

  if (obligations.some((o) => o.status === "BLOCKED")) {
    return "BLOCKED";
  }

  if (obligations.some((o) => o.status === "FAILED")) {
    return "INCOMPLETE";
  }

  if (obligations.some((o) => o.status === "UNKNOWN" || o.status === "PENDING")) {
    return "UNVERIFIED";
  }

  const allObligationsSatisfied = obligations.every(
    (o) => o.status === "VERIFIED" || o.status === "NOT_NEEDED"
  );
  const allInvariantsVerified = invariants.every((inv) => inv.status === "PASS");

  if (obligations.length > 0 && allObligationsSatisfied && allInvariantsVerified) {
    return "COMPLETE";
  }

  // Invariants haven't all been read yet (still UNKNOWN pending evidence) —
  // never default to COMPLETE from an incomplete evidence set.
  return "UNVERIFIED";
}
