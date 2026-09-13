import { google, drive_v3 } from "googleapis";
import { getEnv } from "@/lib/env";
import { classifyProviderError } from "@/core/errors";
import type {
  AccessProvider,
  AccessPath,
  AccessSnapshot,
  AccessTarget,
  AuthoredItemRef,
  ConnectionHealth,
  InvariantResultPayload,
  MutationResult,
  OtherMemberRef,
  PreservationSnapshot,
  ProjectCandidate,
  ProjectLookup,
  SubjectCandidate,
  SubjectLookup,
  UnrelatedAccessRef,
  VerificationResult,
} from "./types";
import { ProviderCallError } from "./types";

// resourceId convention: Drive folder ID. subjectProviderId: the subject's
// email address — Drive permissions are keyed by email, not a numeric ID.

const MAX_MANIFEST_FILES = 500;

function client(): drive_v3.Drive {
  const env = getEnv();
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_REFRESH_TOKEN) {
    throw new ProviderCallError({
      category: "AUTH",
      safeMessage: "Google Drive is not configured (client ID/secret/refresh token missing).",
    });
  }
  const auth = new google.auth.OAuth2(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET);
  auth.setCredentials({ refresh_token: env.GOOGLE_REFRESH_TOKEN });
  return google.drive({ version: "v3", auth });
}

