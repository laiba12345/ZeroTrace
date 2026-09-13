# Real validation runbook

Five scenarios, run against the sandbox data from `scripts/seed-sandbox.md`. This replaces a conventional automated test suite — ZeroTrace's own read-back verification is the thing being validated, so these runs must hit real provider state, not mocks. After each, copy the actual observed results into `docs/integration-evidence.md` (never write expected/aspirational results there).

Before starting: `GET /api/connections` must show all three providers `connected`.

## Run 1 — Complete revocation

1. Reset sandbox to the seeded state (Alice has direct access in all three providers).
2. Submit the demo preset instruction, review preflight, click Approve.
3. Watch the execution timeline reach `VERIFIED` for all three providers.
4. Independently confirm in each provider's own UI (not just ZeroTrace's receipt): Alice is not a `phoenix` collaborator, not a member of `phoenix-private`, has no permission on the `Phoenix` Drive folder.
5. Confirm Alice's commits/issue, Slack messages, and Drive files are all still present; Apollo access for Alice is unchanged; Bob's Phoenix access is unchanged.
6. Expect: workflow `COMPLETE`.

## Run 2 — Genuine partial failure

1. Reset sandbox. Swap `SLACK_BOT_TOKEN` to the reduced-scope token (see seed runbook step 5 under Slack).
2. Restart the dev server (env vars are read at process start) so the new token takes effect.
3. Run the same approved workflow.
4. Expect: GitHub `VERIFIED`, Slack `FAILED` with a real `missing_scope` (or similar) error surfaced in the obligation's `errorSafeMessage`, Drive `VERIFIED`, workflow `INCOMPLETE`. The receipt must explicitly show Alice still has Slack access.
5. Restore the full-scope Slack token afterward.

## Run 3 — Blast-radius containment

1. Reset sandbox (Alice has Phoenix + Apollo access; Bob has Phoenix access).
2. Run the approved workflow to completion.
3. Confirm: Alice's Apollo access is identical before/after (same permission level/collaborator entry). Bob's Phoenix access is identical before/after. Query the run's operation ledger (`GET /api/runs/[runId]` → `operationLedger`) and confirm exactly 3 entries, all targeting only the approved Phoenix resource IDs.

## Run 4 — Idempotency

1. Immediately after Run 1 completes (do not reset sandbox), submit the exact same instruction again.
2. Expect preflight to show 0 predicted mutations (all three providers already show no access).
3. Approve and execute.
4. Expect: 3 obligations `NOT_NEEDED`, all invariants `PASS`, workflow `COMPLETE`, and the receipt states "0 mutations performed" (check `operationLedger` is empty for this run).

## Run 5 — Ambiguity block

1. Temporarily create a second account with the same display name as Alice but a different email (or a second folder/channel/repo matching "Phoenix") in one provider.
2. Submit an instruction that omits Alice's exact email (display name only).
3. Expect: preflight returns `BLOCKED` before any read of "current access" is used to build a plan, the blockers list names the exact candidates found, and `operationLedger` for the run is empty.
4. Remove the duplicate account/resource afterward.

## After all five

Fill in `docs/integration-evidence.md` with the real run IDs, receipt IDs, and observed statuses. Do not mark a run as passed unless you performed the independent provider-side check listed above.
