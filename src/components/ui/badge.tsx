import { cn } from "@/lib/utils";

export type BadgeTone = "emerald" | "amber" | "red" | "blue" | "neutral";

const TONE_CLASSES: Record<BadgeTone, string> = {
  emerald: "bg-emerald-dim text-emerald border-emerald/30",
  amber: "bg-amber-dim text-amber border-amber/30",
  red: "bg-red-dim text-red border-red/30",
  blue: "bg-blue-dim text-blue border-blue/30",
  neutral: "bg-surface-raised text-muted border-border-strong",
};

export function Badge({
  tone = "neutral",
  children,
  className,
  icon,
  ...rest
}: {
  tone?: BadgeTone;
  children: React.ReactNode;
  className?: string;
  icon?: React.ReactNode;
} & React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium tracking-wide",
        TONE_CLASSES[tone],
        className
      )}
      {...rest}
    >
      {icon}
      {children}
    </span>
  );
}
