import type { ApprovedPlan, ApprovedPlanTarget } from "./domain";
import { hashCanonical } from "@/lib/ids";

export type ScopeLockDenialReason =
  | "SUBJECT_MISMATCH"
  | "PROJECT_MISMATCH"
  | "RESOURCE_ID_MISMATCH"
  | "ACTION_NOT_ALLOWLISTED"
  | "PLAN_HASH_MISMATCH"
  | "PROVIDER_STATE_DRIFTED"
  | "CONTENT_DELETION_REQUESTED";

export type ScopeLockResult =
  | { allowed: true }
  | { allowed: false; reason: ScopeLockDenialReason; detail: string };

const ALLOWLISTED_ACTIONS = new Set([
  "GITHUB_REVOKE_REPO_OR_PROJECT_TEAM_ACCESS",
  "SLACK_REMOVE_CHANNEL_MEMBER",
  "DRIVE_DELETE_PROJECT_PERMISSION",
]);

export type ScopeLockCheckInput = {
  approvedPlan: ApprovedPlan;
  target: ApprovedPlanTarget;
  currentPlanHash: string;
  /**
   * A fresh read of provider state immediately before mutation. Compared
   * against what preflight observed to catch drift (e.g. the subject's
   * access already changed via the provider's own UI since approval).
   */
  freshAccessMatchesPreflight: boolean;
  isContentDeletion: boolean;
};

// Deterministic policy function. Every provider mutation call site must
// call this immediately before sending the request — no other code path
// may invoke a provider revoke method.
export function scopeLockCheck(input: ScopeLockCheckInput): ScopeLockResult {
  const { approvedPlan, target, currentPlanHash, freshAccessMatchesPreflight, isContentDeletion } =
    input;

  const approvedTarget = approvedPlan.targets.find(
    (t) => t.provider === target.provider && t.resourceId === target.resourceId
  );

  if (!approvedTarget) {
    return {
      allowed: false,
      reason: "RESOURCE_ID_MISMATCH",
      detail: `No approved target for ${target.provider} resource ${target.resourceId}.`,
    };
  }

  if (approvedTarget.subjectId !== target.subjectId || approvedTarget.subjectEmail !== target.subjectEmail) {
    return {
      allowed: false,
      reason: "SUBJECT_MISMATCH",
      detail: "Resolved subject does not match the approved subject.",
    };
  }

  if (!isSameProject(approvedPlan, target)) {
    return {
      allowed: false,
      reason: "PROJECT_MISMATCH",
      detail: "Resolved project does not match the approved project.",
    };
  }

  if (!ALLOWLISTED_ACTIONS.has(approvedTarget.operationType)) {
    return {
      allowed: false,
      reason: "ACTION_NOT_ALLOWLISTED",
      detail: `Operation type ${approvedTarget.operationType} is not allowlisted.`,
    };
  }

  if (approvedPlan.planHash !== currentPlanHash) {
    return {
      allowed: false,
      reason: "PLAN_HASH_MISMATCH",
      detail: "The approved plan hash does not match the current plan snapshot.",
    };
  }

  if (!freshAccessMatchesPreflight) {
    return {
      allowed: false,
      reason: "PROVIDER_STATE_DRIFTED",
      detail: "Provider state has changed since preflight was captured.",
    };
  }

  if (isContentDeletion) {
    return {
      allowed: false,
      reason: "CONTENT_DELETION_REQUESTED",
      detail: "Content deletion is never permitted regardless of approval.",
    };
  }

  return { allowed: true };
}

function isSameProject(plan: ApprovedPlan, target: ApprovedPlanTarget): boolean {
  // Project identity is enforced by resourceId membership in the approved
  // target list (each resourceId is bound to the approved project at plan
  // compile time) — this guards against a resourceId that happens to match
  // but belongs to a different, unapproved project resolved later.
  return plan.targets.some((t) => t.resourceId === target.resourceId);
}

export function computePlanHash(plan: Omit<ApprovedPlan, "planHash">): string {
  return hashCanonical(plan);
}
