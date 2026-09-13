import { prisma } from "@/db/client";
import { compileIntent } from "./compile-intent";
import { computePlanHash } from "./scope-lock";
import { recordEvidence, appendRunEvent } from "./evidence";
import { newRunId } from "@/lib/ids";
import { deriveIdempotencyKey } from "@/lib/ids";
import { getProvider, PROVIDER_ORDER, OPERATION_TYPE_FOR_PROVIDER } from "@/providers";
import type { ProviderName, AccessSnapshot, PreservationSnapshot } from "@/providers/types";
import { classifyProviderError } from "./errors";
import { withRetry } from "@/lib/with-retry";
import type { ApprovedPlan, ApprovedPlanTarget, CompiledIntent, ResolvedIdentity, ResolvedProject } from "./domain";
import { InvariantNames } from "./domain";

export type PreflightResult = {
  runId: string;
  status: "BLOCKED" | "PREFLIGHT_READY";
  blockers: string[];
  ambiguities: string[];
};

export async function runPreflight(
  rawInstruction: string,
  precompiledIntent?: CompiledIntent
): Promise<PreflightResult> {
  const runId = newRunId();
  const blockers: string[] = [];

  await prisma.run.create({
    data: {
      id: runId,
      idempotencyKey: `pending_${runId}`,
      rawInstruction,
      compiledIntent: "{}",
      status: "DRAFT",
    },
  });

  let intent: CompiledIntent;
  if (precompiledIntent) {
    // Already compiled by the conversational intake flow
    // (core/compile-intent.ts#compileIntentChatTurn) — never trusted
    // blindly just because it arrived pre-compiled: identity/project still
    // get resolved against real providers exactly as below, and an empty
    // email is still impossible to reach here (compileIntentChatTurn never
    // emits COMPILED with a null email).
    intent = precompiledIntent;
  } else {
    await appendRunEvent({ runId, phase: "COMPILE_INTENT", message: "Compiling operator instruction." });
    const intentResult = await compileIntent(rawInstruction);
    if (!intentResult.ok) {
      const label = intentResult.reason === "LLM_UNAVAILABLE" ? "BLOCKED: INTENT_COMPILER_UNAVAILABLE" : intentResult.reason;
      if (intentResult.understoodIntent) {
        await prisma.run.update({
          where: { id: runId },
          data: { compiledIntent: JSON.stringify(intentResult.understoodIntent) },
        });
      }
      return await block(runId, [`${label}: ${intentResult.detail}`]);
    }
    intent = intentResult.intent;
  }

  await prisma.run.update({
    where: { id: runId },
    data: { compiledIntent: JSON.stringify(intent) },
  });
  await appendRunEvent({
    runId,
    phase: "COMPILE_INTENT",
    message: precompiledIntent ? "Intent compiled via conversational intake." : "Intent compiled via llm.",
    data: intent,
  });

  if (intent.ambiguities.length > 0) {
    return await block(runId, intent.ambiguities);
  }
  if (!intent.subject.email) {
    return await block(runId, ["Subject email could not be determined; operator must supply an exact email."]);
  }

  await appendRunEvent({ runId, phase: "RESOLVE_IDENTITY", message: "Resolving subject and project across providers." });

  const resolution = await resolveAcrossProviders(intent.subject.email, intent.subject.displayName, intent.project.name, intent.project.slug);
  if (!resolution.ok) {
    return await block(runId, resolution.blockers);
  }

  const { identity, project } = resolution;

  await prisma.run.update({
    where: { id: runId },
    data: {
      resolvedIdentity: JSON.stringify(identity),
      resolvedProject: JSON.stringify(project),
      idempotencyKey: deriveIdempotencyKey({
        subjectEmail: identity.canonicalEmail,
        projectSlug: project.canonicalName,
        actionType: "REVOKE_PROJECT_ACCESS",
        approvedResourceIds: [
          `github:${project.github.owner}/${project.github.repo}`,
          `slack:${project.slack.channelId}`,
          `drive:${project.drive.folderId}`,
        ],
      }),
    },
  });

  await appendRunEvent({ runId, phase: "PREFLIGHT_READ", message: "Reading current access state from all providers." });

  const accessByProvider: Record<ProviderName, AccessSnapshot> = {} as never;
  const preservationByProvider: Record<ProviderName, PreservationSnapshot> = {} as never;
  const targets: ApprovedPlanTarget[] = [];

  for (const providerName of PROVIDER_ORDER) {
    const provider = getProvider(providerName);
    const target = accessTargetFor(providerName, identity, project);

    let access: AccessSnapshot;
    let preservation: PreservationSnapshot;
    try {
      access = await withRetry(() => provider.readProjectAccess(target));
      preservation = await withRetry(() => provider.capturePreservationSnapshot(target));
    } catch (err) {
      blockers.push(`${providerName}: ${classifyProviderError(err).safeMessage}`);
      continue;
    }

    accessByProvider[providerName] = access;
    await recordEvidence({
      runId,
      provider: providerName,
      phase: "BEFORE",
      resourceType: "access",
      resourceId: target.resourceId,
      assertion: "Current project access for subject",
      result: "PASS",
      normalizedValue: access,
    });

    preservationByProvider[providerName] = preservation;
    await recordEvidence({
      runId,
      provider: providerName,
      phase: "BEFORE",
      resourceType: "preservation_snapshot",
      resourceId: target.resourceId,
      assertion: "Baseline authored content and unrelated access",
      result: "PASS",
      normalizedValue: preservation,
    });

    const removableAccess = access.accessPaths.filter((p) => p.removable);
    const unremovableInherited = access.accessPaths.filter((p) => !p.removable);

    if (unremovableInherited.length > 0 && removableAccess.length === 0 && access.hasAccess) {
      blockers.push(
        `${providerName}: access is only inherited (${unremovableInherited
          .map((p) => p.description)
          .join("; ")}) and cannot be safely removed narrowly.`
      );
    }

    if (removableAccess.length > 0) {
      targets.push({
        provider: providerName,
        operationType: OPERATION_TYPE_FOR_PROVIDER[providerName] as ApprovedPlanTarget["operationType"],
        subjectId: target.subjectProviderId,
        subjectEmail: identity.canonicalEmail,
        resourceId: target.resourceId,
      });
    }

    await prisma.obligation.create({
      data: {
        runId,
        provider: providerName,
        subjectId: target.subjectProviderId,
        resourceId: target.resourceId,
        requiredPostcondition: "NO_PROJECT_ACCESS",
        status: access.hasAccess ? "PENDING" : "NOT_NEEDED",
        mutationAttempted: false,
      },
    });
  }

  for (const name of InvariantNames) {
    for (const providerName of PROVIDER_ORDER) {
      if (name === "ONLY_APPROVED_RESOURCES_TOUCHED" || name === "NO_CONTENT_DELETE_OPERATIONS_SENT") continue;
      await prisma.invariantResult.create({
        data: { runId, name, provider: providerName, status: "UNKNOWN", detail: "Not yet evaluated." },
      });
    }
  }
  await prisma.invariantResult.create({
    data: { runId, name: "ONLY_APPROVED_RESOURCES_TOUCHED", provider: "system", status: "UNKNOWN", detail: "Not yet evaluated." },
  });
  await prisma.invariantResult.create({
    data: { runId, name: "NO_CONTENT_DELETE_OPERATIONS_SENT", provider: "system", status: "UNKNOWN", detail: "Not yet evaluated." },
  });

  if (blockers.length > 0) {
    return await block(runId, blockers);
  }

  const planWithoutHash: Omit<ApprovedPlan, "planHash"> = {
    runId,
    subject: { email: identity.canonicalEmail, displayName: identity.displayName },
    project: { name: project.canonicalName },
    targets,
    mutationCount: targets.length,
    deletionCount: 0,
  };
  const planHash = computePlanHash(planWithoutHash);
  const plan: ApprovedPlan = { ...planWithoutHash, planHash };

  await prisma.run.update({
    where: { id: runId },
    data: {
      beforeState: JSON.stringify({ access: accessByProvider, preservation: preservationByProvider }),
      approvedPlan: JSON.stringify(plan),
      planHash,
      status: "PREFLIGHT_READY",
    },
  });

  await appendRunEvent({
    runId,
    phase: "PREFLIGHT_READY",
    message: `Preflight complete: ${targets.length} revocation(s) planned, 0 deletions.`,
    data: plan,
  });

  return { runId, status: "PREFLIGHT_READY", blockers: [], ambiguities: [] };
}

