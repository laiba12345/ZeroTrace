# ZeroTrace

**Zero remaining access. Zero destroyed history. Zero false success.**

ZeroTrace revokes a departing person's access to one project across GitHub, Slack, and Google Drive — and proves it. It reads every provider again after mutating, verifies the removal independently of the write response, and refuses to report success unless every required postcondition was actually confirmed.

## Why this exists

Offboarding tools typically report success from an HTTP 200. That is not proof: a token can be revoked by the write call and still show up in a stale read, a mutation can silently fail with a 2xx-wrapped error, and "remove from Project X" can accidentally cascade into deleting messages, commits, or files the person authored. ZeroTrace treats *proof* as the product: every claim it shows an operator is backed by an evidence record captured from an independent, post-mutation read of the provider's own API.

## Architecture overview

One Next.js (App Router) application. See [docs/architecture.md](docs/architecture.md) for the full picture and a diagram; in short:

```
Operator instruction (conversational — ZeroTrace asks if anything's missing)
  → compile-intent (schema-constrained LLM turns, never guesses identity)
  → resolve identity/project (exact provider IDs, never fuzzy)
  → preflight (read current access + capture preservation snapshot)
  → human approval (explicit, binds an approval token to a plan hash)
  → execute: per provider → READ → SCOPE LOCK → REVOKE → READ BACK → VERIFY
  → determineWorkflowStatus (pure function, no LLM)
  → Revocation Receipt (rendered from persisted evidence)
```

Key modules:

- `src/core/compile-intent.ts` — the only place that calls an LLM, constrained to a fixed JSON schema (`src/core/domain.ts`), rejects anything outside `REVOKE_PROJECT_ACCESS`. Supports a one-shot mode (a complete instruction in one call) and a conversational mode (`POST /api/intent-chat`) that asks a clarifying question — most commonly for an exact email — instead of guessing or blocking outright; either way the compiled intent is re-verified against real providers, never trusted as identity on its own.
- `src/core/scope-lock.ts` — deterministic policy function every mutation must pass; denies anything outside the approved plan, allowlisted action types, or current plan hash.
- `src/core/preflight.ts`, `src/core/execute.ts`, `src/core/verify.ts` — the read → approve → mutate → verify lifecycle.
- `src/core/determine-status.ts` — pure, priority-ordered status derivation (`SAFETY_VIOLATION > BLOCKED > INCOMPLETE > UNVERIFIED > COMPLETE`). No LLM anywhere near this file.
- `src/providers/{github,slack,drive}.ts` — real adapters (Octokit, `@slack/web-api`, `googleapis`) implementing the shared `AccessProvider` contract in `src/providers/types.ts`. No mocks.
- `src/core/evidence.ts` — every provider read/mutation that matters is recorded as a redacted, hashed `EvidenceRecord`.

## Setup

```bash
npm install
cp .env.example .env   # fill in credentials — see below
npx prisma generate
npx prisma db push     # creates prisma/dev.db (SQLite)
npm run dev
```

The app runs at `http://localhost:3000`.

> **Note on the `prisma` CLI:** if `npx prisma generate` fails with `CLI.UNKNOWN_COMMAND`, an npm registry resolved a pre-release `prisma@8` "Composer" build instead of the classic CLI. This repo pins `prisma`/`@prisma/client` to `^6.19.3` in `package.json`; run `npm install` again if your lockfile drifted.

### Provider credential / sandbox setup

ZeroTrace refuses to fake a connection — the header's provider badges call `/api/connections`, which performs a real, harmless read against each provider (`users.getAuthenticated`, `auth.test`, `about.get`). Until real credentials are present, all three show **disconnected**, and the offboarding request input stays disabled by design (Phase A — Connection Gate). This is expected, not a bug: **do not weaken the gate to make the demo run without credentials.**

Fill in `.env`:

