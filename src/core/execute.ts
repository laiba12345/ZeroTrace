import { prisma } from "@/db/client";
import { newApprovalToken } from "@/lib/ids";
import { getProvider, PROVIDER_ORDER, OPERATION_TYPE_FOR_PROVIDER } from "@/providers";
import type { ProviderName, AccessTarget, PreservationSnapshot } from "@/providers/types";
import { recordEvidence, appendRunEvent, appendLedgerEntry } from "./evidence";
import { scopeLockCheck } from "./scope-lock";
import { verifyObligationPostcondition, verifyInvariants } from "./verify";
import { determineWorkflowStatus } from "./determine-status";
import type { ApprovedPlan, ObligationStatusValue } from "./domain";
import { ZeroTraceError } from "./errors";

export async function approveRun(runId: string, approverIdentity?: string): Promise<{ approvalToken: string }> {
  const run = await prisma.run.findUnique({ where: { id: runId } });
  if (!run) throw new ZeroTraceError("Run not found.", "RUN_NOT_FOUND");
  if (run.status !== "PREFLIGHT_READY") {
    throw new ZeroTraceError(`Run cannot be approved from status ${run.status}.`, "INVALID_STATE");
  }

  const approvalToken = newApprovalToken();
  await prisma.run.update({
    where: { id: runId },
    data: {
      status: "APPROVED",
      approvalToken,
      approvedAt: new Date(),
      approvedBy: approverIdentity ?? "operator",
    },
  });
  await appendRunEvent({
    runId,
    phase: "APPROVED",
    message: `Plan approved${approverIdentity ? ` by ${approverIdentity}` : ""}.`,
  });

  return { approvalToken };
}

export async function executeRun(runId: string, approvalToken: string): Promise<{ status: string }> {
  const run = await prisma.run.findUnique({ where: { id: runId }, include: { obligations: true } });
  if (!run) throw new ZeroTraceError("Run not found.", "RUN_NOT_FOUND");
  if (run.status !== "APPROVED") {
    throw new ZeroTraceError(`Run is not in an approved state (currently ${run.status}).`, "INVALID_STATE");
  }
  if (!run.approvalToken || run.approvalToken !== approvalToken) {
    throw new ZeroTraceError("Approval token is invalid or already consumed.", "INVALID_APPROVAL_TOKEN");
  }

  // Atomic status transition: only one caller can move APPROVED -> EXECUTING,
  // which both prevents concurrent execution and consumes the token (a
  // second call with the same token now finds status !== APPROVED above).
  const locked = await prisma.run.updateMany({
    where: { id: runId, status: "APPROVED" },
    data: { status: "EXECUTING", startedAt: new Date(), approvalToken: null },
  });
  if (locked.count !== 1) {
    throw new ZeroTraceError("Run was already executing or is no longer approved.", "CONCURRENT_EXECUTION");
  }

  await appendRunEvent({ runId, phase: "EXECUTING", message: "Execution started." });

  const plan = JSON.parse(run.approvedPlan ?? "{}") as ApprovedPlan;
  const beforeState = JSON.parse(run.beforeState ?? "{}") as {
    access: Record<ProviderName, { hasAccess: boolean; accessPaths: unknown[] }>;
    preservation: Record<ProviderName, PreservationSnapshot>;
  };
  const identity = JSON.parse(run.resolvedIdentity ?? "{}") as {
    canonicalEmail: string;
    github: { login: string };
    slack: { userId: string };
    drive: { permissionEmail: string };
  };
  const project = JSON.parse(run.resolvedProject ?? "{}") as {
    github: { owner: string; repo: string };
    slack: { channelId: string };
    drive: { folderId: string };
  };

  for (const providerName of PROVIDER_ORDER) {
    await executeProvider({ runId, providerName, plan, beforeState, identity, project });
  }

  await evaluateSystemInvariants(runId, plan);

  const obligations = await prisma.obligation.findMany({ where: { runId } });
  const invariants = await prisma.invariantResult.findMany({ where: { runId } });

  const finalStatus = determineWorkflowStatus(
    obligations.map((o) => ({
      id: o.id,
      provider: o.provider as ProviderName,
      subjectId: o.subjectId,
      resourceId: o.resourceId,
      requiredPostcondition: "NO_PROJECT_ACCESS",
      status: o.status as ObligationStatusValue,
      mutationAttempted: o.mutationAttempted,
      evidenceIds: [],
    })),
    invariants.map((i) => ({
      id: i.id,
      name: i.name as never,
      provider: i.provider as ProviderName,
      status: i.status as "PASS" | "FAIL" | "UNKNOWN",
      detail: i.detail ?? "",
      evidenceIds: [],
    }))
  );

  await prisma.run.update({
    where: { id: runId },
    data: { status: finalStatus, completedAt: new Date() },
  });
  await appendRunEvent({ runId, phase: "COMPLETE", message: `Final workflow status: ${finalStatus}.` });

  return { status: finalStatus };
}