async function block(runId: string, blockers: string[]): Promise<PreflightResult> {
  await prisma.run.update({
    where: { id: runId },
    data: { status: "BLOCKED", blockers: JSON.stringify(blockers) },
  });
  await appendRunEvent({ runId, phase: "BLOCKED", message: blockers.join(" | ") });
  return { runId, status: "BLOCKED", blockers, ambiguities: [] };
}

type ResolveResult =
  | { ok: true; identity: ResolvedIdentity; project: ResolvedProject }
  | { ok: false; blockers: string[] };

async function resolveAcrossProviders(
  email: string,
  displayName: string,
  projectName: string,
  projectSlug: string | null
): Promise<ResolveResult> {
  const blockers: string[] = [];
  const normalizedEmail = email.trim().toLowerCase();

  const [githubCandidates, slackCandidates, driveCandidates] = await Promise.all([
    settledCandidates("github", () => getProvider("github").resolveSubject({ email: normalizedEmail, displayName }), blockers),
    settledCandidates("slack", () => getProvider("slack").resolveSubject({ email: normalizedEmail, displayName }), blockers),
    settledCandidates("drive", () => getProvider("drive").resolveSubject({ email: normalizedEmail, displayName }), blockers),
  ]);

  for (const [name, candidates] of [
    ["github", githubCandidates],
    ["slack", slackCandidates],
    ["drive", driveCandidates],
  ] as const) {
    if (candidates.length === 0) blockers.push(`${name}: no account found for ${normalizedEmail}.`);
    if (candidates.length > 1) blockers.push(`${name}: multiple accounts matched ${normalizedEmail}; operator must select one.`);
  }

  const [githubProjects, slackProjects, driveProjects] = await Promise.all([
    settledCandidates("github", () => getProvider("github").resolveProject({ name: projectName, slug: projectSlug }), blockers),
    settledCandidates("slack", () => getProvider("slack").resolveProject({ name: projectName, slug: projectSlug }), blockers),
    settledCandidates("drive", () => getProvider("drive").resolveProject({ name: projectName, slug: projectSlug }), blockers),
  ]);

  for (const [name, candidates] of [
    ["github", githubProjects],
    ["slack", slackProjects],
    ["drive", driveProjects],
  ] as const) {
    if (candidates.length === 0) blockers.push(`${name}: no project resource found matching "${projectName}".`);
    if (candidates.length > 1)
      blockers.push(
        `${name}: multiple project resources matched "${projectName}" (${candidates
          .map((c) => c.name)
          .join(", ")}); operator must select one.`
      );
  }

  if (blockers.length > 0) return { ok: false, blockers };

  const githubCandidate = githubCandidates[0];
  const slackCandidate = slackCandidates[0];
  const githubProject = githubProjects[0];
  const slackProject = slackProjects[0];
  const driveProject = driveProjects[0];

  const [githubOwner, githubRepo] = githubCandidate ? githubProject.providerId.split("/") : ["", ""];

  const identity: ResolvedIdentity = {
    canonicalEmail: normalizedEmail,
    displayName,
    github: { login: githubCandidate.providerId, userId: (githubCandidate.raw as { id: number })?.id ?? 0 },
    slack: { userId: slackCandidate.providerId, email: normalizedEmail },
    drive: { permissionEmail: normalizedEmail },
  };

  const project: ResolvedProject = {
    canonicalName: projectName,
    github: {
      owner: githubOwner,
      repo: githubRepo,
      repoId: (githubProject.raw as { id: number })?.id ?? 0,
    },
    slack: { channelId: slackProject.providerId, channelName: slackProject.name },
    drive: { folderId: driveProject.providerId, folderName: driveProject.name },
  };

  return { ok: true, identity, project };
}

