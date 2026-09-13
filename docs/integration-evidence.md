# Integration evidence

**Status: 4 of 5 runs completed for real** (Runs 1, 3, 4, 5). This document contains only *actual observed results*. Run 2 (genuine partial failure) was deliberately not run — it requires temporarily reducing the Slack bot token's scope, and the project owner chose to skip it and keep the sandbox at full capability rather than pursue it. Do not write "5/5 passed"; this is an honest 4/5.

## Browser UI verification

Separately from the 5 scripted validation runs above (which were driven directly against the API to keep the evidence trail simple), the actual React UI was driven end to end in a real headless Chromium browser at 1440×900: connection gate → demo preset → preflight panel (identity/project cards, access matrix, impact summary) → approve → live execution timeline → `OFFBOARDING COMPLETE` banner → invariants list → Revocation Receipt drawer (evidence IDs, plan hash, timeline, print button). Zero browser console errors throughout. This confirms the UI code (not just the API layer) renders correctly against real data — screenshots were reviewed but not persisted in this repo.

## Environment

- **Type:** Real sandbox accounts (not Arga twins)
- **GitHub org:** `Nalmai-for-testing`
- **Slack workspace:** ZeroTrace sandbox workspace (bot: `zerotrace`)
- **Google Drive account:** `laiba.asmatullah@gmail.com` (folder owner)
- **Subject ("Alice" role):** Munad Ali, `munadali17@gmail.com` / GitHub `MunadEAli` / Slack `U0C1KVD6GKT`
- **Control user ("Bob" role):** `munadali18@gmail.com` / GitHub `swiftali`
- **Date/time of validation:** 2026-09-13, ~20:08–20:11 UTC

## Run 1 — Complete revocation

- Run ID: `run_775b415c-8685-4253-b50b-35f6cf9664c7`
- Receipt ID: `rcpt_edf67d9e-f0f9-499d-a1a8-cd1210c2cdfe`
- Instruction used: "Munad Ali's (munadali17@gmail.com) contract ended. Remove him from Project Phoenix everywhere, but preserve everything he created and keep his access to unrelated projects."
- GitHub: `write` (direct collaborator on `Nalmai-for-testing/phoenix`) → `NONE`, obligation `VERIFIED`. Independently re-confirmed outside the app: `GET /repos/Nalmai-for-testing/phoenix/collaborators/MunadEAli` → `404`.
- Slack: member of `#phoenix-private` (`C0C1G6LKF46`) → not a member, obligation `VERIFIED`. Independently re-confirmed: `conversations.members` for that channel no longer lists `U0C1KVD6GKT` (only `U0C1DDHD6Q5`, `U0C1KVCCMHP` remain).
- Drive: `writer` permission on the `Phoenix` folder → no permission, obligation `VERIFIED`. Independently re-confirmed: `permissions.list` on the folder shows only `munadali18@gmail.com` (writer, Bob) and `laiba.asmatullah@gmail.com` (owner) — Alice's permission is gone.
- Authored history preserved: `PASS` on all three providers — GitHub (2 commits), Slack (1 message), Drive (3 files), all confirmed still present after mutation.
- Unrelated project access preserved: `PASS` on all three (checked programmatically; Apollo access untouched).
- Other users (Bob) unchanged: `PASS` on all three.
- System invariants (`ONLY_APPROVED_RESOURCES_TOUCHED`, `NO_CONTENT_DELETE_OPERATIONS_SENT`): both `PASS` — exactly 3 ledger entries, all allowlisted revoke operations on approved resource IDs.
- Final workflow status: **`COMPLETE`** (matches expected).
- Mutation count: 3. Deletion count: 0.

**Accepted limitation (not pursued further):** the GitHub "authored issue as Alice" seed step still 404s even after her collaborator invite was accepted. Root cause confirmed by direct API test: `ALICE_GITHUB_TOKEN` is a fine-grained PAT scoped to Alice's personal account as resource owner, not the `Nalmai-for-testing` org — the same class of issue fixed for the main `GITHUB_TOKEN` earlier, but fixing it for Alice's token requires org-level fine-grained-PAT policy changes and possibly owner approval of her token. Not pursued: this is explicitly optional evidence per the build spec ("at least one issue or PR"), and the 2 real Alice-authored commits already satisfy `AUTHORED_HISTORY_PRESERVED` for GitHub.