async function executeProvider(params: {
  runId: string;
  providerName: ProviderName;
  plan: ApprovedPlan;
  beforeState: {
    access: Record<ProviderName, { hasAccess: boolean; accessPaths: unknown[] }>;
    preservation: Record<ProviderName, PreservationSnapshot>;
  };
  identity: { canonicalEmail: string; github: { login: string }; slack: { userId: string }; drive: { permissionEmail: string } };
  project: { github: { owner: string; repo: string }; slack: { channelId: string }; drive: { folderId: string } };
}) {
  const { runId, providerName, plan, beforeState, identity, project } = params;
  const provider = getProvider(providerName);

  const obligation = await prisma.obligation.findFirst({ where: { runId, provider: providerName } });
  if (!obligation) return;

  const target = accessTargetFor(providerName, identity, project);
  await appendRunEvent({ runId, phase: "PROVIDER_START", provider: providerName, message: `Starting ${providerName}.` });

  if (obligation.status === "NOT_NEEDED") {
    // Idempotent path: nothing to mutate, but still read again — absence
    // from a cached preflight is never proof of absence at execution time.
    const verification = await verifyObligationPostcondition(provider, target, runId, obligation.id, false);
    await prisma.obligation.update({ where: { id: obligation.id }, data: { status: verification.status } });
    await runInvariantsForProvider(runId, provider, beforeState.preservation[providerName], target);
    await appendRunEvent({ runId, phase: "PROVIDER_DONE", provider: providerName, message: `${providerName}: no mutation needed.` });
    return;
  }

  // READ (fresh, immediately pre-mutation) → SCOPE LOCK → REVOKE → READ BACK → VERIFY
  const freshAccess = await provider.readProjectAccess(target);
  await recordEvidence({
    runId,
    obligationId: obligation.id,
    provider: providerName,
    phase: "BEFORE",
    resourceType: "access",
    resourceId: target.resourceId,
    assertion: "Fresh access read immediately before mutation",
    result: "PASS",
    normalizedValue: freshAccess,
  });

  const freshMatchesPreflight = freshAccess.hasAccess === beforeState.access[providerName]?.hasAccess;

  const approvedTarget = plan.targets.find((t) => t.provider === providerName);
  if (!approvedTarget) {
    await failObligation(obligation.id, "PROVIDER", "No approved mutation target for this provider.");
    return;
  }

  const scopeCheck = scopeLockCheck({
    approvedPlan: plan,
    target: approvedTarget,
    currentPlanHash: plan.planHash,
    freshAccessMatchesPreflight: freshMatchesPreflight,
    isContentDeletion: false,
  });

  if (!scopeCheck.allowed) {
    await appendLedgerEntry({
      runId,
      operationType: OPERATION_TYPE_FOR_PROVIDER[providerName],
      provider: providerName,
      targetId: target.resourceId,
      planHash: plan.planHash,
      startedAt: new Date(),
      finishedAt: new Date(),
      result: "BLOCKED",
    });
    await prisma.obligation.update({
      where: { id: obligation.id },
      data: {
        status: "BLOCKED",
        errorCategory: "PROVIDER",
        errorSafeMessage: `Scope Lock refused: ${scopeCheck.reason} — ${scopeCheck.detail}`,
      },
    });
    await appendRunEvent({
      runId,
      phase: "SCOPE_LOCK_DENIED",
      provider: providerName,
      message: scopeCheck.detail,
    });
    return;
  }

  const startedAt = new Date();
  const mutation = await provider.revokeProjectAccess(target, {
    runId,
    planHash: plan.planHash,
    operationType: OPERATION_TYPE_FOR_PROVIDER[providerName],
  });

  await recordEvidence({
    runId,
    obligationId: obligation.id,
    provider: providerName,
    phase: "MUTATION",
    resourceType: "access",
    resourceId: target.resourceId,
    requestId: mutation.providerRequestId,
    assertion: "Mutation request result (not proof of final state)",
    result: mutation.succeeded ? "PASS" : "FAIL",
    normalizedValue: mutation,
  });

  await appendLedgerEntry({
    runId,
    operationType: OPERATION_TYPE_FOR_PROVIDER[providerName],
    provider: providerName,
    targetId: target.resourceId,
    planHash: plan.planHash,
    startedAt,
    finishedAt: new Date(),
    result: mutation.succeeded ? "SUCCESS" : "FAILED",
    providerRequestId: mutation.providerRequestId,
  });

  await prisma.obligation.update({ where: { id: obligation.id }, data: { mutationAttempted: mutation.attempted } });

  if (!mutation.succeeded) {
    await failObligation(
      obligation.id,
      mutation.error?.category ?? "PROVIDER",
      mutation.error?.safeMessage ?? "Mutation failed.",
      mutation.error?.providerCode
    );
    // Isolated failure: still verify preservation invariants for this
    // provider so we don't lose evidence from providers that succeeded.
    await runInvariantsForProvider(runId, provider, beforeState.preservation[providerName], target);
    await appendRunEvent({ runId, phase: "PROVIDER_DONE", provider: providerName, message: `${providerName}: mutation failed.` });
    return;
  }

  const verification = await verifyObligationPostcondition(provider, target, runId, obligation.id, mutation.attempted);
  await prisma.obligation.update({ where: { id: obligation.id }, data: { status: verification.status } });

  await runInvariantsForProvider(runId, provider, beforeState.preservation[providerName], target);
  await appendRunEvent({
    runId,
    phase: "PROVIDER_DONE",
    provider: providerName,
    message: `${providerName}: obligation ${verification.status}.`,
  });
}

