import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { CompiledIntentSchema, type CompiledIntent } from "./domain";
import { getEnv, type Env } from "@/lib/env";
import { logger } from "@/lib/logger";

export type CompileIntentResult =
  | { ok: true; intent: CompiledIntent; source: "llm" }
  | {
      ok: false;
      reason: "LOW_CONFIDENCE" | "PARSE_FAILED" | "LLM_UNAVAILABLE";
      detail: string;
      /**
       * What was actually parsed (by the LLM, if confidence was too low; or
       * by the deterministic fallback, if the LLM was unavailable) — for
       * troubleshooting display only. Never used to authorize a run; the
       * run is always BLOCKED alongside it.
       */
      understoodIntent?: CompiledIntent;
    };

const SYSTEM_PROMPT = `You compile a natural-language access-offboarding instruction into a strict JSON object.

Context: the system this feeds always operates on exactly ONE named project, across all three of its connected providers (GitHub, Slack, and Google Drive) simultaneously — that is the normal, full scope of every request, not an expansion of it. An instruction naming some or all of those three providers for the one project being offboarded is NOT broader than supported; do not lower confidence or add an ambiguity for that. Likewise, phrases like "everywhere," "entirely," "completely," or "all access to Project X" — when clearly scoped to the one named project — mean "across all of that project's connected providers," which is exactly the supported action, NOT company-wide/every-project removal; do not treat that phrasing alone as broadening scope. Only flag something as broader than supported when the instruction explicitly asks for a DIFFERENT kind of action: deactivating the account entirely (independent of any project), removing access from more than one named project, or deleting/destroying content (messages, files, commits, issues).

Rules:
- You interpret intent only. Never propose API methods, URLs, or provider calls.
- Never infer a missing identity or project identifier — if the instruction is ambiguous, list it in "ambiguities" and lower "confidence".
- "preserveAuthoredContent" and "preserveUnrelatedAccess" are always true — this system never deletes authored content or removes access to projects that were not named.
- "requestedAction" is always the literal string "REVOKE_PROJECT_ACCESS". If the instruction asks for something genuinely broader per the Context above, do NOT expand scope to match it — instead set confidence low and add an ambiguity describing the mismatch between the request and the only supported action.
- Extract the subject's display name and email if present (email may be null if not stated).
- Extract the project's core name (strip generic filler words like "Project"/"the project" — e.g. "Project Phoenix" -> name "Phoenix") and a lowercase slug of that core name if it can be derived unambiguously, otherwise null.
- confidence is a number between 0 and 1 reflecting how certain you are that subject, project, and action are unambiguous. A clear, ordinary offboarding request naming a person and one project should score close to 1.0 — reserve low scores for instructions that are genuinely unclear or ask for something outside REVOKE_PROJECT_ACCESS.

Respond with ONLY a JSON object matching this exact shape, no prose, no markdown fences:
{
  "subject": { "displayName": string, "email": string | null, "aliases": string[] },
  "project": { "name": string, "slug": string | null },
  "requestedAction": "REVOKE_PROJECT_ACCESS",
  "preserveAuthoredContent": true,
  "preserveUnrelatedAccess": true,
  "confidence": number,
  "ambiguities": string[]
}`;

