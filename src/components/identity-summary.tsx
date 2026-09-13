import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import type { ResolvedIdentityView, ResolvedProjectView } from "@/lib/client-types";

export function IdentitySummary({
  identity,
  project,
}: {
  identity: ResolvedIdentityView;
  project: ResolvedProjectView;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Subject</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="text-foreground">{identity.displayName}</div>
          <div className="font-evidence text-xs text-muted">{identity.canonicalEmail}</div>
          <dl className="mt-2 space-y-1 font-evidence text-xs text-muted-2">
            <div>github: {identity.github.login}</div>
            <div>slack: {identity.slack.userId}</div>
            <div>drive: {identity.drive.permissionEmail}</div>
          </dl>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Project</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="text-foreground">{project.canonicalName}</div>
          <dl className="mt-2 space-y-1 font-evidence text-xs text-muted-2">
            <div>github: {project.github.owner}/{project.github.repo}</div>
            <div>slack: #{project.slack.channelName}</div>
            <div>drive: {project.drive.folderName}</div>
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}
