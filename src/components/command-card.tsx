"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";

// Overridable per-deployment so the one-click preset matches whatever
// subject/email was actually seeded (identity is never inferred from a name
// alone — see core/preflight.ts — so the preset needs a real email to work
// end-to-end). NEXT_PUBLIC_ vars are inlined at build time by Next.js.
const DEMO_INSTRUCTION =
  process.env.NEXT_PUBLIC_DEMO_INSTRUCTION ??
  "Alice's contract ended. Remove her from Project Phoenix everywhere, but preserve everything she created and keep her access to unrelated projects.";

export function CommandCard({
  disabled,
  onSubmit,
  submitting,
}: {
  disabled?: boolean;
  submitting?: boolean;
  onSubmit: (instruction: string) => void;
}) {
  const [value, setValue] = useState("");

  return (
    <Card>
      <CardHeader>
        <CardTitle>Offboarding request</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Describe who is leaving and which project to revoke access from…"
          rows={3}
          disabled={disabled}
          aria-label="Offboarding instruction"
          className="w-full resize-none rounded-md border border-border-strong bg-surface-raised px-3 py-2.5 text-sm text-foreground placeholder:text-muted-2 focus:outline-none focus:ring-2 focus:ring-blue/40 disabled:opacity-50"
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            disabled={disabled}
            onClick={() => setValue(DEMO_INSTRUCTION)}
            className="text-xs text-blue hover:underline disabled:opacity-50"
          >
            Use demo preset (Alice → Phoenix)
          </button>
          <Button
            disabled={disabled || submitting || value.trim().length === 0}
            onClick={() => onSubmit(value.trim())}
          >
            {submitting ? "Analyzing…" : "Analyze request"}
          </Button>
        </div>
        <p className="text-xs text-muted-2">No access changes occur before approval.</p>
      </CardContent>
    </Card>
  );
}