| Variable | How to get it |
| --- | --- |
| `LLM_PROVIDER` + `LLM_API_KEY` | `LLM_PROVIDER` is `anthropic` (default) or `openai`; `LLM_API_KEY` is a key for whichever you pick (`LLM_MODEL` must match — e.g. `claude-sonnet-5` vs `gpt-4o-mini`). Without a key, every run is `BLOCKED: INTENT_COMPILER_UNAVAILABLE` — fallback parsing never authorizes a mutation, even for the pre-seeded demo sentence. |
| `GITHUB_TOKEN` | A fine-grained PAT (or sandbox-org OAuth token) with `repo`, `read:org`, and collaborator-management scopes on the sandbox org. |
| `GITHUB_ORG` | The sandbox GitHub org that owns the `phoenix`/`apollo` repos. |
| `SLACK_BOT_TOKEN` | A bot token (`xoxb-…`) for a sandbox Slack workspace, with `channels:read`, `groups:read`, `channels:history`, `groups:history`, `users:read`, `users:read.email`, and `conversations.kick`-capable scopes (`channels:manage`/`groups:write`). |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REFRESH_TOKEN` | An OAuth client (Drive API scope `https://www.googleapis.com/auth/drive`) authorized against a sandbox Google account that owns the Phoenix/Apollo folders. |

Then seed the sandbox data (Alice, Bob, Phoenix, Apollo) automatically:

```bash
npx tsx scripts/seed.mts
```

This needs a few more `.env` values beyond the provider credentials above — `ALICE_EMAIL`/`ALICE_NAME`/`ALICE_GITHUB_LOGIN`, `BOB_EMAIL`/`BOB_NAME`/`BOB_GITHUB_LOGIN` — because Alice and Bob must be real accounts you control (the script creates the repos/channels/files and shares them, but can't create GitHub/Slack/Google identities). See [scripts/seed-sandbox.md](scripts/seed-sandbox.md) for what it creates, what it can't automate, and the manual fallback. See [scripts/run-real-validation.md](scripts/run-real-validation.md) for the five real validation runs.

## Running the five real validation runs

ZeroTrace does not ship a self-authored test suite — verification is core runtime behavior, not a test substitute. Instead, run the five scenarios in [scripts/run-real-validation.md](scripts/run-real-validation.md) against real sandbox state and record the outcomes in [docs/integration-evidence.md](docs/integration-evidence.md).

## Deploying (Vercel)

ZeroTrace can trigger real provider mutations, so a public deployment needs two things the default local setup doesn't:

1. **A hosted Postgres database.** SQLite's single-file database doesn't survive between invocations of a serverless function. `prisma/schema.prisma` already targets `postgresql` — provision any Postgres (Vercel's own Postgres storage integration, Neon, Supabase, Railway all work) and set `DATABASE_URL` to it. If your provider offers a "pooled"/`pgbouncer` connection string, prefer that one. Push the schema once: `npx prisma db push`.
2. **`ZEROTRACE_OPERATOR_SESSION_SECRET`.** Set this to a strong random string. It gates the entire app behind a single shared passcode (`/login`) — without it, anyone with the URL could submit real offboarding requests against your connected providers.

Then:

1. Push this repo to GitHub (if you haven't already).
2. On [vercel.com](https://vercel.com), **Add New → Project**, import the repo.
3. Under **Environment Variables**, add every variable from `.env.example` that you use (`DATABASE_URL`, `ZEROTRACE_OPERATOR_SESSION_SECRET`, `LLM_PROVIDER`/`LLM_API_KEY`/`LLM_MODEL`, `GITHUB_TOKEN`/`GITHUB_ORG`, `SLACK_BOT_TOKEN`, `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`/`GOOGLE_REFRESH_TOKEN`) — paste the real values, not the example placeholders. `NEXT_PUBLIC_DEMO_INSTRUCTION` is optional; the `ALICE_*`/`BOB_*` seed-only variables are not needed at runtime.
4. Deploy. Vercel runs `npm install` (which generates the Prisma client via `postinstall`) then `next build` automatically — no extra build configuration needed.
5. Visit the deployed URL, sign in with your `ZEROTRACE_OPERATOR_SESSION_SECRET` passcode at `/login`, and confirm the connection gate shows all three providers connected.

## Safety warning

This is a hackathon-scoped reference implementation. **Do not point it at a production identity provider, a real employee, or a real project without an independent security review.** It is designed to fail closed (block rather than guess), but it has not been audited, and provider adapter edge cases (pagination limits, rate limits under load, org-specific permission models) are handled to the depth the six-hour build budget allowed, not exhaustively.