async function runInvariantsForProvider(
  runId: string,
  provider: ReturnType<typeof getProvider>,
  before: PreservationSnapshot | undefined,
  target: AccessTarget
) {
  if (!before) return;
  const results = await verifyInvariants(provider, before, target, runId);
  for (const result of results) {
    await prisma.invariantResult.updateMany({
      where: { runId, provider: provider.name, name: result.name },
      data: { status: result.status, detail: result.detail },
    });
  }
}

async function failObligation(obligationId: string, category: string, safeMessage: string, providerCode?: string) {
  await prisma.obligation.update({
    where: { id: obligationId },
    data: { status: "FAILED", errorCategory: category, errorSafeMessage: safeMessage, errorProviderCode: providerCode },
  });
}

async function evaluateSystemInvariants(runId: string, plan: ApprovedPlan) {
  const ledger = await prisma.operationLedgerEntry.findMany({ where: { runId } });
  const approvedResourceIds = new Set(plan.targets.map((t) => t.resourceId));
  const allowlisted = new Set(Object.values(OPERATION_TYPE_FOR_PROVIDER));

  const touchedOnlyApproved = ledger.every((entry) => approvedResourceIds.has(entry.targetId));
  await prisma.invariantResult.updateMany({
    where: { runId, name: "ONLY_APPROVED_RESOURCES_TOUCHED" },
    data: {
      status: touchedOnlyApproved ? "PASS" : "FAIL",
      detail: touchedOnlyApproved
        ? `All ${ledger.length} ledger operation(s) targeted only approved resources.`
        : "A ledger operation targeted a resource outside the approved plan.",
    },
  });

  const noDeletionOps = ledger.every((entry) => allowlisted.has(entry.operationType));
  await prisma.invariantResult.updateMany({
    where: { runId, name: "NO_CONTENT_DELETE_OPERATIONS_SENT" },
    data: {
      status: noDeletionOps ? "PASS" : "FAIL",
      detail: noDeletionOps
        ? "No non-allowlisted (potential content-deletion) operation was sent."
        : "A non-allowlisted operation type was recorded in the ledger.",
    },
  });
}

function accessTargetFor(
  providerName: ProviderName,
  identity: { canonicalEmail: string; github: { login: string }; slack: { userId: string }; drive: { permissionEmail: string } },
  project: { github: { owner: string; repo: string }; slack: { channelId: string }; drive: { folderId: string } }
): AccessTarget {
  if (providerName === "github") {
    return {
      provider: "github",
      subjectProviderId: identity.github.login,
      subjectEmail: identity.canonicalEmail,
      resourceId: `${project.github.owner}/${project.github.repo}`,
    };
  }
  if (providerName === "slack") {
    return {
      provider: "slack",
      subjectProviderId: identity.slack.userId,
      subjectEmail: identity.canonicalEmail,
      resourceId: project.slack.channelId,
    };
  }
  return {
    provider: "drive",
    subjectProviderId: identity.drive.permissionEmail,
    subjectEmail: identity.canonicalEmail,
    resourceId: project.drive.folderId,
  };
}
