"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import type { CompiledIntent } from "@/core/domain";

type ChatMessage = { role: "user" | "assistant"; content: string };

const DEMO_INSTRUCTION =
  process.env.NEXT_PUBLIC_DEMO_INSTRUCTION ??
  "Alice's contract ended. Remove her from Project Phoenix everywhere, but preserve everything she created and keep her access to unrelated projects.";

export function IntentChat({
  disabled,
  onCompiled,
}: {
  disabled?: boolean;
  onCompiled: (instruction: string, intent: CompiledIntent) => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [value, setValue] = useState("");
  const [sending, setSending] = useState(false);
  const [blocked, setBlocked] = useState<string | null>(null);

  async function send(text: string) {
    if (!text.trim() || sending) return;
    setBlocked(null);
    const nextMessages: ChatMessage[] = [...messages, { role: "user", content: text.trim() }];
    setMessages(nextMessages);
    setValue("");
    setSending(true);
    try {
      const res = await fetch("/api/intent-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: nextMessages }),
      });
      const data = await res.json();
      if (!res.ok) {
        setBlocked(data.error ?? "Something went wrong.");
        return;
      }
      if (data.action === "ASK") {
        setMessages([...nextMessages, { role: "assistant", content: data.question }]);
      } else if (data.action === "COMPILED") {
        const rawInstruction = nextMessages
          .filter((m) => m.role === "user")
          .map((m) => m.content)
          .join(" ");
        onCompiled(rawInstruction, data.intent);
      } else {
        setBlocked(data.detail ?? "The request could not be compiled.");
      }
    } catch {
      setBlocked("Could not reach ZeroTrace's server.");
    } finally {
      setSending(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Offboarding request</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {messages.length > 0 && (
          <div className="space-y-2 rounded-md border border-border-strong bg-surface-raised p-3">
            {messages.map((m, i) => (
              <div key={i} className={m.role === "user" ? "text-foreground" : "text-blue"}>
                <span className="mr-1.5 text-xs font-medium uppercase tracking-wide text-muted-2">
                  {m.role === "user" ? "You" : "ZeroTrace"}
                </span>
                <span className="text-sm">{m.content}</span>
              </div>
            ))}
            {sending && <p className="text-xs text-muted-2">Thinking…</p>}
          </div>
        )}

        {blocked && (
          <div className="rounded-md border border-red/30 bg-red-dim px-3 py-2 text-xs text-red">{blocked}</div>
        )}

        <div className="flex gap-2">
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(value);
              }
            }}
            placeholder={
              messages.length === 0
                ? "Describe who is leaving and which project to revoke access from…"
                : "Reply…"
            }
            disabled={disabled || sending}
            aria-label="Offboarding instruction"
            className="w-full rounded-md border border-border-strong bg-surface-raised px-3 py-2.5 text-sm text-foreground placeholder:text-muted-2 focus:outline-none focus:ring-2 focus:ring-blue/40 disabled:opacity-50"
          />
          <Button disabled={disabled || sending || value.trim().length === 0} onClick={() => send(value)}>
            {sending ? "…" : messages.length === 0 ? "Analyze request" : "Send"}
          </Button>
        </div>

        {messages.length === 0 && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => setValue(DEMO_INSTRUCTION)}
            className="text-xs text-blue hover:underline disabled:opacity-50"
          >
            Use demo preset (Alice → Phoenix)
          </button>
        )}

        <p className="text-xs text-muted-2">
          No access changes occur before approval. ZeroTrace will ask if anything needed is missing — most often an
          exact email, since identity is never guessed from a name alone.
        </p>
      </CardContent>
    </Card>
  );
}