export async function compileIntent(rawInstruction: string): Promise<CompileIntentResult> {
  const env = getEnv();

  if (!env.LLM_API_KEY) {
    logger.warn(undefined, "compile-intent: LLM_API_KEY not configured, run will be blocked");
    return blockedWithDeterministicPreview(rawInstruction);
  }

  try {
    const rawText = await callLLM(env, rawInstruction);
    if (rawText === null) {
      return { ok: false, reason: "PARSE_FAILED", detail: "LLM response contained no text content." };
    }

    const jsonText = extractJson(rawText);
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(jsonText);
    } catch {
      return { ok: false, reason: "PARSE_FAILED", detail: "LLM response was not valid JSON." };
    }

    const parsed = CompiledIntentSchema.safeParse(parsedJson);
    if (!parsed.success) {
      return {
        ok: false,
        reason: "PARSE_FAILED",
        detail: `Structured output did not match the required schema: ${parsed.error.issues
          .map((i) => i.path.join("."))
          .join(", ")}`,
      };
    }

    if (parsed.data.confidence < env.INTENT_CONFIDENCE_THRESHOLD) {
      const ambiguityNote = parsed.data.ambiguities.length > 0 ? ` Ambiguities the model flagged: ${parsed.data.ambiguities.join("; ")}` : "";
      return {
        ok: false,
        reason: "LOW_CONFIDENCE",
        detail: `Confidence ${parsed.data.confidence} is below the configured threshold ${env.INTENT_CONFIDENCE_THRESHOLD}.${ambiguityNote}`,
        understoodIntent: parsed.data,
      };
    }

    return { ok: true, intent: parsed.data, source: "llm" };
  } catch (err) {
    logger.error(undefined, "compile-intent: LLM call failed", { error: String(err) });
    return blockedWithDeterministicPreview(rawInstruction);
  }
}

// Provider-agnostic by design (LLM_PROVIDER/LLM_API_KEY/LLM_MODEL are
// generic names) — intent compilation is one structured-output call with no
// provider-specific behavior, so either backend satisfies the same contract.
async function callLLM(env: Env, rawInstruction: string): Promise<string | null> {
  if (env.LLM_PROVIDER === "openai") {
    const client = new OpenAI({ apiKey: env.LLM_API_KEY });
    const response = await client.chat.completions.create({
      model: env.LLM_MODEL,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: rawInstruction },
      ],
    });
    return response.choices[0]?.message?.content ?? null;
  }

  const client = new Anthropic({ apiKey: env.LLM_API_KEY });
  const response = await client.messages.create({
    model: env.LLM_MODEL,
    max_tokens: 1024,
    temperature: 0,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: rawInstruction }],
  });
  const textBlock = response.content.find((b) => b.type === "text");
  return textBlock && textBlock.type === "text" ? textBlock.text : null;
}

function extractJson(text: string): string {
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) return fenceMatch[1].trim();
  return text.trim();
}

// The LLM is unavailable (no key configured, or the call failed). The run
// is ALWAYS blocked in this case — per the build spec, fallback parsing must
// never authorize mutations. For the single pre-seeded demo command only,
// we additionally surface what a deterministic parser *would* have
// understood, purely so the operator has something to troubleshoot against
// in the UI — it is never passed to resolution/preflight as a real intent.
const DEMO_INSTRUCTION_PATTERN =
  /alice.*(?:contract|offboard|leaving).*phoenix|phoenix.*alice/i;

function blockedWithDeterministicPreview(rawInstruction: string): CompileIntentResult {
  if (!DEMO_INSTRUCTION_PATTERN.test(rawInstruction)) {
    return {
      ok: false,
      reason: "LLM_UNAVAILABLE",
      detail: "The intent compiler is unavailable (no LLM_API_KEY configured) and this instruction does not match the pre-seeded demo command.",
    };
  }

  return {
    ok: false,
    reason: "LLM_UNAVAILABLE",
    detail:
      "The intent compiler is unavailable (no LLM_API_KEY configured). This looks like the pre-seeded demo command — " +
      "see understoodIntent for what a deterministic parser would extract — but the run is blocked regardless, " +
      "since fallback parsing never authorizes mutations. Configure LLM_API_KEY to run this for real.",
    understoodIntent: {
      subject: { displayName: "Alice Smith", email: null, aliases: [] },
      project: { name: "Phoenix", slug: "phoenix" },
      requestedAction: "REVOKE_PROJECT_ACCESS",
      preserveAuthoredContent: true,
      preserveUnrelatedAccess: true,
      confidence: 1,
      ambiguities: [],
    },
  };
}
