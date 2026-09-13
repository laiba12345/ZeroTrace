"use client";

import { useEffect, useRef } from "react";

const TERMINAL_STATUSES = new Set(["COMPLETE", "INCOMPLETE", "UNVERIFIED", "BLOCKED", "SAFETY_VIOLATION"]);

// Subscribes to the run's SSE event stream and calls onUpdate (a refetch of
// the full run detail) whenever a new event or status lands, so the UI never
// predicts a future state — it only ever reflects rows already persisted.
export function useRunStream(runId: string | null, onUpdate: () => void) {
  const onUpdateRef = useRef(onUpdate);
  useEffect(() => {
    onUpdateRef.current = onUpdate;
  }, [onUpdate]);

  useEffect(() => {
    if (!runId) return;
    const source = new EventSource(`/api/runs/${runId}/events`);

    source.addEventListener("run-event", () => onUpdateRef.current());
    source.addEventListener("run-status", (evt) => {
      onUpdateRef.current();
      try {
        const data = JSON.parse((evt as MessageEvent).data);
        if (TERMINAL_STATUSES.has(data.status)) {
          source.close();
        }
      } catch {
        // ignore malformed event
      }
    });
    source.onerror = () => {
      // EventSource auto-reconnects; nothing to do beyond letting it retry.
    };

    return () => source.close();
  }, [runId]);
}
