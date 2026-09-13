import type { ProviderError, ProviderErrorCategory } from "@/providers/types";

export class ZeroTraceError extends Error {
  constructor(
    message: string,
    readonly code: string
  ) {
    super(message);
    this.name = "ZeroTraceError";
  }
}

export class PlanInvalidatedError extends ZeroTraceError {
  constructor(reason: string) {
    super(`Approved plan is no longer valid: ${reason}`, "PLAN_INVALIDATED");
  }
}

export class ScopeLockViolationError extends ZeroTraceError {
  constructor(reason: string) {
    super(`Scope Lock refused mutation: ${reason}`, "SCOPE_LOCK_VIOLATION");
  }
}

// Maps a raw thrown value from a provider SDK call into the typed taxonomy
// obligations render. Never lets a raw stack trace reach the UI.
export function classifyProviderError(err: unknown): ProviderError {
  if (err && typeof err === "object" && "category" in err && "safeMessage" in err) {
    return err as ProviderError;
  }

  const status = extractHttpStatus(err);
  const category = categorizeByStatus(status);

  return {
    category,
    providerCode: status ? String(status) : undefined,
    safeMessage: safeMessageFor(category),
  };
}

function extractHttpStatus(err: unknown): number | undefined {
  if (!err || typeof err !== "object") return undefined;
  const anyErr = err as Record<string, unknown>;
  if (typeof anyErr.status === "number") return anyErr.status;
  if (typeof anyErr.statusCode === "number") return anyErr.statusCode;
  const response = anyErr.response as Record<string, unknown> | undefined;
  if (response && typeof response.status === "number") return response.status;
  return undefined;
}

function categorizeByStatus(status: number | undefined): ProviderErrorCategory {
  if (status === 401) return "AUTH";
  if (status === 403) return "SCOPE";
  if (status === 404) return "NOT_FOUND";
  if (status === 409) return "CONFLICT";
  if (status === 429) return "RATE_LIMIT";
  if (status !== undefined && status >= 500) return "PROVIDER";
  if (status === undefined) return "NETWORK";
  return "PROVIDER";
}

function safeMessageFor(category: ProviderErrorCategory): string {
  switch (category) {
    case "AUTH":
      return "The provider rejected the credentials used for this connection.";
    case "SCOPE":
      return "The connected credential lacks the permission required for this action.";
    case "NOT_FOUND":
      return "The requested resource could not be found with the current credentials.";
    case "CONFLICT":
      return "The provider reported a conflicting state for this resource.";
    case "RATE_LIMIT":
      return "The provider rate-limited this request.";
    case "NETWORK":
      return "The request to the provider timed out or the network failed.";
    case "PROVIDER":
      return "The provider returned an unexpected error.";
  }
}
