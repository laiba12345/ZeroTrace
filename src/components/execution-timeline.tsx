import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Badge } from "./ui/badge";
import { obligationTone, providerLabel } from "./status";
import type { ObligationView, RunEventView } from "@/lib/client-types";

const PROVIDERS = ["github", "slack", "drive"] as const;

export function ExecutionTimeline({
  events,
  obligations,
}: {
  events: RunEventView[];
  obligations: ObligationView[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Execution</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {PROVIDERS.map((provider) => {
          const providerEvents = events.filter((e) => e.provider === provider);
          const obligation = obligations.find((o) => o.provider === provider);
          const started = providerEvents.length > 0;

          return (
            <div key={provider} className="flex gap-4">
              <div className="flex flex-col items-center">
                <div
                  className={
                    "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold " +
                    (started
                      ? obligation && ["VERIFIED", "NOT_NEEDED"].includes(obligation.status)
                        ? "border-emerald text-emerald"
                        : obligation && ["FAILED", "BLOCKED"].includes(obligation.status)
                        ? "border-red text-red"
                        : "border-blue text-blue"
                      : "border-border-strong text-muted-2")
                  }
                >
                  {provider === "github" ? "GH" : provider === "slack" ? "SL" : "GD"}
                </div>
                <div className="mt-1 w-px flex-1 bg-border" />
              </div>
              <div className="flex-1 pb-2">
                <div className="mb-1.5 flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground">{providerLabel(provider)}</span>
                  {obligation && <Badge tone={obligationTone(obligation.status)}>{obligation.status}</Badge>}
                </div>
                {!started ? (
                  <p className="text-xs text-muted-2">Waiting…</p>
                ) : (
                  <ol className="space-y-1">
                    {providerEvents.map((e) => (
                      <li key={e.id} className="flex items-baseline gap-2 text-xs">
                        <span className="font-evidence text-muted-2">
                          {new Date(e.createdAt).toLocaleTimeString(undefined, { hour12: false })}
                        </span>
                        <span className="text-muted">{e.message}</span>
                      </li>
                    ))}
                  </ol>
                )}
                {obligation?.errorSafeMessage && (
                  <p className="mt-1.5 rounded border border-red/30 bg-red-dim px-2 py-1 text-xs text-red">
                    {obligation.errorSafeMessage}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
