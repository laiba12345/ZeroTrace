# Reliability brief

## Obligations

An `Obligation` is a per-provider unit of work: "the subject must have no access to the Phoenix resource." There is always exactly one per provider (three total), regardless of whether a mutation ends up being necessary — an already-clean provider still produces a `NOT_NEEDED` obligation backed by a fresh read, not an absent row. See `src/core/domain.ts#ObligationSchema` and `prisma/schema.prisma#Obligation`.

## Invariants

Five invariants are compiled and evaluated per run (`src/core/domain.ts#InvariantNames`):

1. `AUTHORED_HISTORY_PRESERVED` — commits/issues/PRs, messages, files authored by the subject still exist by stable ID after mutation.
2. `UNRELATED_PROJECT_ACCESS_PRESERVED` — access to projects that were not named (Apollo) is unchanged.
3. `OTHER_USERS_UNCHANGED` — every other member's access on the target resource is unchanged.
4. `ONLY_APPROVED_RESOURCES_TOUCHED` — the operation ledger touched only resource IDs in the approved plan (system-level, checked against `OperationLedgerEntry` rows).
5. `NO_CONTENT_DELETE_OPERATIONS_SENT` — every ledger entry's operation type is one of the three allowlisted revoke operations (system-level).

Invariants 1–3 are evaluated per-provider (9 rows); 4–5 are system-level (2 rows) — 11 `InvariantResult` rows per run. Each carries `evidenceIds` pointing at the before/after comparison that produced its verdict — a checkbox is never rendered without a backing `EvidenceRecord`.

## Evidence

Every fact rendered to the operator traces to an `EvidenceRecord` (`src/core/evidence.ts`), phased `BEFORE | MUTATION | AFTER | INVARIANT`. Evidence is redacted (`lib/redact.ts`) before it is ever serialized, and its canonicalized form is hashed (`lib/ids.ts#hashCanonical`) so the receipt can show a `payloadHash` an auditor could use to spot-check integrity without needing the raw (and potentially sensitive) payload.

## Least privilege

- The Scope Lock allowlist (`GITHUB_REVOKE_REPO_OR_PROJECT_TEAM_ACCESS`, `SLACK_REMOVE_CHANNEL_MEMBER`, `DRIVE_DELETE_PROJECT_PERMISSION`) is the only set of mutation types this codebase can ever send — there is no generic "call this provider method" path.
- GitHub team-inherited access is never auto-removed (see `github.ts#readProjectAccess`'s `removable: false` on `INHERITED` paths) — removing it would touch org-level team membership, which is out of scope for a single-repo offboarding request.
- Drive permissions inherited from a parent folder are likewise reported but not deleted (`drive.ts` checks `permissionDetails[].inherited`).

## Approval binding

An approval token is minted per-run (`lib/ids.ts#newApprovalToken`, 256 bits of randomness), returned once in the `POST /approve` response body, and never included in any subsequent `GET`. Execution requires the exact token; the `updateMany({where: {id, status: "APPROVED"}})` transition that starts execution is atomic at the SQL level, so it simultaneously (a) prevents two concurrent executions of the same run and (b) invalidates the token by moving the run out of `APPROVED` — a replayed token then fails the `run.status !== "APPROVED"` check.

## Partial-failure honesty

Each provider's mutation is wrapped so a failure (`mutation.succeeded === false`) never blocks the other two providers from running (`execute.ts#executeProvider` is called independently per provider in sequence, and a `FAILED` obligation does not throw). A Slack scope failure still leaves GitHub's `VERIFIED` obligation and evidence intact — the receipt shows genuinely mixed results rather than an all-or-nothing rollback narrative.

## Unknown-state handling

`verifyObligationPostcondition` and `verifyInvariants` both wrap their provider calls in `.catch()` and resolve to `UNKNOWN` / `postconditionMet: "UNKNOWN"` on any read failure — a verification timeout or transient error becomes an honest `UNKNOWN` obligation (→ workflow `UNVERIFIED`), never silently treated as either success or failure.

## Idempotency

`lib/ids.ts#deriveIdempotencyKey` hashes the normalized subject email, project slug, action type, and sorted approved resource IDs — independent of run ID or wording — and preflight always re-reads live provider state (`readProjectAccess`) rather than trusting a cached prior result. Re-running an already-complete request produces three `NOT_NEEDED` obligations (backed by fresh reads showing no access), zero new ledger entries, and a `COMPLETE` receipt explicitly stating zero mutations were performed.

## Blast-radius containment

Scope Lock's resourceId-membership check (`scope-lock.ts#isSameProject`) means a resolved resource that happens to share an ID pattern but belongs to an unapproved project cannot be mutated — project identity is enforced by plan membership captured at preflight, not re-derived at mutation time. Combined with the `ONLY_APPROVED_RESOURCES_TOUCHED` system invariant (checked against the operation ledger after execution), containment is checked twice: once before each mutation (preventively) and once after all mutations (as evidence).

## Reliability hardening added after initial validation

- **Provider read timeouts.** `PROVIDER_READ_TIMEOUT_MS` is wired into all three SDK clients (`AbortSignal.timeout()` for Octokit, `timeout` for `@slack/web-api`'s `WebClient`, `timeout` for `googleapis`/gaxios) — a hung provider request no longer blocks a run indefinitely.
- **Bounded exponential backoff for safe reads.** `lib/with-retry.ts` retries only read-only, idempotent calls (identity/project resolution, access reads, verification reads) on `429`/`5xx`/network-timeout errors, up to 3 attempts with jittered exponential delay. Mutation calls (`revokeProjectAccess`) are never retried automatically, per the no-blind-mutation-retry rule.
- **Reload no longer loses the run.** The run ID lives in the URL (`?run=<id>`); reloading the page, or sharing the link, reconstructs the full run view from `GET /api/runs/[id]` instead of dropping back to a blank command card.

## Current limitations

- GitHub's team-inherited-access detection assumes team `repos_count`/narrowness isn't independently re-verified before blocking; it always blocks rather than attempting a narrow team-membership removal, trading a slightly more conservative default for safety.
- The SSE endpoint (`app/api/runs/[runId]/events/route.ts`) polls the database every 750ms rather than using a push-based bus — adequate for a single-instance demo, not for a multi-instance deployment.
- Drive's "unrelated access" discovery relies on Drive's `'<email>' in writers` query operator working as documented for the service account/OAuth identity in use; some Workspace domain policies restrict this query for external Drive API callers.
- No operator authentication on the preflight/approve routes (only execution is bound to a one-time token) — fine for local/demo use, not for any networked deployment.
- No CSRF protection beyond the browser's default same-origin fetch behavior.
