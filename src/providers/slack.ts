import { WebClient } from "@slack/web-api";
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

// resourceId convention: Slack channel ID. subjectProviderId: Slack user ID.

function client(): WebClient {
  const env = getEnv();
  if (!env.SLACK_BOT_TOKEN) {
    throw new ProviderCallError({
      category: "AUTH",
      safeMessage: "Slack is not configured (SLACK_BOT_TOKEN missing).",
    });
  }
  return new WebClient(env.SLACK_BOT_TOKEN, {
    slackApiUrl: env.SLACK_API_BASE_URL,
    timeout: env.PROVIDER_READ_TIMEOUT_MS,
  });
}

export const slackProvider: AccessProvider = {
  name: "slack",

  async checkConnection(): Promise<ConnectionHealth> {
    try {
      const env = getEnv();
      if (!env.SLACK_BOT_TOKEN) {
        return { provider: "slack", status: "disconnected", detail: "SLACK_BOT_TOKEN not set", checkedAt: nowIso() };
      }
      const web = client();
      const res = await web.auth.test();
      return {
        provider: "slack",
        status: "connected",
        detail: `Authenticated as ${String(res.user)} in ${String(res.team)}`,
        checkedAt: nowIso(),
      };
    } catch (err) {
      return { provider: "slack", status: "disconnected", detail: describeError(err), checkedAt: nowIso() };
    }
  },

  async resolveSubject(input: SubjectLookup): Promise<SubjectCandidate[]> {
    const web = client();
    try {
      const res = await web.users.lookupByEmail({ email: input.email });
      if (!res.ok || !res.user) return [];
      return [
        {
          provider: "slack",
          providerId: String(res.user.id),
          displayName: res.user.real_name ?? res.user.name ?? input.displayName,
          email: input.email,
          raw: { id: res.user.id },
        },
      ];
    } catch (err) {
      if (isSlackErrorCode(err, "users_not_found")) return [];
      throw wrap(err);
    }
  },

  async resolveProject(input: ProjectLookup): Promise<ProjectCandidate[]> {
    const web = client();
    const needle = (input.slug ?? input.name).toLowerCase();
    const matches: ProjectCandidate[] = [];
    try {
      for await (const page of web.paginate("conversations.list", {
        types: "private_channel,public_channel",
        limit: 200,
      }) as AsyncIterable<{ channels?: { id?: string; name?: string }[] }>) {
        for (const ch of page.channels ?? []) {
          if (ch.name && ch.id && ch.name.toLowerCase().includes(needle)) {
            matches.push({ provider: "slack", providerId: ch.id, name: ch.name });
          }
        }
      }
      return matches;
    } catch (err) {
      throw wrap(err);
    }
  },

  async readProjectAccess(target: AccessTarget): Promise<AccessSnapshot> {
    const web = client();
    try {
      const isMember = await isChannelMember(web, target.resourceId, target.subjectProviderId);
      const accessPaths: AccessPath[] = isMember
        ? [
            {
              kind: "DIRECT",
              description: `Member of Slack channel ${target.resourceId}`,
              removable: true,
            },
          ]
        : [];

      return {
        provider: "slack",
        resourceId: target.resourceId,
        subjectProviderId: target.subjectProviderId,
        hasAccess: isMember,
        accessPaths,
        observedAt: nowIso(),
      };
    } catch (err) {
      throw wrap(err);
    }
  },

  async capturePreservationSnapshot(target: AccessTarget): Promise<PreservationSnapshot> {
    const web = client();
    try {
      const [authoredMessageIds, otherMembers, userChannels] = await Promise.all([
        listAuthoredMessageIds(web, target.resourceId, target.subjectProviderId),
        listOtherMembers(web, target.resourceId, target.subjectProviderId),
        listUserChannels(web, target.subjectProviderId),
      ]);

      const unrelatedAccess: UnrelatedAccessRef[] = userChannels
        .filter((c) => c.id !== target.resourceId)
        .map((c) => ({ resourceId: c.id, resourceName: c.name }));

      return {
        provider: "slack",
        resourceId: target.resourceId,
        subjectProviderId: target.subjectProviderId,
        authoredItems: authoredMessageIds.map((ts) => ({ kind: "message", id: ts })),
        unrelatedAccess,
        otherMembers,
        observedAt: nowIso(),
      };
    } catch (err) {
      throw wrap(err);
    }
  },

  async revokeProjectAccess(target: AccessTarget): Promise<MutationResult> {
    const web = client();
    try {
      const isMember = await isChannelMember(web, target.resourceId, target.subjectProviderId);
      if (!isMember) {
        return {
          provider: "slack",
          resourceId: target.resourceId,
          subjectProviderId: target.subjectProviderId,
          attempted: false,
          succeeded: true,
          observedAt: nowIso(),
        };
      }

      const res = await web.conversations.kick({ channel: target.resourceId, user: target.subjectProviderId });
      return {
        provider: "slack",
        resourceId: target.resourceId,
        subjectProviderId: target.subjectProviderId,
        attempted: true,
        succeeded: Boolean(res.ok),
        providerRequestId: (res as unknown as { response_metadata?: { request_id?: string } })
          .response_metadata?.request_id,
        observedAt: nowIso(),
      };
    } catch (err) {
      return {
        provider: "slack",
        resourceId: target.resourceId,
        subjectProviderId: target.subjectProviderId,
        attempted: true,
        succeeded: false,
        error: classifyProviderError(mapSlackErrorForClassification(err)),
        observedAt: nowIso(),
      };
    }
  },

  async verifyNoProjectAccess(target: AccessTarget): Promise<VerificationResult> {
    try {
      const web = client();
      const isMember = await isChannelMember(web, target.resourceId, target.subjectProviderId);
      return {
        provider: "slack",
        resourceId: target.resourceId,
        subjectProviderId: target.subjectProviderId,
        postconditionMet: !isMember,
        observedAt: nowIso(),
      };
    } catch {
      return {
        provider: "slack",
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
      provider: "slack",
      status: missing.length === 0 ? "PASS" : "FAIL",
      detail:
        missing.length === 0
          ? `All ${beforeIds.size} authored message(s) still present.`
          : `${missing.length} authored message(s) missing after mutation.`,
      evidence: { beforeCount: beforeIds.size, afterCount: afterIds.size },
    });

    const beforeUnrelated = new Set(before.unrelatedAccess.map((r) => r.resourceId));
    const afterUnrelated = new Set(after.unrelatedAccess.map((r) => r.resourceId));
    const lostAccess = [...beforeUnrelated].filter((id) => !afterUnrelated.has(id));
    results.push({
      name: "UNRELATED_PROJECT_ACCESS_PRESERVED",
      provider: "slack",
      status: lostAccess.length === 0 ? "PASS" : "FAIL",
      detail:
        lostAccess.length === 0
          ? "Unrelated channel membership unchanged."
          : `Lost membership in unrelated channels: ${lostAccess.join(", ")}`,
      evidence: { before: before.unrelatedAccess, after: after.unrelatedAccess },
    });

    const beforeMembers = new Set(before.otherMembers.map((m) => m.providerId));
    const afterMembers = new Set(after.otherMembers.map((m) => m.providerId));
    const changedMembers = beforeMembers.size !== afterMembers.size || [...beforeMembers].some((m) => !afterMembers.has(m));
    results.push({
      name: "OTHER_USERS_UNCHANGED",
      provider: "slack",
      status: changedMembers ? "FAIL" : "PASS",
      detail: changedMembers ? "Other channel members changed." : "All other channel members unchanged.",
      evidence: { before: before.otherMembers, after: after.otherMembers },
    });

    return results;
  },
};