// Wraps a provider resolveSubject/resolveProject call so a connectivity/auth
// failure (e.g. missing credentials) becomes a readable blocker instead of
// an unhandled rejection — preflight always resolves to BLOCKED or
// PREFLIGHT_READY, never a raw 500.
async function settledCandidates<T>(
  providerName: string,
  call: () => Promise<T[]>,
  blockers: string[]
): Promise<T[]> {
  try {
    return await withRetry(call);
  } catch (err) {
    const providerError = classifyProviderError(err);
    blockers.push(`${providerName}: ${providerError.safeMessage}`);
    return [];
  }
}

function accessTargetFor(providerName: ProviderName, identity: ResolvedIdentity, project: ResolvedProject) {
  if (providerName === "github") {
    return {
      provider: "github" as const,
      subjectProviderId: identity.github.login,
      subjectEmail: identity.canonicalEmail,
      resourceId: `${project.github.owner}/${project.github.repo}`,
    };
  }
  if (providerName === "slack") {
    return {
      provider: "slack" as const,
      subjectProviderId: identity.slack.userId,
      subjectEmail: identity.canonicalEmail,
      resourceId: project.slack.channelId,
    };
  }
  return {
    provider: "drive" as const,
    subjectProviderId: identity.drive.permissionEmail,
    subjectEmail: identity.canonicalEmail,
    resourceId: project.drive.folderId,
  };
}
