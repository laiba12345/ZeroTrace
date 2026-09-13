import type { BadgeTone } from "./ui/badge";

export function obligationTone(status: string): BadgeTone {
  switch (status) {
    case "VERIFIED":
    case "NOT_NEEDED":
      return "emerald";
    case "UNKNOWN":
    case "PENDING":
      return "amber";
    case "FAILED":
      return "red";
    case "BLOCKED":
      return "red";
    default:
      return "neutral";
  }
}

export function invariantTone(status: string): BadgeTone {
  if (status === "PASS") return "emerald";
  if (status === "FAIL") return "red";
  return "amber";
}

export function connectionTone(status: string): BadgeTone {
  if (status === "connected") return "emerald";
  if (status === "degraded") return "amber";
  return "red";
}

export const WORKFLOW_BANNER: Record<
  string,
  { label: string; tone: BadgeTone; sub: string }
> = {
  COMPLETE: { label: "OFFBOARDING COMPLETE", tone: "emerald", sub: "Every obligation verified. Every invariant holds." },
  INCOMPLETE: { label: "OFFBOARDING INCOMPLETE", tone: "amber", sub: "At least one required revocation failed." },
  UNVERIFIED: { label: "OFFBOARDING UNVERIFIED", tone: "amber", sub: "Final access state could not be independently confirmed." },
  BLOCKED: { label: "OFFBOARDING BLOCKED", tone: "red", sub: "ZeroTrace refused to mutate before safety could be established." },
  SAFETY_VIOLATION: { label: "SAFETY VIOLATION", tone: "red", sub: "A protected invariant did not hold." },
  DRAFT: { label: "DRAFT", tone: "neutral", sub: "" },
  PREFLIGHT_READY: { label: "AWAITING APPROVAL", tone: "blue", sub: "No access changes have occurred." },
  APPROVED: { label: "APPROVED", tone: "blue", sub: "Execution starting." },
  EXECUTING: { label: "EXECUTING", tone: "blue", sub: "Mutations and verification in progress." },
};

export function providerLabel(provider: string): string {
  if (provider === "github") return "GitHub";
  if (provider === "slack") return "Slack";
  if (provider === "drive") return "Google Drive";
  return provider;
}
