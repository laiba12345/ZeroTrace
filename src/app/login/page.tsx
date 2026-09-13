"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passcode }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Could not sign in.");
        return;
      }
      router.push(searchParams.get("from") || "/");
      router.refresh();
    } catch {
      setError("Could not reach ZeroTrace's server.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>ZeroTrace</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-4 text-xs text-muted">This deployment is protected — enter the operator passcode.</p>
          <form onSubmit={handleSubmit} className="space-y-3">
            <input
              type="password"
              value={passcode}
              onChange={(e) => setPasscode(e.target.value)}
              placeholder="Passcode"
              autoFocus
              aria-label="Operator passcode"
              className="w-full rounded-md border border-border-strong bg-surface-raised px-3 py-2.5 text-sm text-foreground placeholder:text-muted-2 focus:outline-none focus:ring-2 focus:ring-blue/40"
            />
            {error && <p className="text-xs text-red">{error}</p>}
            <Button type="submit" className="w-full" disabled={submitting || passcode.length === 0}>
              {submitting ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
