import { NextResponse } from "next/server";
import { z } from "zod";
import { runPreflight } from "@/core/preflight";
import { CompiledIntentSchema } from "@/core/domain";
import { logger } from "@/lib/logger";

const BodySchema = z.object({
  instruction: z.string().min(1).max(2000),
  // Set when the conversational intake flow (/api/intent-chat) already
  // compiled the intent — skips the internal one-shot compile step, but
  // identity/project are still independently resolved against real
  // providers exactly as for any other run.
  compiledIntent: CompiledIntentSchema.optional(),
});

export async function POST(req: Request) {
  const json = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body.", issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const result = await runPreflight(parsed.data.instruction, parsed.data.compiledIntent);
    return NextResponse.json(result);
  } catch (err) {
    logger.error(undefined, "POST /api/preflight failed", { error: String(err) });
    return NextResponse.json({ error: "Preflight failed unexpectedly. See server logs." }, { status: 500 });
  }
}
