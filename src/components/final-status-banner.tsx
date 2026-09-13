import { WORKFLOW_BANNER } from "./status";
import { Button } from "./ui/button";

const TONE_BORDER: Record<string, string> = {
  emerald: "border-emerald/40 bg-emerald-dim",
  amber: "border-amber/40 bg-amber-dim",
  red: "border-red/40 bg-red-dim",
  blue: "border-blue/40 bg-blue-dim",
  neutral: "border-border-strong bg-surface-raised",
};

const TONE_TEXT: Record<string, string> = {
  emerald: "text-emerald",
  amber: "text-amber",
  red: "text-red",
  blue: "text-blue",
  neutral: "text-foreground",
};

export function FinalStatusBanner({ status, onOpenReceipt }: { status: string; onOpenReceipt: () => void }) {
  const banner = WORKFLOW_BANNER[status] ?? WORKFLOW_BANNER.DRAFT;
  return (
    <div className={`rounded-lg border px-5 py-4 ${TONE_BORDER[banner.tone]}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className={`text-lg font-bold tracking-wide ${TONE_TEXT[banner.tone]}`}>{banner.label}</div>
          {banner.sub && <div className="text-sm text-muted">{banner.sub}</div>}
        </div>
        <Button variant="secondary" size="sm" onClick={onOpenReceipt}>
          Open Revocation Receipt
        </Button>
      </div>
    </div>
  );
}