export const driveProvider: AccessProvider = {
  name: "drive",

  async checkConnection(): Promise<ConnectionHealth> {
    try {
      const env = getEnv();
      if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_REFRESH_TOKEN) {
        return { provider: "drive", status: "disconnected", detail: "Google OAuth credentials not set", checkedAt: nowIso() };
      }
      const drive = client();
      const res = await drive.about.get({ fields: "user(emailAddress)" });
      return {
        provider: "drive",
        status: "connected",
        detail: `Authenticated as ${res.data.user?.emailAddress ?? "unknown"}`,
        checkedAt: nowIso(),
      };
    } catch (err) {
      return { provider: "drive", status: "disconnected", detail: describeError(err), checkedAt: nowIso() };
    }
  },

  async resolveSubject(input: SubjectLookup): Promise<SubjectCandidate[]> {
    // Drive has no directory lookup without domain-wide admin scope; identity
    // is the email itself, confirmed later by whether a permission exists.
    return [
      {
        provider: "drive",
        providerId: input.email.toLowerCase(),
        displayName: input.displayName,
        email: input.email.toLowerCase(),
      },
    ];
  },

  async resolveProject(input: ProjectLookup): Promise<ProjectCandidate[]> {
    const drive = client();
    const needle = (input.slug ?? input.name).replace(/'/g, "\\'");
    try {
      const res = await drive.files.list({
        q: `mimeType = 'application/vnd.google-apps.folder' and name contains '${needle}' and trashed = false`,
        fields: "files(id,name)",
        pageSize: 25,
      });
      return (res.data.files ?? [])
        .filter((f): f is drive_v3.Schema$File & { id: string; name: string } => Boolean(f.id && f.name))
        .map((f) => ({ provider: "drive" as const, providerId: f.id, name: f.name }));
    } catch (err) {
      throw wrap(err);
    }
  },

  async readProjectAccess(target: AccessTarget): Promise<AccessSnapshot> {
    const drive = client();
    try {
      const permissions = await listPermissions(drive, target.resourceId);
      const mine = permissions.filter((p) => (p.emailAddress ?? "").toLowerCase() === target.subjectProviderId);

      const accessPaths: AccessPath[] = mine.map((p) => {
        const inherited = Boolean(p.permissionDetails?.some((d) => d.inherited));
        return {
          kind: inherited ? "INHERITED" : "DIRECT",
          description: `${p.role} permission on folder ${target.resourceId}${inherited ? " (inherited from a parent folder)" : ""}`,
          permissionLevel: p.role ?? undefined,
          sourceId: p.id ?? undefined,
          removable: !inherited,
        };
      });

      return {
        provider: "drive",
        resourceId: target.resourceId,
        subjectProviderId: target.subjectProviderId,
        hasAccess: accessPaths.length > 0,
        accessPaths,
        observedAt: nowIso(),
      };
    } catch (err) {
      throw wrap(err);
    }
  },

  async capturePreservationSnapshot(target: AccessTarget): Promise<PreservationSnapshot> {
    const drive = client();
    try {
      const [manifest, otherMembers, unrelatedAccess] = await Promise.all([
        listFolderManifest(drive, target.resourceId),
        listOtherMembers(drive, target.resourceId, target.subjectProviderId),
        listUnrelatedFolders(drive, target.subjectProviderId, target.resourceId),
      ]);

      return {
        provider: "drive",
        resourceId: target.resourceId,
        subjectProviderId: target.subjectProviderId,
        authoredItems: manifest,
        unrelatedAccess,
        otherMembers,
        observedAt: nowIso(),
      };
    } catch (err) {
      throw wrap(err);
    }
  },

  async revokeProjectAccess(target: AccessTarget): Promise<MutationResult> {
    const drive = client();
    try {
      const permissions = await listPermissions(drive, target.resourceId);
      const directMine = permissions.filter(
        (p) =>
          (p.emailAddress ?? "").toLowerCase() === target.subjectProviderId &&
          !p.permissionDetails?.some((d) => d.inherited)
      );

      if (directMine.length === 0) {
        return {
          provider: "drive",
          resourceId: target.resourceId,
          subjectProviderId: target.subjectProviderId,
          attempted: false,
          succeeded: true,
          observedAt: nowIso(),
        };
      }

      for (const perm of directMine) {
        if (!perm.id) continue;
        await drive.permissions.delete({ fileId: target.resourceId, permissionId: perm.id });
      }

      return {
        provider: "drive",
        resourceId: target.resourceId,
        subjectProviderId: target.subjectProviderId,
        attempted: true,
        succeeded: true,
        observedAt: nowIso(),
      };
    } catch (err) {
      return {
        provider: "drive",
        resourceId: target.resourceId,
        subjectProviderId: target.subjectProviderId,
        attempted: true,
        succeeded: false,
        error: classifyProviderError(err),
        observedAt: nowIso(),
      };
    }
  },

  async verifyNoProjectAccess(target: AccessTarget): Promise<VerificationResult> {
    try {
      const snapshot = await this.readProjectAccess(target);
      const onlyUnremovableInherited = snapshot.accessPaths.every((p) => p.kind === "INHERITED" && !p.removable);
      return {
        provider: "drive",
        resourceId: target.resourceId,
        subjectProviderId: target.subjectProviderId,
        postconditionMet: !snapshot.hasAccess || (onlyUnremovableInherited ? "UNKNOWN" : false),
        observedAt: nowIso(),
        raw: snapshot,
      };
    } catch {
      return {
        provider: "drive",
        resourceId: target.resourceId,
        subjectProviderId: target.subjectProviderId,
        postconditionMet: "UNKNOWN",
        observedAt: nowIso(),
      };
    }
  },

  async verifyPreservation(
    before: PreservationSnapshot,
    target: AccessTarget
  ): Promise<InvariantResultPayload[]> {
    const after = await this.capturePreservationSnapshot(target);
    const results: InvariantResultPayload[] = [];

    const beforeIds = new Set(before.authoredItems.map((i) => i.id));
    const afterIds = new Set(after.authoredItems.map((i) => i.id));
    const missing = [...beforeIds].filter((id) => !afterIds.has(id));
    results.push({
      name: "AUTHORED_HISTORY_PRESERVED",
      provider: "drive",
      status: missing.length === 0 ? "PASS" : "FAIL",
      detail:
        missing.length === 0
          ? `All ${beforeIds.size} file(s) in the folder manifest still present.`
          : `${missing.length} file(s) missing after mutation: ${missing.join(", ")}`,
      evidence: { beforeCount: beforeIds.size, afterCount: afterIds.size },
    });

    const beforeUnrelated = new Set(before.unrelatedAccess.map((r) => r.resourceId));
    const afterUnrelated = new Set(after.unrelatedAccess.map((r) => r.resourceId));
    const lostAccess = [...beforeUnrelated].filter((id) => !afterUnrelated.has(id));
    results.push({
      name: "UNRELATED_PROJECT_ACCESS_PRESERVED",
      provider: "drive",
      status: lostAccess.length === 0 ? "PASS" : "FAIL",
      detail:
        lostAccess.length === 0
          ? "Unrelated folder access unchanged."
          : `Lost access to unrelated folders: ${lostAccess.join(", ")}`,
      evidence: { before: before.unrelatedAccess, after: after.unrelatedAccess },
    });

    const beforeMembers = new Set(before.otherMembers.map((m) => `${m.providerId}:${m.permissionLevel}`));
    const afterMembers = new Set(after.otherMembers.map((m) => `${m.providerId}:${m.permissionLevel}`));
    const changedMembers = beforeMembers.size !== afterMembers.size || [...beforeMembers].some((m) => !afterMembers.has(m));
    results.push({
      name: "OTHER_USERS_UNCHANGED",
      provider: "drive",
      status: changedMembers ? "FAIL" : "PASS",
      detail: changedMembers ? "Other users' Phoenix folder permissions changed." : "All other permissions unchanged.",
      evidence: { before: before.otherMembers, after: after.otherMembers },
    });

    return results;
  },
};

