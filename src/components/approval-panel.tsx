"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { providerLabel } from "./status";
import type { ApprovedPlanView } from "@/lib/client-types";

export function ApprovalPanel({
  plan,
  onApprove,
  approving,
  blockers,
}: {
  plan: ApprovedPlanView;
  approving?: boolean;
  blockers: string[];
  onApprove: () => void;
}) {
  const [acknowledged, setAcknowledged] = useState(false);
  const hasWarnings = blockers.length > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Impact summary</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-3 gap-4 text-center">
          <div className="rounded-md border border-border-strong bg-surface-raised py-3">
            <div className="text-2xl font-semibold text-foreground">{plan.mutationCount}</div>
            <div className="text-xs text-muted-2">access revocation{plan.mutationCount === 1 ? "" : "s"}</div>
          </div>
          <div className="rounded-md border border-border-strong bg-surface-raised py-3">
            <div className="text-2xl font-semibold text-emerald">{plan.deletionCount}</div>
            <div className="text-xs text-muted-2">content deletions</div>
          </div>
          <div className="rounded-md border border-border-strong bg-surface-raised py-3">
            <div className="text-2xl font-semibold text-foreground">
              {3 - plan.targets.length >= 0 ? 3 - plan.targets.length : 0}
            </div>
            <div className="text-xs text-muted-2">providers already clean</div>
          </div>
        </div>

        <ul className="space-y-1.5 text-sm">
          {plan.targets.map((t) => (
            <li key={t.provider} className="flex items-center justify-between rounded-md bg-surface-raised px-3 py-2">
              <span className="text-foreground">{providerLabel(t.provider)}</span>
              <span className="font-evidence text-xs text-muted">{t.resourceId}</span>
            </li>
          ))}
          {plan.targets.length === 0 && (
            <li className="rounded-md bg-surface-raised px-3 py-2 text-xs text-muted">
              No mutations required — subject already has no access in any provider.
            </li>
          )}
        </ul>

        {hasWarnings && (
          <div className="rounded-md border border-amber/30 bg-amber-dim px-3 py-2 text-xs text-amber">
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(e) => setAcknowledged(e.target.checked)}
                className="mt-0.5"
              />
              <span>I acknowledge: {blockers.join(" ")}</span>
            </label>
          </div>
        )}

        <Button
          className="w-full"
          disabled={approving || (hasWarnings && !acknowledged)}
          onClick={onApprove}
        >
          {approving ? "Approving…" : `Approve ${plan.mutationCount} revocation${plan.mutationCount === 1 ? "" : "s"}`}
        </Button>
      </CardContent>
    </Card>
  );
}