async function isChannelMember(web: WebClient, channelId: string, userId: string): Promise<boolean> {
  for await (const page of web.paginate("conversations.members", { channel: channelId, limit: 200 }) as AsyncIterable<{
    members?: string[];
  }>) {
    if ((page.members ?? []).includes(userId)) return true;
  }
  return false;
}

async function listOtherMembers(web: WebClient, channelId: string, excludeUserId: string): Promise<OtherMemberRef[]> {
  const ids: string[] = [];
  for await (const page of web.paginate("conversations.members", { channel: channelId, limit: 200 }) as AsyncIterable<{
    members?: string[];
  }>) {
    for (const id of page.members ?? []) {
      if (id !== excludeUserId) ids.push(id);
    }
  }

  // Display names are cosmetic evidence for the UI's before/after member
  // list — bounded to a small member set (typical for a demo channel), so a
  // per-user lookup is cheap; falls back to the bare ID if a lookup fails.
  return Promise.all(
    ids.map(async (id) => {
      try {
        const res = await web.users.info({ user: id });
        return { providerId: id, displayName: res.user?.real_name ?? res.user?.name ?? id };
      } catch {
        return { providerId: id };
      }
    })
  );
}

async function listUserChannels(web: WebClient, userId: string): Promise<{ id: string; name: string }[]> {
  const out: { id: string; name: string }[] = [];
  for await (const page of web.paginate("users.conversations", {
    user: userId,
    types: "private_channel,public_channel",
    limit: 200,
  }) as AsyncIterable<{ channels?: { id?: string; name?: string }[] }>) {
    for (const ch of page.channels ?? []) {
      if (ch.id && ch.name) out.push({ id: ch.id, name: ch.name });
    }
  }
  return out;
}

// Only stable message identifiers (ts) are captured — never message text —
// per the redaction requirement in section 12.
async function listAuthoredMessageIds(web: WebClient, channelId: string, userId: string): Promise<string[]> {
  const out: string[] = [];
  let cursor: string | undefined;
  do {
    const res = await web.conversations.history({ channel: channelId, cursor, limit: 200 });
    for (const msg of res.messages ?? []) {
      if (msg.user === userId && msg.ts) out.push(msg.ts);
    }
    cursor = res.response_metadata?.next_cursor || undefined;
  } while (cursor);
  return out;
}

function isSlackErrorCode(err: unknown, code: string): boolean {
  return Boolean(
    err &&
      typeof err === "object" &&
      "data" in err &&
      (err as { data?: { error?: string } }).data?.error === code
  );
}

function mapSlackErrorForClassification(err: unknown): unknown {
  const slackError = err as { data?: { error?: string } } | undefined;
  const code = slackError?.data?.error;
  if (code === "not_authed" || code === "invalid_auth" || code === "token_revoked") {
    return { status: 401 };
  }
  if (code === "missing_scope" || code === "restricted_action" || code === "cant_kick_from_general") {
    return { status: 403 };
  }
  if (code === "channel_not_found" || code === "user_not_found") {
    return { status: 404 };
  }
  if (code === "ratelimited") {
    return { status: 429 };
  }
  return err;
}

function wrap(err: unknown): ProviderCallError {
  return new ProviderCallError(classifyProviderError(mapSlackErrorForClassification(err)));
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function nowIso(): string {
  return new Date().toISOString();
}