async function listPermissions(drive: drive_v3.Drive, fileId: string): Promise<drive_v3.Schema$Permission[]> {
  const res = await drive.permissions.list({
    fileId,
    fields: "permissions(id,emailAddress,role,type,permissionDetails)",
  });
  return res.data.permissions ?? [];
}

async function listOtherMembers(
  drive: drive_v3.Drive,
  folderId: string,
  excludeEmail: string
): Promise<OtherMemberRef[]> {
  const permissions = await listPermissions(drive, folderId);
  return permissions
    .filter((p) => (p.emailAddress ?? "").toLowerCase() !== excludeEmail && p.type === "user")
    .map((p) => ({ providerId: (p.emailAddress ?? p.id ?? "unknown").toLowerCase(), permissionLevel: p.role ?? undefined }));
}

async function listUnrelatedFolders(
  drive: drive_v3.Drive,
  email: string,
  excludeFolderId: string
): Promise<UnrelatedAccessRef[]> {
  const safeEmail = email.replace(/'/g, "\\'");
  const res = await drive.files.list({
    q: `('${safeEmail}' in writers or '${safeEmail}' in readers) and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: "files(id,name)",
    pageSize: 50,
  });
  return (res.data.files ?? [])
    .filter((f) => f.id && f.id !== excludeFolderId)
    .map((f) => ({ resourceId: f.id as string, resourceName: f.name ?? "" }));
}

async function listFolderManifest(drive: drive_v3.Drive, folderId: string): Promise<AuthoredItemRef[]> {
  const out: AuthoredItemRef[] = [];
  const queue = [folderId];
  let pageToken: string | undefined;

  while (queue.length > 0 && out.length < MAX_MANIFEST_FILES) {
    const currentFolder = queue.shift() as string;
    do {
      const res = await drive.files.list({
        q: `'${currentFolder}' in parents and trashed = false`,
        fields: "nextPageToken, files(id,name,mimeType,owners(emailAddress),modifiedTime,md5Checksum)",
        pageSize: 200,
        pageToken,
      });
      for (const f of res.data.files ?? []) {
        if (!f.id) continue;
        if (f.mimeType === "application/vnd.google-apps.folder") {
          queue.push(f.id);
        }
        out.push({
          kind: "file",
          id: f.id,
          checksum: f.md5Checksum ?? undefined,
          metadata: {
            name: f.name,
            mimeType: f.mimeType,
            owner: f.owners?.[0]?.emailAddress,
            modifiedTime: f.modifiedTime,
          },
        });
        if (out.length >= MAX_MANIFEST_FILES) break;
      }
      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken && out.length < MAX_MANIFEST_FILES);
  }

  return out;
}

function wrap(err: unknown): ProviderCallError {
  return new ProviderCallError(classifyProviderError(err));
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function nowIso(): string {
  return new Date().toISOString();
}
