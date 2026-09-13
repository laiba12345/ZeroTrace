# Sandbox seed data (operator runbook)

**Fastest path:** fill in the credentials below plus the `ALICE_*`/`BOB_*` variables in `.env` (see `.env.example`), then run:

```bash
npx tsx scripts/seed.mts
```

This creates the repos/commits, channels/messages, and folders/files programmatically via each provider's real API — see the script's header comment for exactly what it can and cannot do (it cannot create the Alice/Bob accounts themselves; those must already exist). The rest of this document describes what gets created and how to do it by hand if you'd rather not run the script, or need to fix up something it couldn't do (e.g. it has no Slack workspace invite API for people who aren't members yet).

Never point any of this at a production org/workspace/account.

## People

Create two accounts with **the same email domain across all three providers** so `resolveSubject` can match by exact email:

- **Alice Smith** — `alice@<your-sandbox-domain>` — the subject being offboarded.
- **Bob Lee** — `bob@<your-sandbox-domain>` — the control user who must never be touched. Used to validate `OTHER_USERS_UNCHANGED`.

## Projects

- **Phoenix** — the target project being offboarded from.
- **Apollo** — an unrelated project Alice keeps access to. Used to validate `UNRELATED_PROJECT_ACCESS_PRESERVED`.

## GitHub

1. Create (or use) a sandbox org. Set `GITHUB_ORG` in `.env`.
2. Create repo `phoenix`. Add Alice as a collaborator with `write` permission, add Bob as a collaborator (any permission).
3. As Alice (or via the API with her token), push at least 2 commits to `phoenix` and open 1 issue or pull request — these back `AUTHORED_HISTORY_PRESERVED`.
4. Create repo `apollo`. Add Alice as a collaborator — this is what `UNRELATED_PROJECT_ACCESS_PRESERVED` checks stay intact.
5. Confirm the token in `GITHUB_TOKEN` can call `search.users`, `search.commits`, `repos.listForOrg`, `repos.checkCollaborator`, `repos.removeCollaborator`, `teams.getMembershipForUserInOrg`.

## Slack

1. Create a sandbox Slack workspace (free tier is fine). Create a Slack app with a bot token (`SLACK_BOT_TOKEN`) with scopes: `channels:read`, `groups:read`, `channels:history`, `groups:history`, `users:read`, `users:read.email`, `groups:write` (or `channels:manage` if the channel is public).
2. Create a private channel `phoenix-private`. Invite Alice and Bob (and the bot).
3. Post at least 2 messages as Alice in `phoenix-private`.
4. Create a channel `apollo-project` (private or public). Invite Alice.
5. For the partial-failure validation run (Run 2), create a **second** bot token/app installation with every scope above **except** `groups:write`/`channels:manage`, so `conversations.kick` genuinely fails with `missing_scope`. Swap `SLACK_BOT_TOKEN` to this token only for that run.

## Google Drive

1. Create an OAuth client (Desktop or Web) in a sandbox Google Cloud project with the Drive API enabled, scope `https://www.googleapis.com/auth/drive`. Obtain a refresh token for an account that will own the sandbox folders (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`).
2. Create a folder `Phoenix`. Share it with Alice (Editor) and Bob (Viewer or Editor).
3. Add at least 3 files of different MIME types under `Phoenix` (e.g. a Doc, a Sheet, an uploaded PDF or image).
4. Create a folder `Apollo`. Share it with Alice.

## Verifying the seed

After seeding, `GET /api/connections` should show all three providers `connected`. Run the demo preset instruction through preflight (without approving) and confirm the Access Matrix shows Alice with real, non-empty access in all three "Before" columns, and the Apollo/Bob control data is untouched.
