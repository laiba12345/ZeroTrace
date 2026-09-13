import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Badge } from "./ui/badge";
import { invariantTone, providerLabel } from "./status";
import type { InvariantResultView } from "@/lib/client-types";

const INVARIANT_LABELS: Record<string, string> = {
  AUTHORED_HISTORY_PRESERVED: "Authored history preserved",
  UNRELATED_PROJECT_ACCESS_PRESERVED: "Unrelated project access preserved",
  OTHER_USERS_UNCHANGED: "Other users unchanged",
  ONLY_APPROVED_RESOURCES_TOUCHED: "Only approved resources touched",
  NO_CONTENT_DELETE_OPERATIONS_SENT: "No content-delete operations sent",
};

export function InvariantList({ invariants }: { invariants: InvariantResultView[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Invariants</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {invariants.map((inv) => (
          <div
            key={inv.id}
            className="flex items-center justify-between gap-3 rounded-md bg-surface-raised px-3 py-2 text-sm"
          >
            <div>
              <div className="text-foreground">{INVARIANT_LABELS[inv.name] ?? inv.name}</div>
              <div className="text-xs text-muted-2">
                {inv.provider === "system" ? "system" : providerLabel(inv.provider)}
                {inv.detail ? ` · ${inv.detail}` : ""}
              </div>
            </div>
            <Badge tone={invariantTone(inv.status)}>{inv.status}</Badge>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
