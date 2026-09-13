// Shared provider adapter contract. Every provider (github/slack/drive) implements this
// so core orchestration code never branches on provider-specific shapes.

export type ProviderName = "github" | "slack" | "drive";

export type ConnectionHealth = {
  provider: ProviderName;
  status: "connected" | "degraded" | "disconnected";
  detail?: string;
  checkedAt: string;
};

export type SubjectLookup = {
  email: string;
  displayName: string;
};

export type SubjectCandidate = {
  provider: ProviderName;
  providerId: string;
  displayName: string;
  email: string;
  raw?: unknown;
};

export type ProjectLookup = {
  name: string;
  slug: string | null;
};

export type ProjectCandidate = {
  provider: ProviderName;
  providerId: string;
  name: string;
  raw?: unknown;
};

export type AccessTarget = {
  provider: ProviderName;
  subjectProviderId: string;
  subjectEmail: string;
  resourceId: string;
};

export type AccessSnapshot = {
  provider: ProviderName;
  resourceId: string;
  subjectProviderId: string;
  hasAccess: boolean;
  accessPaths: AccessPath[];
  observedAt: string;
  requestId?: string;
};

export type AccessPath = {
  kind: "DIRECT" | "INHERITED";
  description: string;
  permissionLevel?: string;
  sourceId?: string;
  removable: boolean;
};

export type PreservationSnapshot = {
  provider: ProviderName;
  resourceId: string;
  subjectProviderId: string;
  authoredItems: AuthoredItemRef[];
  unrelatedAccess: UnrelatedAccessRef[];
  otherMembers: OtherMemberRef[];
  observedAt: string;
};

export type AuthoredItemRef = {
  kind: string; // commit | issue | pull_request | message | file
  id: string;
  checksum?: string;
  metadata?: Record<string, unknown>;
};

export type UnrelatedAccessRef = {
  resourceId: string;
  resourceName: string;
  permissionLevel?: string;
};

export type OtherMemberRef = {
  providerId: string;
  displayName?: string;
  permissionLevel?: string;
};

export type MutationContext = {
  runId: string;
  planHash: string;
  operationType: string;
};

export type MutationResult = {
  provider: ProviderName;
  resourceId: string;
  subjectProviderId: string;
  attempted: boolean;
  succeeded: boolean;
  providerRequestId?: string;
  error?: ProviderError;
  observedAt: string;
};

export type VerificationResult = {
  provider: ProviderName;
  resourceId: string;
  subjectProviderId: string;
  postconditionMet: boolean | "UNKNOWN";
  observedAt: string;
  requestId?: string;
  raw?: unknown;
};

export type InvariantResultPayload = {
  name:
    | "AUTHORED_HISTORY_PRESERVED"
    | "UNRELATED_PROJECT_ACCESS_PRESERVED"
    | "OTHER_USERS_UNCHANGED"
    | "ONLY_APPROVED_RESOURCES_TOUCHED"
    | "NO_CONTENT_DELETE_OPERATIONS_SENT";
  provider: ProviderName;
  status: "PASS" | "FAIL" | "UNKNOWN";
  detail: string;
  evidence: unknown;
};

export type ProviderErrorCategory =
  | "AUTH"
  | "SCOPE"
  | "RATE_LIMIT"
  | "NETWORK"
  | "NOT_FOUND"
  | "CONFLICT"
  | "PROVIDER";

export type ProviderError = {
  category: ProviderErrorCategory;
  providerCode?: string;
  safeMessage: string;
};

export interface AccessProvider {
  readonly name: ProviderName;
  checkConnection(): Promise<ConnectionHealth>;
  resolveSubject(input: SubjectLookup): Promise<SubjectCandidate[]>;
  resolveProject(input: ProjectLookup): Promise<ProjectCandidate[]>;
  readProjectAccess(target: AccessTarget): Promise<AccessSnapshot>;
  capturePreservationSnapshot(target: AccessTarget): Promise<PreservationSnapshot>;
  revokeProjectAccess(target: AccessTarget, context: MutationContext): Promise<MutationResult>;
  verifyNoProjectAccess(target: AccessTarget): Promise<VerificationResult>;
  verifyPreservation(
    before: PreservationSnapshot,
    target: AccessTarget
  ): Promise<InvariantResultPayload[]>;
}

export class ProviderCallError extends Error {
  readonly category: ProviderErrorCategory;
  readonly providerCode?: string;
  readonly safeMessage: string;

  constructor(error: ProviderError) {
    super(error.safeMessage);
    this.name = "ProviderCallError";
    this.category = error.category;
    this.providerCode = error.providerCode;
    this.safeMessage = error.safeMessage;
  }

  toProviderError(): ProviderError {
    return {
      category: this.category,
      providerCode: this.providerCode,
      safeMessage: this.safeMessage,
    };
  }
}
