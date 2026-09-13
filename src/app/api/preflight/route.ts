import { NextResponse } from "next/server";
import { z } from "zod";
import { runPreflight } from "@/core/preflight";
import { logger } from "@/lib/logger";

const BodySchema = z.object({
  instruction: z.string().min(1).max(2000),
});

export async function POST(req: Request) {
  const json = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body.", issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const result = await runPreflight(parsed.data.instruction);
    return NextResponse.json(result);
  } catch (err) {
    logger.error(undefined, "POST /api/preflight failed", { error: String(err) });
    return NextResponse.json({ error: "Preflight failed unexpectedly. See server logs." }, { status: 500 });
  }
}
