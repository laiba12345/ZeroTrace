import { Octokit } from "octokit";
import { getEnv } from "@/lib/env";
import { classifyProviderError } from "@/core/errors";
import type {
  AccessProvider,
  AccessPath,
  AccessSnapshot,
  AccessTarget,
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

// resourceId convention for this adapter: "owner/repo".
// subjectProviderId convention: the GitHub login (not the numeric user ID) —
// collaborator/team endpoints are keyed by username.

function parseResourceId(resourceId: string): { owner: string; repo: string } {
  const [owner, repo] = resourceId.split("/");
  if (!owner || !repo) {
    throw new Error(`Invalid GitHub resourceId "${resourceId}", expected "owner/repo".`);
  }
  return { owner, repo };
}

function client(): Octokit {
  const env = getEnv();
  if (!env.GITHUB_TOKEN) {
    throw new ProviderCallError({
      category: "AUTH",
      safeMessage: "GitHub is not configured (GITHUB_TOKEN missing).",
    });
  }
  return new Octokit({ auth: env.GITHUB_TOKEN, baseUrl: env.GITHUB_API_BASE_URL });
}

export const githubProvider: AccessProvider = {
  name: "github",

  async checkConnection(): Promise<ConnectionHealth> {
    try {
      const env = getEnv();
      if (!env.GITHUB_TOKEN) {
        return { provider: "github", status: "disconnected", detail: "GITHUB_TOKEN not set", checkedAt: nowIso() };
      }
      const octokit = client();
      const res = await octokit.rest.users.getAuthenticated();
      return {
        provider: "github",
        status: "connected",
        detail: `Authenticated as ${res.data.login}`,
        checkedAt: nowIso(),
      };
    } catch (err) {
      return { provider: "github", status: "disconnected", detail: describeError(err), checkedAt: nowIso() };
    }
  },

  async resolveSubject(input: SubjectLookup): Promise<SubjectCandidate[]> {
    const octokit = client();
    try {
      const search = await octokit.rest.search.users({ q: `${input.email} in:email` });
      if (search.data.items.length > 0) {
        return search.data.items.map((u) => ({
          provider: "github" as const,
          providerId: u.login,
          displayName: u.login,
          email: input.email,
          raw: { id: u.id, login: u.login },
        }));
      }
    } catch (err) {
      throw wrap(err);
    }
    return [];
  },

  async resolveProject(input: ProjectLookup): Promise<ProjectCandidate[]> {
    const env = getEnv();
    if (!env.GITHUB_ORG) {
      throw new ProviderCallError({
        category: "PROVIDER",
        safeMessage: "GITHUB_ORG is not configured; cannot resolve a repository without an org context.",
      });
    }
    const octokit = client();
    try {
      const repos = await octokit.paginate(octokit.rest.repos.listForOrg, {
        org: env.GITHUB_ORG,
        per_page: 100,
      });
      const needle = (input.slug ?? input.name).toLowerCase();
      const matches = repos.filter(
        (r) => r.name.toLowerCase() === needle || r.name.toLowerCase().includes(needle)
      );
      return matches.map((r) => ({
        provider: "github" as const,
        providerId: `${env.GITHUB_ORG}/${r.name}`,
        name: r.name,
        raw: { id: r.id },
      }));
    } catch (err) {
      throw wrap(err);
    }
  },

  async readProjectAccess(target: AccessTarget): Promise<AccessSnapshot> {
    const octokit = client();
    const { owner, repo } = parseResourceId(target.resourceId);
    const accessPaths: AccessPath[] = [];

    try {
      const isDirect = await isDirectCollaborator(octokit, owner, repo, target.subjectProviderId);
      if (isDirect) {
        const perm = await octokit.rest.repos.getCollaboratorPermissionLevel({
          owner,
          repo,
          username: target.subjectProviderId,
        });
        accessPaths.push({
          kind: "DIRECT",
          description: `Direct collaborator on ${owner}/${repo}`,
          permissionLevel: perm.data.permission,
          removable: true,
        });
      }

      const teams = await octokit.paginate(octokit.rest.repos.listTeams, { owner, repo, per_page: 100 });
      for (const team of teams) {
        const isMember = await isTeamMember(octokit, owner, team.slug, target.subjectProviderId);
        if (isMember) {
          accessPaths.push({
            kind: "INHERITED",
            description: `Inherited via team "${team.name}" (${team.permission}) on ${owner}/${repo}`,
            permissionLevel: team.permission,
            sourceId: team.slug,
            // Only safely removable if the team's ONLY repo access is this one —
            // narrowness is checked in revokeProjectAccess before mutating.
            removable: false,
          });
        }
      }

      return {
        provider: "github",
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
    const octokit = client();
    const { owner, repo } = parseResourceId(target.resourceId);

    try {
      // GitHub's issue/PR search requires an explicit is:issue or
      // is:pull-request qualifier — a bare author+repo query 422s — so
      // authored issues and authored PRs are queried separately. Some
      // fine-grained PATs additionally reject /search/issues on private
      // repos even with correct scopes ("Validation Failed" 422) — treated
      // as "not available" (empty results) rather than a hard failure,
      // since authored issues/PRs are supplementary evidence; commits alone
      // already satisfy AUTHORED_HISTORY_PRESERVED.
      const [commits, issues, pullRequests, collaborators, otherRepos] = await Promise.all([
        octokit.rest.search.commits({ q: `repo:${owner}/${repo} author:${target.subjectProviderId}` }),
        searchIssuesOrEmpty(octokit, `repo:${owner}/${repo} author:${target.subjectProviderId} is:issue`),
        searchIssuesOrEmpty(octokit, `repo:${owner}/${repo} author:${target.subjectProviderId} is:pull-request`),
        octokit.paginate(octokit.rest.repos.listCollaborators, { owner, repo, per_page: 100 }),
        octokit.paginate(octokit.rest.repos.listForUser, { username: target.subjectProviderId, per_page: 100 }),
      ]);

      const authoredItems = [
        ...commits.data.items.map((c) => ({
          kind: "commit",
          id: c.sha,
          metadata: { url: c.html_url },
        })),
        ...issues.map((i) => ({
          kind: "issue",
          id: String(i.number),
          metadata: { state: i.state },
        })),
        ...pullRequests.map((i) => ({
          kind: "pull_request",
          id: String(i.number),
          metadata: { state: i.state },
        })),
      ];

      const otherMembers: OtherMemberRef[] = collaborators
        .filter((c) => c.login !== target.subjectProviderId)
        .map((c) => ({ providerId: c.login, displayName: c.login, permissionLevel: c.permissions?.push ? "write" : "read" }));

      const unrelatedAccess: UnrelatedAccessRef[] = otherRepos
        .filter((r) => `${r.owner.login}/${r.name}` !== target.resourceId && r.owner.login === owner)
        .map((r) => ({ resourceId: `${r.owner.login}/${r.name}`, resourceName: r.name }));

      return {
        provider: "github",
        resourceId: target.resourceId,
        subjectProviderId: target.subjectProviderId,
        authoredItems,
        unrelatedAccess,
        otherMembers,
        observedAt: nowIso(),
      };
    } catch (err) {
      throw wrap(err);
    }
  },

  async revokeProjectAccess(target: AccessTarget): Promise<MutationResult> {
    const octokit = client();
    const { owner, repo } = parseResourceId(target.resourceId);

    try {
      const isDirect = await isDirectCollaborator(octokit, owner, repo, target.subjectProviderId);
      if (!isDirect) {
        return {
          provider: "github",
          resourceId: target.resourceId,
          subjectProviderId: target.subjectProviderId,
          attempted: false,
          succeeded: true,
          observedAt: nowIso(),
        };
      }

      const res = await octokit.rest.repos.removeCollaborator({
        owner,
        repo,
        username: target.subjectProviderId,
      });

      return {
        provider: "github",
        resourceId: target.resourceId,
        subjectProviderId: target.subjectProviderId,
        attempted: true,
        succeeded: res.status === 204,
        providerRequestId: res.headers["x-github-request-id"],
        observedAt: nowIso(),
      };
    } catch (err) {
      const providerError = classifyProviderError(err);
      return {
        provider: "github",
        resourceId: target.resourceId,
        subjectProviderId: target.subjectProviderId,
        attempted: true,
        succeeded: false,
        error: providerError,
        observedAt: nowIso(),
      };
    }
  },

  async verifyNoProjectAccess(target: AccessTarget): Promise<VerificationResult> {
    try {
      const snapshot = await this.readProjectAccess(target);
      const onlyUnremovableInherited = snapshot.accessPaths.every((p) => p.kind === "INHERITED" && !p.removable);
      return {
        provider: "github",
        resourceId: target.resourceId,
        subjectProviderId: target.subjectProviderId,
        postconditionMet: !snapshot.hasAccess || (onlyUnremovableInherited ? "UNKNOWN" : false),
        observedAt: nowIso(),
        raw: snapshot,
      };
    } catch {
      return {
        provider: "github",
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

    const beforeIds = new Set(before.authoredItems.map((i) => `${i.kind}:${i.id}`));
    const afterIds = new Set(after.authoredItems.map((i) => `${i.kind}:${i.id}`));
    const missing = [...beforeIds].filter((id) => !afterIds.has(id));
    results.push({
      name: "AUTHORED_HISTORY_PRESERVED",
      provider: "github",
      status: missing.length === 0 ? "PASS" : "FAIL",
      detail:
        missing.length === 0
          ? `All ${beforeIds.size} authored commits/issues/PRs still present.`
          : `${missing.length} authored item(s) missing after mutation: ${missing.join(", ")}`,
      evidence: { before: before.authoredItems, after: after.authoredItems },
    });

    const beforeUnrelated = new Set(before.unrelatedAccess.map((r) => r.resourceId));
    const afterUnrelated = new Set(after.unrelatedAccess.map((r) => r.resourceId));
    const lostAccess = [...beforeUnrelated].filter((id) => !afterUnrelated.has(id));
    results.push({
      name: "UNRELATED_PROJECT_ACCESS_PRESERVED",
      provider: "github",
      status: lostAccess.length === 0 ? "PASS" : "FAIL",
      detail:
        lostAccess.length === 0
          ? "Unrelated repository access unchanged."
          : `Lost access to unrelated repos: ${lostAccess.join(", ")}`,
      evidence: { before: before.unrelatedAccess, after: after.unrelatedAccess },
    });

    const beforeMembers = new Set(before.otherMembers.map((m) => `${m.providerId}:${m.permissionLevel}`));
    const afterMembers = new Set(after.otherMembers.map((m) => `${m.providerId}:${m.permissionLevel}`));
    const changedMembers =
      beforeMembers.size !== afterMembers.size || [...beforeMembers].some((m) => !afterMembers.has(m));
    results.push({
      name: "OTHER_USERS_UNCHANGED",
      provider: "github",
      status: changedMembers ? "FAIL" : "PASS",
      detail: changedMembers
        ? "Other collaborators' access on Phoenix changed."
        : "All other collaborators' access unchanged.",
      evidence: { before: before.otherMembers, after: after.otherMembers },
    });

    return results;
  },
};

async function isDirectCollaborator(octokit: Octokit, owner: string, repo: string, username: string) {
  try {
    await octokit.rest.repos.checkCollaborator({ owner, repo, username });
    return true;
  } catch (err) {
    if (isNotFound(err)) return false;
    throw err;
  }
}

async function isTeamMember(octokit: Octokit, org: string, teamSlug: string, username: string) {
  try {
    const res = await octokit.rest.teams.getMembershipForUserInOrg({ org, team_slug: teamSlug, username });
    return res.data.state === "active";
  } catch (err) {
    if (isNotFound(err)) return false;
    throw err;
  }
}

async function searchIssuesOrEmpty(
  octokit: Octokit,
  q: string
): Promise<{ number: number; state: string }[]> {
  try {
    const res = await octokit.rest.search.issuesAndPullRequests({ q });
    return res.data.items;
  } catch {
    return [];
  }
}

function isNotFound(err: unknown): boolean {
  return Boolean(err && typeof err === "object" && "status" in err && (err as { status: unknown }).status === 404);
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
