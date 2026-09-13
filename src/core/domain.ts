import { z } from "zod";

// ---------------------------------------------------------------------------
// Compiled intent — the ONLY output an LLM is allowed to produce. It never
// contains a provider call, a URL, or an action beyond the fixed enum below.
// ---------------------------------------------------------------------------

export const CompiledIntentSchema = z.object({
  subject: z.object({
    displayName: z.string().min(1),
    email: z.string().email().nullable(),
    aliases: z.array(z.string()),
  }),
  project: z.object({
    name: z.string().min(1),
    slug: z.string().nullable(),
  }),
  requestedAction: z.literal("REVOKE_PROJECT_ACCESS"),
  preserveAuthoredContent: z.literal(true),
  preserveUnrelatedAccess: z.literal(true),
  confidence: z.number().min(0).max(1),
  ambiguities: z.array(z.string()),
});
export type CompiledIntent = z.infer<typeof CompiledIntentSchema>;

// ---------------------------------------------------------------------------
// Resolved identity / project — exact, provider-specific identifiers only.
// Never populated from fuzzy display-name matches.
// ---------------------------------------------------------------------------

export const ResolvedIdentitySchema = z.object({
  canonicalEmail: z.string().email(),
  displayName: z.string(),
  github: z.object({ login: z.string(), userId: z.number() }),
  slack: z.object({ userId: z.string(), email: z.string().email() }),
  drive: z.object({ permissionEmail: z.string().email() }),
});
export type ResolvedIdentity = z.infer<typeof ResolvedIdentitySchema>;

export const ResolvedProjectSchema = z.object({
  canonicalName: z.string(),
  github: z.object({ owner: z.string(), repo: z.string(), repoId: z.number() }),
  slack: z.object({ channelId: z.string(), channelName: z.string() }),
  drive: z.object({ folderId: z.string(), folderName: z.string() }),
});
export type ResolvedProject = z.infer<typeof ResolvedProjectSchema>;

// ---------------------------------------------------------------------------
// Obligations / invariants — the units the status engine evaluates.
// ---------------------------------------------------------------------------

export const ObligationStatusValues = [
  "PENDING",
  "VERIFIED",
  "FAILED",
  "BLOCKED",
  "UNKNOWN",
  "NOT_NEEDED",
] as const;
export type ObligationStatusValue = (typeof ObligationStatusValues)[number];

export const ObligationSchema = z.object({
  id: z.string(),
  provider: z.enum(["github", "slack", "drive"]),
  subjectId: z.string(),
  resourceId: z.string(),
  requiredPostcondition: z.literal("NO_PROJECT_ACCESS"),
  status: z.enum(ObligationStatusValues),
  mutationAttempted: z.boolean(),
  error: z
    .object({
      category: z.enum(["AUTH", "SCOPE", "RATE_LIMIT", "NETWORK", "NOT_FOUND", "CONFLICT", "PROVIDER"]),
      providerCode: z.string().optional(),
      safeMessage: z.string(),
    })
    .optional(),
  evidenceIds: z.array(z.string()),
});
export type Obligation = z.infer<typeof ObligationSchema>;

export const InvariantNames = [
  "AUTHORED_HISTORY_PRESERVED",
  "UNRELATED_PROJECT_ACCESS_PRESERVED",
  "OTHER_USERS_UNCHANGED",
  "ONLY_APPROVED_RESOURCES_TOUCHED",
  "NO_CONTENT_DELETE_OPERATIONS_SENT",
] as const;
export type InvariantName = (typeof InvariantNames)[number];

export const InvariantResultSchema = z.object({
  id: z.string(),
  name: z.enum(InvariantNames),
  provider: z.enum(["github", "slack", "drive"]),
  status: z.enum(["PASS", "FAIL", "UNKNOWN"]),
  detail: z.string(),
  evidenceIds: z.array(z.string()),
});
export type InvariantResult = z.infer<typeof InvariantResultSchema>;

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

export const EvidenceRecordSchema = z.object({
  id: z.string(),
  runId: z.string(),
  provider: z.enum(["github", "slack", "drive", "system"]),
  phase: z.enum(["BEFORE", "MUTATION", "AFTER", "INVARIANT"]),
  resourceType: z.string(),
  resourceId: z.string(),
  observedAt: z.string(),
  requestId: z.string().optional(),
  assertion: z.string(),
  result: z.enum(["PASS", "FAIL", "UNKNOWN"]),
  normalizedValue: z.unknown(),
  payloadHash: z.string(),
});
export type EvidenceRecord = z.infer<typeof EvidenceRecordSchema>;

// ---------------------------------------------------------------------------
// Workflow status — priority-ordered, deterministic.
// ---------------------------------------------------------------------------

export const WorkflowStatusValues = [
  "SAFETY_VIOLATION",
  "BLOCKED",
  "INCOMPLETE",
  "UNVERIFIED",
  "COMPLETE",
] as const;
export type WorkflowStatus = (typeof WorkflowStatusValues)[number];

// ---------------------------------------------------------------------------
// Approved plan — immutable once approval is recorded.
// ---------------------------------------------------------------------------

export const ApprovedPlanTargetSchema = z.object({
  provider: z.enum(["github", "slack", "drive"]),
  operationType: z.enum([
    "GITHUB_REVOKE_REPO_OR_PROJECT_TEAM_ACCESS",
    "SLACK_REMOVE_CHANNEL_MEMBER",
    "DRIVE_DELETE_PROJECT_PERMISSION",
  ]),
  subjectId: z.string(),
  subjectEmail: z.string(),
  resourceId: z.string(),
});
export type ApprovedPlanTarget = z.infer<typeof ApprovedPlanTargetSchema>;

export const ApprovedPlanSchema = z.object({
  runId: z.string(),
  subject: z.object({ email: z.string(), displayName: z.string() }),
  project: z.object({ name: z.string() }),
  targets: z.array(ApprovedPlanTargetSchema),
  mutationCount: z.number(),
  deletionCount: z.literal(0),
  planHash: z.string(),
});
export type ApprovedPlan = z.infer<typeof ApprovedPlanSchema>;
