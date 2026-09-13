// Strips anything token-shaped or auth-header-shaped before a payload is
// logged or persisted as evidence. Evidence stores normalized facts
// (IDs, counts, timestamps, checksums) — never raw provider bodies.

const SENSITIVE_KEYS = new Set([
  "authorization",
  "token",
  "access_token",
  "refresh_token",
  "bot_token",
  "client_secret",
  "api_key",
  "password",
  "secret",
  "cookie",
  "set-cookie",
]);

export function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    out[key] = SENSITIVE_KEYS.has(key.toLowerCase()) ? "[REDACTED]" : value;
  }
  return out;
}

export function redactDeep(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[TRUNCATED]";
  if (Array.isArray(value)) return value.map((v) => redactDeep(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SENSITIVE_KEYS.has(key.toLowerCase()) ? "[REDACTED]" : redactDeep(v, depth + 1);
    }
    return out;
  }
  return value;
}

// Body text fields (Slack message text, file contents, email bodies) are
// dropped entirely rather than redacted-in-place — evidence never needs
// the content, only stable IDs/counts/checksums that prove preservation.
export function dropBodyFields<T extends Record<string, unknown>>(
  obj: T,
  fields: (keyof T)[]
): Omit<T, (typeof fields)[number]> {
  const clone = { ...obj };
  for (const f of fields) delete clone[f];
  return clone;
}
