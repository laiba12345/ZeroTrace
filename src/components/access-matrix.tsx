import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Badge } from "./ui/badge";
import { obligationTone, providerLabel } from "./status";
import type { AccessSnapshotView, ObligationView } from "@/lib/client-types";

function beforeLabel(snapshot: AccessSnapshotView | undefined): string {
  if (!snapshot) return "—";
  if (!snapshot.hasAccess) return "NONE";
  return snapshot.accessPaths.map((p) => p.permissionLevel ?? p.kind).join(", ").toUpperCase();
}

function afterLabel(obligation: ObligationView | undefined): { text: string; tone: ReturnType<typeof obligationTone> } {
  if (!obligation) return { text: "—", tone: "neutral" };
  switch (obligation.status) {
    case "VERIFIED":
    case "NOT_NEEDED":
      return { text: "NONE", tone: "emerald" };
    case "FAILED":
      return { text: "STILL PRESENT", tone: "red" };
    case "BLOCKED":
      return { text: "BLOCKED", tone: "red" };
    case "UNKNOWN":
      return { text: "UNKNOWN", tone: "amber" };
    default:
      return { text: "PENDING", tone: "amber" };
  }
}

export function AccessMatrix({
  access,
  obligations,
}: {
  access: Record<string, AccessSnapshotView>;
  obligations: ObligationView[];
}) {
  const providers = ["github", "slack", "drive"] as const;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Access matrix</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-2">
              <th className="px-5 py-2 font-medium">Provider</th>
              <th className="px-5 py-2 font-medium">Before</th>
              <th className="px-5 py-2 font-medium">After</th>
            </tr>
          </thead>
          <tbody>
            {providers.map((p) => {
              const obligation = obligations.find((o) => o.provider === p);
              const after = afterLabel(obligation);
              return (
                <tr key={p} className="border-b border-border last:border-0">
                  <td className="px-5 py-3 text-foreground">{providerLabel(p)}</td>
                  <td className="px-5 py-3 font-evidence text-muted">{beforeLabel(access[p])}</td>
                  <td className="px-5 py-3">
                    <Badge tone={after.tone}>{after.text}</Badge>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
