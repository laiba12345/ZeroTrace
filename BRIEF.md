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

1. **The LLM's job ends at "understand the sentence."** `compile-intent.ts` is the only place an LLM is called, constrained to a fixed JSON schema. It cannot propose a provider call, cannot invent a missing email, and is never asked whether the workflow succeeded — that question never reaches it. If the operator's request is missing something (usually an exact email — identity is never inferred from a name alone), the conversational flow asks a follow-up question instead of guessing.
2. **Scope Lock is a deterministic gate every mutation must pass**, checked immediately before the call: approved plan hash, approved resource ID, approved subject, allowlisted operation type, fresh state matching preflight, never a content-deletion operation. A denial here becomes a `BLOCKED` obligation, not a mutation.
3. **Nothing is ever trusted from its own write response.** Every mutation is followed by an independent read-back against the provider's own API. Obligation status (`VERIFIED`/`FAILED`/`UNKNOWN`) comes only from that second read.
4. **Final status is pure math over stored facts**, evaluated in a fixed priority order — `SAFETY_VIOLATION > BLOCKED > INCOMPLETE > UNVERIFIED > COMPLETE`. One failed obligation or one `UNKNOWN` invariant caps the whole run below `COMPLETE`, regardless of how many other providers succeeded.

## Reliability evidence

Five validation scenarios were designed to stress different failure modes. **Four were run for real against a live sandbox** (real GitHub org, real Slack workspace, real Google Drive account — not mocks, not Arga twins) and **independently re-verified against each provider's own API**, not just ZeroTrace's own receipt:

| Run | Proves | Result |
| --- | --- | --- |
| 1. Complete revocation | Real cross-provider revocation + independent read-back | `COMPLETE` — confirmed via direct GitHub/Slack/Drive API calls outside the app |
| 3. Blast-radius containment | An unrelated project (Apollo) and another user (Bob) are untouched | `COMPLETE` — Apollo access and Bob's access verified byte-identical before/after |
| 4. Idempotency | Re-running a completed request sends zero mutations | `COMPLETE` — 3× `NOT_NEEDED`, empty operation ledger |
| 5. Ambiguity block | A genuinely ambiguous project name blocks before any mutation | `BLOCKED` — exact candidates named, zero mutations sent |

Run 2 (genuine partial failure — a Slack token missing scope) is the harder proof point: it's designed to make one provider actually fail, to prove the system reports `INCOMPLETE` honestly rather than quietly passing. See `docs/integration-evidence.md` for its current status and result.

**Real bugs were found and fixed during validation**, not just anticipated in design — evidence the verification loop does real work rather than rubber-stamping: a spec-compliance bug where the LLM-unavailable fallback could silently authorize a run instead of always blocking; a database constraint that broke legitimate retries; a GitHub search-API quirk that 422'd on some token/repo combinations; a system prompt that mis-flagged ordinary requests as out-of-scope. Full list in `docs/integration-evidence.md`.

## What's honestly not done

- Two optional pieces of seed evidence (a GitHub issue and Slack messages "authored by" the test subject specifically) don't fully work due to a token-scoping limitation on that side account — non-blocking, since the required evidence (real commits, real files) already satisfies the preservation checks without them.
- This is a hackathon-scoped reference implementation, not an audited production system — see the Safety warning in `README.md`.
