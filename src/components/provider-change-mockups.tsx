import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import type {
  ObligationView,
  OtherMemberView,
  ResolvedIdentityView,
  ResolvedProjectView,
  RunDetail,
} from "@/lib/client-types";

const AVATAR_COLORS = ["#7c5cff", "#22a06b", "#e0913f", "#e0526f", "#3aa0d6", "#c98a3a"];

function colorForName(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function Avatar({ name, size = 28 }: { name: string; size?: number }) {
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
      style={{ width: size, height: size, backgroundColor: colorForName(name), fontSize: size * 0.38 }}
    >
      {initials(name)}
    </div>
  );
}

function MemberRow({
  name,
  sublabel,
  roleBadge,
  removed,
}: {
  name: string;
  sublabel?: string;
  roleBadge?: string;
  removed?: boolean;
}) {
  return (
    <div className={`flex items-center gap-2.5 py-1.5 ${removed ? "opacity-50" : ""}`}>
      <Avatar name={name} />
      <div className="min-w-0 flex-1">
        <div className={`truncate text-sm text-foreground ${removed ? "line-through" : ""}`}>{name}</div>
        {sublabel && <div className="truncate text-[11px] text-muted-2">{sublabel}</div>}
      </div>
      {removed ? (
        <span className="shrink-0 rounded border border-red/30 bg-red-dim px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-red">
          REMOVED
        </span>
      ) : roleBadge ? (
        <span className="shrink-0 rounded border border-border-strong bg-surface px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-muted">
          {roleBadge.toUpperCase()}
        </span>
      ) : null}
    </div>
  );
}

function ProviderWindow({
  accent,
  chrome,
  title,
  subtitle,
  children,
}: {
  accent: string;
  chrome: string;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-border-strong bg-[#0d0f13]">
      <div className="flex items-center gap-2 border-b border-border-strong px-3 py-2" style={{ background: chrome }}>
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: accent }} />
        <div className="min-w-0">
          <div className="truncate text-xs font-medium text-white/90">{title}</div>
          <div className="truncate text-[10px] text-white/50">{subtitle}</div>
        </div>
      </div>
      <div className="px-3 py-2">{children}</div>
    </div>
  );
}

function subjectPermissionLabel(before: RunDetail["beforeState"], provider: string): string {
  const path = before?.access[provider]?.accessPaths[0];
  return path?.permissionLevel ?? "Member";
}

function isRemoved(obligations: ObligationView[], provider: string): boolean {
  const o = obligations.find((ob) => ob.provider === provider);
  return o ? ["VERIFIED", "NOT_NEEDED"].includes(o.status) : false;
}

function otherMembersFor(before: RunDetail["beforeState"], provider: string): OtherMemberView[] {
  return before?.preservation[provider]?.otherMembers ?? [];
}

export function ProviderChangeMockups({
  identity,
  project,
  beforeState,
  obligations,
}: {
  identity: ResolvedIdentityView;
  project: ResolvedProjectView;
  beforeState: RunDetail["beforeState"];
  obligations: ObligationView[];
}) {
  if (!beforeState) return null;

  const githubRemoved = isRemoved(obligations, "github");
  const slackRemoved = isRemoved(obligations, "slack");
  const driveRemoved = isRemoved(obligations, "drive");

  return (
    <Card>
      <CardHeader>
        <CardTitle>What changes on each provider</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <ProviderWindow
            accent="#3fb950"
            chrome="linear-gradient(180deg,#161b22,#0d1117)"
            title={`${project.github.owner} / ${project.github.repo}`}
            subtitle="Settings › Collaborators and teams"
          >
            <MemberRow name={identity.displayName} sublabel={identity.github.login} roleBadge={subjectPermissionLabel(beforeState, "github")} removed={githubRemoved} />
            {otherMembersFor(beforeState, "github").map((m) => (
              <MemberRow key={m.providerId} name={m.displayName ?? m.providerId} roleBadge={m.permissionLevel} />
            ))}
          </ProviderWindow>

          <ProviderWindow
            accent="#ecb22e"
            chrome="linear-gradient(180deg,#3a1a3f,#25102b)"
            title={`#${project.slack.channelName}`}
            subtitle="Channel members"
          >
            <MemberRow name={identity.displayName} sublabel={identity.canonicalEmail} removed={slackRemoved} />
            {otherMembersFor(beforeState, "slack").map((m) => (
              <MemberRow key={m.providerId} name={m.displayName ?? m.providerId} />
            ))}
          </ProviderWindow>

          <ProviderWindow
            accent="#4285f4"
            chrome="linear-gradient(180deg,#1a2233,#10151f)"
            title={`Share “${project.drive.folderName}”`}
            subtitle="People with access"
          >
            <MemberRow name={identity.displayName} sublabel={identity.canonicalEmail} roleBadge={subjectPermissionLabel(beforeState, "drive")} removed={driveRemoved} />
            {otherMembersFor(beforeState, "drive").map((m) => (
              <MemberRow key={m.providerId} name={m.displayName ?? m.providerId} sublabel={m.providerId !== m.displayName ? m.providerId : undefined} roleBadge={m.permissionLevel} />
            ))}
          </ProviderWindow>
        </div>
        <p className="mt-3 text-xs text-muted-2">
          Stylized to evoke each provider&apos;s own settings screen, rendered from the same access data shown in evidence above — not a live embed of GitHub, Slack, or Drive.
        </p>
      </CardContent>
    </Card>
  );
}
