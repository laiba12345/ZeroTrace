# ZeroTrace — System & Reliability Brief

**Zero remaining access. Zero destroyed history. Zero false success.**

This is the short standalone brief. Full detail lives in [docs/architecture.md](docs/architecture.md) (system design, with a diagram) and [docs/integration-evidence.md](docs/integration-evidence.md) (real validation-run results) — this document pulls out what a reviewer needs without reading either in full.

## What it does

ZeroTrace revokes a departing person's access to **one named project** across GitHub, Slack, and Google Drive, and proves it — rather than reporting success from an HTTP 200. It reads every provider again after mutating, verifies the removal independently of the write response, and refuses to say "complete" unless every required postcondition was actually confirmed.

## System design, in five stages

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

Four design decisions carry the reliability claim:

1. **AI understands, code decides.** The only LLM call in the system exists to turn a plain-English request into a strict, schema-validated intent — every downstream decision (who gets resolved, what gets touched, whether the run succeeded) is made by deterministic code. When something's ambiguous, like an email, ZeroTrace simply asks a clarifying question in conversation, the same way a careful human operator would.
2. **Scope Lock guards every mutation.** Before any write reaches GitHub, Slack, or Drive, a deterministic policy engine confirms it matches the approved plan exactly — right person, right resource, right plan hash, an allowlisted operation only. This is the mechanism that makes narrow, surgical revocation possible instead of a blunt account-wide action.
3. **Every claim is independently verified.** ZeroTrace reads the provider's live state back after every mutation and confirms it directly — "verified" always means independently re-confirmed, not just attempted.
4. **Success is earned, not assumed.** Final status is computed by a deterministic priority engine over verified evidence — a run only reaches `COMPLETE` when every obligation is truly satisfied and every safety invariant holds, across every connected provider.

## Reliability evidence

Validation scenarios were run for real against a live sandbox (real GitHub org, real Slack workspace, real Google Drive account — not mocks, not Arga twins) and independently re-verified against each provider's own API, not just ZeroTrace's own receipt:

| Run | Proves | Result |
| --- | --- | --- |
| Complete revocation | Real cross-provider revocation + independent read-back | `COMPLETE` — confirmed via direct GitHub/Slack/Drive API calls outside the app |
| Blast-radius containment | An unrelated project and another user are untouched | `COMPLETE` — unrelated access and the control user's access verified byte-identical before/after |
| Idempotency | Re-running a completed request sends zero mutations | `COMPLETE` — all obligations `NOT_NEEDED`, empty operation ledger |
| Ambiguity block | A genuinely ambiguous project name blocks before any mutation | `BLOCKED` — exact candidates named, zero mutations sent |

**Real bugs were found and fixed during validation**, not just anticipated in design — evidence the verification loop does real work rather than rubber-stamping: a spec-compliance bug where the LLM-unavailable fallback could silently authorize a run instead of always blocking; a database constraint that broke legitimate retries; a GitHub search-API quirk that 422'd on some token/repo combinations; a system prompt that mis-flagged ordinary requests as out-of-scope. Full list in `docs/integration-evidence.md`.
