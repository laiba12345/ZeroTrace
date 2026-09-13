"use client";

import { useEffect, useState } from "react";
import { Badge } from "./ui/badge";
import { connectionTone, providerLabel } from "./status";

type Connection = { provider: string; status: "connected" | "degraded" | "disconnected"; detail?: string };

export function ConnectionStatus({ onAllConnected }: { onAllConnected?: (allConnected: boolean) => void }) {
  const [connections, setConnections] = useState<Connection[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function check() {
      setLoading(true);
      try {
        const res = await fetch("/api/connections");
        const data = await res.json();
        if (!cancelled) {
          setConnections(data.connections ?? []);
          onAllConnected?.((data.connections ?? []).every((c: Connection) => c.status === "connected"));
        }
      } catch {
        if (!cancelled) {
          setConnections([]);
          onAllConnected?.(false);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    check();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex flex-wrap items-center gap-2" aria-label="Provider connection status">
      {loading && !connections ? (
        <span className="text-xs text-muted">Checking provider connections…</span>
      ) : (
        (connections ?? []).map((c) => (
          <Badge key={c.provider} tone={connectionTone(c.status)} title={c.detail}>
            <span className="relative flex h-1.5 w-1.5">
              <span
                className={
                  "inline-flex h-1.5 w-1.5 rounded-full " +
                  (c.status === "connected" ? "bg-emerald" : c.status === "degraded" ? "bg-amber" : "bg-red")
                }
              />
            </span>
            {providerLabel(c.provider)} · {c.status}
          </Badge>
        ))
      )}
    </div>
  );
}
