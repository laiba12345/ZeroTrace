import { z } from "zod";

// Single validated configuration module. Fails fast at startup (first import)
// with a safe list of missing variables — no secret values are ever logged.

// `.env` files commonly leave unset secrets as `KEY=` (empty string) rather
// than omitting the line entirely. An empty string is not the same value as
// "unset" to a plain `.optional()` string schema, so every optional secret
// below is preprocessed to treat "" as undefined.
const optionalSecret = () =>
  z.preprocess((v) => (v === "" ? undefined : v), z.string().min(1).optional());

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1),

  LLM_PROVIDER: z.enum(["anthropic", "openai"]).default("anthropic"),
  LLM_API_KEY: optionalSecret(),
  LLM_MODEL: z.string().min(1).default("claude-sonnet-5"),

  GITHUB_API_BASE_URL: z.string().url().default("https://api.github.com"),
  GITHUB_TOKEN: optionalSecret(),
  GITHUB_ORG: optionalSecret(),

  SLACK_API_BASE_URL: z.string().url().default("https://slack.com/api"),
  SLACK_BOT_TOKEN: optionalSecret(),

  GOOGLE_DRIVE_API_BASE_URL: z.string().url().default("https://www.googleapis.com"),
  GOOGLE_CLIENT_ID: optionalSecret(),
  GOOGLE_CLIENT_SECRET: optionalSecret(),
  GOOGLE_REFRESH_TOKEN: optionalSecret(),

  INTENT_CONFIDENCE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.9),
  PROVIDER_READ_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),

  ZEROTRACE_OPERATOR_SESSION_SECRET: optionalSecret(),
});

export type Env = z.infer<typeof EnvSchema>;

function loadEnv(): Env {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const missing = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(
      `ZeroTrace configuration is invalid or incomplete. Missing/invalid variables: ${missing}. ` +
        `Copy .env.example to .env and fill in the required values.`
    );
  }
  return parsed.data;
}

let cached: Env | undefined;

export function getEnv(): Env {
  if (!cached) cached = loadEnv();
  return cached;
}

// Providers whose credentials are present — used by the connection gate to
// report "disconnected" honestly instead of attempting a call with no token.
export function credentialStatus(env: Env) {
  return {
    github: Boolean(env.GITHUB_TOKEN),
    slack: Boolean(env.SLACK_BOT_TOKEN),
    drive: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_REFRESH_TOKEN),
    llm: Boolean(env.LLM_API_KEY),
  };
}
