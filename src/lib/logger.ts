import { redactDeep } from "./redact";

type LogLevel = "debug" | "info" | "warn" | "error";

// Server-only structured logger, keyed by runId. Redacts before it ever
// serializes — detailed logs stay on the server, never in the demo UI.
function log(level: LogLevel, runId: string | undefined, message: string, data?: unknown) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    runId: runId ?? null,
    message,
    data: data === undefined ? undefined : redactDeep(data),
  };
  const line = JSON.stringify(entry);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  debug: (runId: string | undefined, message: string, data?: unknown) =>
    log("debug", runId, message, data),
  info: (runId: string | undefined, message: string, data?: unknown) =>
    log("info", runId, message, data),
  warn: (runId: string | undefined, message: string, data?: unknown) =>
    log("warn", runId, message, data),
  error: (runId: string | undefined, message: string, data?: unknown) =>
    log("error", runId, message, data),
};
