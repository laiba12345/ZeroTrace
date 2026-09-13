import { randomUUID, randomBytes, createHash } from "node:crypto";

export function newRunId(): string {
  return `run_${randomUUID()}`;
}

export function newReceiptId(): string {
  return `rcpt_${randomUUID()}`;
}

export function newEvidenceId(): string {
  return `ev_${randomUUID()}`;
}

export function newApprovalToken(): string {
  return randomBytes(32).toString("base64url");
}

// Canonicalizes an object (sorted keys, stable stringify) before hashing so
// the same logical plan always hashes identically regardless of key order.
export function canonicalize(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b)
    );
    return Object.fromEntries(entries.map(([k, v]) => [k, sortKeysDeep(v)]));
  }
  return value;
}

export function hashCanonical(value: unknown): string {
  return createHash("sha256").update(canonicalize(value)).digest("hex");
}

// Derives a stable idempotency key from the normalized inputs that define
// "the same request" — independent of run ID, timestamps, or wording.
export function deriveIdempotencyKey(input: {
  subjectEmail: string;
  projectSlug: string;
  actionType: string;
  approvedResourceIds: string[];
}): string {
  return hashCanonical({
    subjectEmail: input.subjectEmail.trim().toLowerCase(),
    projectSlug: input.projectSlug.trim().toLowerCase(),
    actionType: input.actionType,
    approvedResourceIds: [...input.approvedResourceIds].sort(),
  });
}
