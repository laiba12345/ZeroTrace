import { NextResponse } from "next/server";
import { z } from "zod";
import { getEnv } from "@/lib/env";

const BodySchema = z.object({ passcode: z.string().min(1) });
const SESSION_COOKIE = "zt_session";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days

export async function POST(req: Request) {
  const env = getEnv();
  if (!env.ZEROTRACE_OPERATOR_SESSION_SECRET) {
    // No gate configured (local/dev) — nothing to authenticate against.
    return NextResponse.json({ error: "No operator session is configured for this deployment." }, { status: 400 });
  }

  const json = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  if (parsed.data.passcode !== env.ZEROTRACE_OPERATOR_SESSION_SECRET) {
    return NextResponse.json({ error: "Incorrect passcode." }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, env.ZEROTRACE_OPERATOR_SESSION_SECRET, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
  return res;
}
