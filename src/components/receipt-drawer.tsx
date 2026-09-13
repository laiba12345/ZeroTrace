"use client";

import { useEffect, useState } from "react";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { obligationTone, invariantTone, providerLabel } from "./status";

type Receipt = {
  receiptId: string;
  runId: string;
  generatedAt: string;
  rawInstruction: string;
  subject: { displayName: string; canonicalEmail: string } | null;
  project: { canonicalName: string } | null;
  planHash: string | null;
  approvedAt: string | null;
  approvedBy: string | null;
  startedAt: string | null;
  completedAt: string | null;
  finalStatus: string;
  mutationCount: number;
  obligations: {
    provider: string;
    resourceId: string;
    status: string;
    mutationAttempted: boolean;
    error: { safeMessage: string } | null;
    evidence: { id: string; phase: string; assertion: string; result: string; payloadHash: string }[];
  }[];
  invariants: { name: string; provider: string; status: string; detail: string }[];
  operationLedger: { operationType: string; provider: string; targetId: string; result: string | null }[];
  blockers: string[];
};

export function ReceiptDrawer({ runId, onClose }: { runId: string; onClose: () => void }) {
  const [receipt, setReceipt] = useState<Receipt | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/receipts/${runId}`)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setReceipt(data);
      });
    return () => {
      cancelled = true;
    };
  }, [runId]);

  return (
    <div id="receipt-root" className="fixed inset-0 z-50 flex justify-end bg-black/60" role="dialog" aria-modal="true" aria-label="Revocation receipt">
      <div className="no-print flex-1" onClick={onClose} />
      <div className="receipt-printable h-full w-full max-w-2xl overflow-y-auto border-l border-border bg-surface p-6 sm:p-8">
        <div className="no-print mb-6 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">Revocation Receipt</h2>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={() => window.print()}>
              Print / Save as PDF
            </Button>
            <Button size="sm" variant="ghost" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>

        {!receipt ? (
          <p className="text-sm text-muted">Loading receipt…</p>
        ) : (
          <div className="space-y-6 text-sm">
            <header className="border-b border-border pb-4">
              <div className="font-evidence text-xs text-muted-2">{receipt.receiptId}</div>
              <div className="mt-1 text-muted-2">Run {receipt.runId}</div>
              <div className="mt-1 text-muted-2">Generated {new Date(receipt.generatedAt).toISOString()}</div>
            </header>

            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-2">Scope</h3>
              <p className="text-foreground">{receipt.subject?.displayName} ({receipt.subject?.canonicalEmail})</p>
              <p className="text-muted">Project: {receipt.project?.canonicalName}</p>
              <p className="mt-1 font-evidence text-xs text-muted-2">Plan hash: {receipt.planHash}</p>
            </section>

            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-2">Timeline</h3>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted">
                <dt>Approved</dt>
                <dd>{receipt.approvedAt ? new Date(receipt.approvedAt).toISOString() : "—"} {receipt.approvedBy ? `by ${receipt.approvedBy}` : ""}</dd>
                <dt>Started</dt>
                <dd>{receipt.startedAt ? new Date(receipt.startedAt).toISOString() : "—"}</dd>
                <dt>Completed</dt>
                <dd>{receipt.completedAt ? new Date(receipt.completedAt).toISOString() : "—"}</dd>
                <dt>Mutations performed</dt>
                <dd>{receipt.mutationCount}</dd>
              </dl>
            </section>

            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-2">
                Final status: {receipt.finalStatus}
              </h3>
            </section>

            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-2">Provider evidence</h3>
              <div className="space-y-3">
                {receipt.obligations.map((o) => (
                  <div key={o.provider} className="rounded-md border border-border-strong p-3">
                    <div className="mb-1 flex items-center justify-between">
                      <span className="text-foreground">{providerLabel(o.provider)}</span>
                      <Badge tone={obligationTone(o.status)}>{o.status}</Badge>
                    </div>
                    <div className="font-evidence text-xs text-muted-2">{o.resourceId}</div>
                    {o.error && <p className="mt-1 text-xs text-red">{o.error.safeMessage}</p>}
                    <ul className="mt-2 space-y-1">
                      {o.evidence.map((e) => (
                        <li key={e.id} className="font-evidence text-[11px] text-muted-2">
                          [{e.phase}] {e.assertion} — {e.result} ({e.id})
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </section>

            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-2">Invariant evidence</h3>
              <div className="space-y-1.5">
                {receipt.invariants.map((inv, idx) => (
                  <div key={idx} className="flex items-center justify-between rounded bg-surface-raised px-2 py-1.5 text-xs">
                    <span className="text-muted">
                      {inv.name} ({inv.provider})
                    </span>
                    <Badge tone={invariantTone(inv.status)}>{inv.status}</Badge>
                  </div>
                ))}
              </div>
            </section>

            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-2">Operation ledger</h3>
              <table className="w-full text-xs">
                <tbody>
                  {receipt.operationLedger.map((l, idx) => (
                    <tr key={idx} className="border-b border-border last:border-0">
                      <td className="py-1 pr-2 text-muted">{l.operationType}</td>
                      <td className="py-1 pr-2 font-evidence text-muted-2">{l.targetId}</td>
                      <td className="py-1 text-muted">{l.result}</td>
                    </tr>
                  ))}
                  {receipt.operationLedger.length === 0 && (
                    <tr>
                      <td className="py-1 text-muted-2">No mutations were sent.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </section>

            {receipt.blockers.length > 0 && (
              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-2">Manual remediation</h3>
                <ul className="list-disc space-y-1 pl-4 text-xs text-amber">
                  {receipt.blockers.map((b, idx) => (
                    <li key={idx}>{b}</li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