**Bugs found and fixed during this run** (see commit history / conversation): the deterministic intent-compiler fallback was silently authorizing runs instead of always blocking (spec violation, fixed); `Run.idempotencyKey` had an incorrect DB-unique constraint that broke legitimate retries (fixed — made non-unique + indexed); GitHub's issue/PR search required an explicit `is:issue`/`is:pull-request` qualifier and 422s on some fine-grained-PAT/private-repo combinations even with correct scopes — now queried separately and gracefully degrades to empty results rather than failing the whole preflight; the system prompt was mis-flagging normal single-project, all-three-provider requests (and the word "everywhere") as out-of-scope, lowering confidence below threshold (prompt clarified); added OpenAI as a second supported `LLM_PROVIDER` since Anthropic credentials weren't available for this validation.

## Run 2 — Genuine partial failure (Slack missing scope)

**Status: deliberately skipped.** This scenario requires a Slack bot token that genuinely lacks channel-removal capability (`conversations.kick`), which means reinstalling the sandbox Slack app with a reduced scope set through Slack's own web UI, then swapping the resulting token into `.env` — an action only the workspace owner can take (see `scripts/run-real-validation.md` Run 2, and `scripts/seed-sandbox.md` Slack step 5). One attempt was made but the reduced-scope token was never actually copied into `.env` (the app kept running on the original full-scope token throughout), and the project owner chose to leave the sandbox at full capability rather than repeat the attempt. Not automatable from outside Slack's own UI.

- Run ID: _(fill in)_
- Receipt ID: _(fill in)_
- Slack token used: _(describe — e.g. bot token with `conversations.kick` scope removed)_
- Observed Slack error code: _(fill in, e.g. `missing_scope`)_
- GitHub: _(expected VERIFIED)_
- Slack: _(expected FAILED)_
- Drive: _(expected VERIFIED)_
- Final workflow status: _(expected INCOMPLETE)_
- Receipt correctly states remaining Slack access: _(yes/no)_

## Run 3 — Blast-radius containment

- Run ID: `run_3159857b-8cb9-4c93-bd32-066c4dd19444`
- Setup: Alice's Phoenix access was re-seeded (re-granted) before this run so there was something real to revoke; she already had real, untouched Apollo access from initial seeding, and Bob already had real Phoenix access.
- Alice's Apollo access before/after: GitHub collaborator status `204` (present) before and after (independently checked via `GET /repos/Nalmai-for-testing/apollo/collaborators/MunadEAli` with the admin token, not Alice's own org-restricted token); Drive `writer` permission on the Apollo folder unchanged (independently confirmed via `permissions.list`).
- Bob's Phoenix access before/after: GitHub collaborator status `204` (present) before and after (`GET /repos/Nalmai-for-testing/phoenix/collaborators/swiftali`).
- Operation ledger entries: exactly 3, all targeting Phoenix resource IDs only (`Nalmai-for-testing/phoenix`, the Phoenix Slack channel, the Phoenix Drive folder) — matches expected.
- `UNRELATED_PROJECT_ACCESS_PRESERVED` and `OTHER_USERS_UNCHANGED`: `PASS` on all three providers.
- Final workflow status: `COMPLETE` (matches expected).

## Run 4 — Idempotency

- First run (the completed offboarding being re-run): `run_3159857b-8cb9-4c93-bd32-066c4dd19444` (Run 3 above, immediately prior — Alice had zero Phoenix access going into this run)
- Second run ID / Receipt ID: `run_d6928510-3ac1-444a-868c-1fdc0948c482`
- Preflight-predicted mutation count before approval: `0` (matches expected — preflight's fresh reads already showed no access, so the plan proposed no mutations)
- Mutation count on rerun: `0` (matches expected)
- Obligation statuses on rerun: `github: NOT_NEEDED`, `slack: NOT_NEEDED`, `drive: NOT_NEEDED`, all with `mutationAttempted: false` (matches expected 3x `NOT_NEEDED`)
- Operation ledger: empty (0 entries)
- Final workflow status: `COMPLETE` (matches expected)

## Run 5 — Ambiguity block

- Run ID: `run_90f61696-58f0-4750-b06d-f6ed642d72f2`
- Ambiguity condition used: a second GitHub repo named `phoenix-archive` was temporarily created in the sandbox org (deleted immediately after this test), so the project-name fuzzy match legitimately found two candidates.
- Candidates surfaced to operator: blocker text named both exactly — `"github: multiple project resources matched \"Phoenix\" (phoenix, phoenix-archive); operator must select one."`
- Mutations sent: `0` (matches expected)
- Operation ledger: empty (0 entries, matches expected)
- Final workflow status: `BLOCKED` (matches expected)
