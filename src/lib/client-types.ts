export type ObligationView = {
  id: string;
  provider: "github" | "slack" | "drive";
  subjectId: string;
  resourceId: string;
  status: "PENDING" | "VERIFIED" | "FAILED" | "BLOCKED" | "UNKNOWN" | "NOT_NEEDED";
  mutationAttempted: boolean;
  errorSafeMessage?: string | null;
  errorCategory?: string | null;
};

export type InvariantResultView = {
  id: string;
  name: string;
  provider: string;
  status: "PASS" | "FAIL" | "UNKNOWN";
  detail: string | null;
};

export type RunEventView = {
  id: string;
  phase: string;
  provider: string | null;
  message: string;
  createdAt: string;
};

export type LedgerEntryView = {
  id: string;
  operationType: string;
  provider: string;
  targetId: string;
  result: string | null;
  providerRequestId: string | null;
};

export type ResolvedIdentityView = {
  canonicalEmail: string;
  displayName: string;
  github: { login: string; userId: number };
  slack: { userId: string; email: string };
  drive: { permissionEmail: string };
};

export type ResolvedProjectView = {
  canonicalName: string;
  github: { owner: string; repo: string; repoId: number };
  slack: { channelId: string; channelName: string };
  drive: { folderId: string; folderName: string };
};

export type ApprovedPlanView = {
  targets: { provider: string; operationType: string; resourceId: string }[];
  mutationCount: number;
  deletionCount: number;
  planHash: string;
};

export type AccessSnapshotView = {
  provider: string;
  hasAccess: boolean;
  accessPaths: { kind: string; description: string; permissionLevel?: string; removable: boolean }[];
};

export type OtherMemberView = { providerId: string; displayName?: string; permissionLevel?: string };

export type PreservationSnapshotView = {
  provider: string;
  otherMembers: OtherMemberView[];
  authoredItems: { kind: string; id: string }[];
};

export type RunDetail = {
  id: string;
  rawInstruction: string;
  status: string;
  compiledIntent: unknown;
  resolvedIdentity: ResolvedIdentityView | null;
  resolvedProject: ResolvedProjectView | null;
  beforeState: {
    access: Record<string, AccessSnapshotView>;
    preservation: Record<string, PreservationSnapshotView>;
  } | null;
  approvedPlan: ApprovedPlanView | null;
  planHash: string | null;
  blockers: string[];
  approvedAt: string | null;
  approvedBy: string | null;
  startedAt: string | null;
  completedAt: string | null;
  obligations: ObligationView[];
  invariantResults: InvariantResultView[];
  operationLedger: LedgerEntryView[];
  events: RunEventView[];
};
