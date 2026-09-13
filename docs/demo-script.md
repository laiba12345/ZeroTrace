# Demo script (2 minutes)

Uses the partial-failure scenario (Run 2 in `scripts/run-real-validation.md`) as the primary path — it's the strongest demo moment because it proves the system doesn't lie about success.

**Pre-demo setup:** Slack sandbox token configured without channel-removal capability; GitHub and Drive tokens fully capable. Sandbox data seeded per `scripts/seed-sandbox.md`.

1. **Problem and promise — 15s.** "Offboarding tools report success from an HTTP 200. ZeroTrace doesn't trust that — it reads every provider again after mutating, and it won't say 'complete' unless it independently confirmed it." Show the header: three connection badges live, all green.

2. **Enter command and show preflight — 25s.** Click "Use demo preset," then "Analyze request." Walk through the resulting Identity/Project cards (exact GitHub login, Slack user ID, Drive email — not a fuzzy name match) and the Access Matrix: WRITE / MEMBER / EDITOR → all showing what's about to change. Point at "0 content deletions."

3. **Approve and execute — 35s.** Click Approve. Narrate the execution timeline as it streams: GitHub READ → SCOPE LOCK → REVOKE → READ BACK → VERIFIED (green). Slack starts the same sequence.

4. **Reveal genuine Slack failure and INCOMPLETE — 20s.** Slack's mutation fails with a real `missing_scope` error from Slack's API — not a scripted failure. The obligation badge turns red (FAILED), the safe error message is shown ("The connected credential lacks the permission required for this action"), and the final banner reads **OFFBOARDING INCOMPLETE** in amber/red, not a green success state.

5. **Show preserved history and unrelated access — 15s.** Scroll to the Invariants panel: `AUTHORED_HISTORY_PRESERVED`, `UNRELATED_PROJECT_ACCESS_PRESERVED`, `OTHER_USERS_UNCHANGED` all PASS, for all three providers, even though one provider's revocation failed.

6. **Open Revocation Receipt and close — 10s.** Open the receipt drawer: show the provider-by-provider evidence list with evidence IDs, the operation ledger (exactly 2 successful mutations, 1 failed attempt, 0 deletions), and the "manual remediation" note calling out the remaining Slack access by name.

**Closing line:**

> ZeroTrace doesn't report that access was revoked. It proves it.
