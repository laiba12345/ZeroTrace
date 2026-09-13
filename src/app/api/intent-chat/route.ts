import { NextResponse } from "next/server";
import { z } from "zod";
import { compileIntentChatTurn } from "@/core/compile-intent";
import { logger } from "@/lib/logger";

const BodySchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(2000),
      })
    )
    .min(1)
    .max(40),
});

// One turn of the conversational intake flow. Stateless — the client resends
// the full message history each turn. Never mutates anything; the only
// output is either a clarifying question or a compiled intent the client
// then submits to /api/preflight (which still independently resolves
// identity/project against real providers regardless of chat confidence).
export async function POST(req: Request) {
  const json = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body.", issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const result = await compileIntentChatTurn(parsed.data.messages);
    return NextResponse.json(result);
  } catch (err) {
    logger.error(undefined, "POST /api/intent-chat failed", { error: String(err) });
    return NextResponse.json({ error: "Intent chat failed unexpectedly." }, { status: 500 });
  }
}
