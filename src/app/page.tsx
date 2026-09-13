"use client";

import { useCallback, useState } from "react";
import { ConnectionStatus } from "@/components/connection-status";
import { CommandCard } from "@/components/command-card";
import { IdentitySummary } from "@/components/identity-summary";
import { AccessMatrix } from "@/components/access-matrix";
import { ProviderChangeMockups } from "@/components/provider-change-mockups";
import { ApprovalPanel } from "@/components/approval-panel";
import { ExecutionTimeline } from "@/components/execution-timeline";
import { InvariantList } from "@/components/invariant-list";
import { FinalStatusBanner } from "@/components/final-status-banner";
import { ReceiptDrawer } from "@/components/receipt-drawer";
import { Badge } from "@/components/ui/badge";
import { useRunStream } from "@/lib/use-run-stream";
import type { RunDetail } from "@/lib/client-types";

const TERMINAL_STATUSES = new Set(["COMPLETE", "INCOMPLETE", "UNVERIFIED", "BLOCKED", "SAFETY_VIOLATION"]);

export default function Home() {
  const [allConnected, setAllConnected] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [run, setRun] = useState<RunDetail | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [approving, setApproving] = useState(false);
  const [showReceipt, setShowReceipt] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refetchRun = useCallback(async (id: string) => {
    const res = await fetch(`/api/runs/${id}`);
    if (res.ok) setRun(await res.json());
  }, []);

  useRunStream(run && !TERMINAL_STATUSES.has(run.status) ? runId : null, () => {
    if (runId) refetchRun(runId);
  });

  async function handleSubmit(instruction: string) {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/preflight", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instruction }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Preflight failed.");
        return;
      }
      setRunId(data.runId);
      await refetchRun(data.runId);
    } catch {
      setError("Could not reach ZeroTrace's server.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleApprove() {
    if (!runId) return;
    setApproving(true);
    setError(null);
    try {
      const res = await fetch(`/api/runs/${runId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Approval failed.");
        return;
      }
      await refetchRun(runId);

      // Fire execution; the SSE stream (started by the effect once run.status
      // flips away from a terminal state) surfaces progress as it happens —
      // this call is not awaited for UI purposes beyond error surfacing.
      fetch(`/api/runs/${runId}/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approvalToken: data.approvalToken }),
      })
        .then(async (res) => {
          if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            setError(body.error ?? "Execution failed unexpectedly.");
          }
          await refetchRun(runId);
        })
        .catch(() => setError("Lost connection to ZeroTrace's server during execution."));
    } finally {
      setApproving(false);
    }
  }

  function reset() {
    setRunId(null);
    setRun(null);
    setError(null);
    setShowReceipt(false);
  }

  const isTerminal = run ? TERMINAL_STATUSES.has(run.status) : false;
  const isExecuting = run ? ["APPROVED", "EXECUTING"].includes(run.status) : false;

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-6 px-4 py-6 sm:px-6">
      <header className="no-print flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-lg font-bold tracking-tight text-foreground">ZeroTrace</span>
            <Badge tone="neutral">SANDBOX</Badge>
          </div>
          <p className="text-xs text-muted">Verified project offboarding</p>
        </div>
        <ConnectionStatus onAllConnected={setAllConnected} />
      </header>

      {!runId && (
        <CommandCard disabled={!allConnected} submitting={submitting} onSubmit={handleSubmit} />
      )}

      {error && (
        <div className="rounded-md border border-red/30 bg-red-dim px-4 py-3 text-sm text-red">{error}</div>
      )}

      {run && run.status === "BLOCKED" && (
        <div className="space-y-4">
          <FinalStatusBanner status="BLOCKED" onOpenReceipt={() => setShowReceipt(true)} />
          <div className="rounded-lg border border-border bg-surface p-5">
            <h3 className="mb-2 text-sm font-semibold text-foreground">Why this was blocked</h3>
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
              {run.blockers.map((b, i) => (
                <li key={i}>{b}</li>
              ))}
            </ul>
          </div>
          <button onClick={reset} className="text-xs text-blue hover:underline">
            Start a new request
          </button>
        </div>
      )}

      {run && run.status === "PREFLIGHT_READY" && run.resolvedIdentity && run.resolvedProject && run.beforeState && run.approvedPlan && (
        <div className="space-y-4">
          <IdentitySummary identity={run.resolvedIdentity} project={run.resolvedProject} />
          <AccessMatrix access={run.beforeState.access} obligations={run.obligations} />
          <ProviderChangeMockups
            identity={run.resolvedIdentity}
            project={run.resolvedProject}
            beforeState={run.beforeState}
            obligations={run.obligations}
          />
          <ApprovalPanel
            plan={run.approvedPlan}
            approving={approving}
            blockers={run.blockers}
            onApprove={handleApprove}
          />
        </div>
      )}

      {run && (isExecuting || isTerminal) && run.resolvedIdentity && run.resolvedProject && (
        <div className="space-y-4">
          {isTerminal && <FinalStatusBanner status={run.status} onOpenReceipt={() => setShowReceipt(true)} />}
          <IdentitySummary identity={run.resolvedIdentity} project={run.resolvedProject} />
          {run.beforeState && <AccessMatrix access={run.beforeState.access} obligations={run.obligations} />}
          {run.beforeState && (
            <ProviderChangeMockups
              identity={run.resolvedIdentity}
              project={run.resolvedProject}
              beforeState={run.beforeState}
              obligations={run.obligations}
            />
          )}
          <ExecutionTimeline events={run.events} obligations={run.obligations} />
          <InvariantList invariants={run.invariantResults} />
          {isTerminal && (
            <button onClick={reset} className="text-xs text-blue hover:underline">
              Start a new request
            </button>
          )}
        </div>
      )}

      {showReceipt && runId && <ReceiptDrawer runId={runId} onClose={() => setShowReceipt(false)} />}
    </div>
  );
}
