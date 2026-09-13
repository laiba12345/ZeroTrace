/**
 * Automated sandbox seeder — creates the test data described in
 * scripts/seed-sandbox.md via each provider's real API, so you don't have
 * to click through three separate UIs by hand.
 *
 * What this script CANNOT do: create the Alice/Bob accounts themselves.
 * GitHub logins, Slack workspace members, and Google accounts are real
 * identities — you need two disposable accounts (or two throwaway emails
 * invited into your sandbox Slack workspace) before running this.
 *
 * Usage:
 *   1. Fill in .env (provider credentials) AND the ALICE_ and BOB_ vars below.
 *   2. npx tsx scripts/seed.mts
 *
 * (.mts, not .ts: forces ESM mode — octokit's dependency chain is
 * ESM-only and fails to resolve under tsx's default CommonJS mode, since
 * this project's package.json has no top-level "type": "module".)
 *
 * Safe to re-run: every step checks for existing resources first.
 */
import { Octokit } from "octokit";
import { WebClient } from "@slack/web-api";
import { google } from "googleapis";

process.loadEnvFile?.(".env");

const env = process.env;
const REQUIRED = ["ALICE_EMAIL", "ALICE_NAME", "BOB_EMAIL", "BOB_NAME"] as const;
for (const key of REQUIRED) {
  if (!env[key]) {
    console.error(`Missing required seed variable: ${key}. Add it to .env — see scripts/seed-sandbox.md.`);
    process.exit(1);
  }
}

const ALICE_EMAIL = env.ALICE_EMAIL!;
const ALICE_NAME = env.ALICE_NAME!;
const BOB_EMAIL = env.BOB_EMAIL!;

async function main() {
  console.log("=== ZeroTrace sandbox seed ===\n");

  if (env.GITHUB_TOKEN && env.GITHUB_ORG) {
    await runSection("GitHub", seedGitHub);
  } else {
    console.log("Skipping GitHub (GITHUB_TOKEN/GITHUB_ORG not set).");
  }

  if (env.SLACK_BOT_TOKEN) {
    await runSection("Slack", seedSlack);
  } else {
    console.log("Skipping Slack (SLACK_BOT_TOKEN not set).");
  }

  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_REFRESH_TOKEN) {
    await runSection("Drive", seedDrive);
  } else {
    console.log("Skipping Drive (GOOGLE_CLIENT_ID/SECRET/REFRESH_TOKEN not set).");
  }

  console.log("\n=== Done. Run the app and try the demo preset instruction. ===");
}

// Isolates one provider section's failure from the others — the same
// partial-failure-honesty principle as the app itself: a Slack hiccup
// shouldn't stop GitHub/Drive from seeding.
async function runSection(label: string, fn: () => Promise<void>) {
  try {
    await fn();
  } catch (err) {
    console.log(`  ${label} section failed partway through: ${describeError(err)}`);
    console.log(`  (Continuing with remaining sections — re-run this script after fixing ${label} to finish it; steps already done are safe to repeat.)`);
  }
}

// ---------------------------------------------------------------------------
// GitHub
// ---------------------------------------------------------------------------
async function seedGitHub() {
  console.log("\n--- GitHub ---");
  const org = env.GITHUB_ORG!;
  const octokit = new Octokit({ auth: env.GITHUB_TOKEN });

  const aliceLogin = env.ALICE_GITHUB_LOGIN;
  const bobLogin = env.BOB_GITHUB_LOGIN;
  if (!aliceLogin || !bobLogin) {
    console.log("  Skipping — set ALICE_GITHUB_LOGIN and BOB_GITHUB_LOGIN (their GitHub usernames) in .env.");
    return;
  }

  await ensureRepo(octokit, org, "phoenix");
  await ensureRepo(octokit, org, "apollo");

  await ensureCollaborator(octokit, org, "phoenix", aliceLogin, "push");
  await ensureCollaborator(octokit, org, "phoenix", bobLogin, "push");
  await ensureCollaborator(octokit, org, "apollo", aliceLogin, "push");

  if (await fileExists(octokit, org, "phoenix", "docs/notes.md")) {
    console.log("  docs/notes.md already exists — skipping commit creation.");
  } else {
    // Two commits with Alice's git author identity — GitHub attributes a
    // commit to a user account by matching this email to a *verified*
    // email on that account, regardless of which token pushed it.
    await createCommit(octokit, org, "phoenix", "docs/notes.md", "# Phoenix launch notes\n\nInitial notes.\n", "Add launch notes");
    await createCommit(octokit, org, "phoenix", "docs/notes.md", "# Phoenix launch notes\n\nInitial notes.\n\nUpdated timeline.\n", "Update timeline");
    console.log("  Created 2 commits authored as Alice (by git author email).");
  }

  if (env.ALICE_GITHUB_TOKEN) {
    const aliceOctokit = new Octokit({ auth: env.ALICE_GITHUB_TOKEN });
    try {
      await aliceOctokit.rest.issues.create({
        owner: org,
        repo: "phoenix",
        title: "Track launch checklist",
        body: "Opened by Alice for seed data.",
      });
      console.log("  Opened 1 issue as Alice (via ALICE_GITHUB_TOKEN).");
    } catch (err) {
      console.log(`  Could not open issue as Alice: ${describeError(err)}`);
    }
  } else {
    console.log("  Skipping issue authorship — set ALICE_GITHUB_TOKEN (Alice's own PAT) to open one as her.");
  }

  console.log(`  Repos ready: ${org}/phoenix, ${org}/apollo`);
}

async function fileExists(octokit: Octokit, org: string, repo: string, path: string): Promise<boolean> {
  try {
    await octokit.rest.repos.getContent({ owner: org, repo, path });
    return true;
  } catch {
    return false;
  }
}

async function ensureRepo(octokit: Octokit, org: string, name: string): Promise<{ created: boolean }> {
  try {
    await octokit.rest.repos.get({ owner: org, repo: name });
    console.log(`  Repo ${org}/${name} already exists.`);
    return { created: false };
  } catch {
    await octokit.rest.repos.createInOrg({ org, name, private: true, auto_init: true });
    console.log(`  Created repo ${org}/${name}.`);
    return { created: true };
  }
}

async function ensureCollaborator(octokit: Octokit, org: string, repo: string, username: string, permission: string) {
  try {
    await octokit.rest.repos.addCollaborator({ owner: org, repo, username, permission });
    console.log(`  Added ${username} to ${org}/${repo} (${permission}).`);
  } catch (err) {
    console.log(`  Could not add ${username} to ${org}/${repo}: ${describeError(err)}`);
  }
}

async function createCommit(octokit: Octokit, org: string, repo: string, path: string, content: string, message: string) {
  const { data: repoData } = await octokit.rest.repos.get({ owner: org, repo });
  const branch = repoData.default_branch;
  const { data: refData } = await octokit.rest.git.getRef({ owner: org, repo, ref: `heads/${branch}` });
  const { data: baseCommit } = await octokit.rest.git.getCommit({ owner: org, repo, commit_sha: refData.object.sha });

  const { data: blob } = await octokit.rest.git.createBlob({ owner: org, repo, content, encoding: "utf-8" });
  const { data: tree } = await octokit.rest.git.createTree({
    owner: org,
    repo,
    base_tree: baseCommit.tree.sha,
    tree: [{ path, mode: "100644", type: "blob", sha: blob.sha }],
  });

  const author = { name: ALICE_NAME, email: ALICE_EMAIL, date: new Date().toISOString() };
  const { data: commit } = await octokit.rest.git.createCommit({
    owner: org,
    repo,
    message,
    tree: tree.sha,
    parents: [refData.object.sha],
    author,
    committer: author,
  });

  await octokit.rest.git.updateRef({ owner: org, repo, ref: `heads/${branch}`, sha: commit.sha });
}

// ---------------------------------------------------------------------------
// Slack
// ---------------------------------------------------------------------------
async function seedSlack() {
  console.log("\n--- Slack ---");
  const web = new WebClient(env.SLACK_BOT_TOKEN);

  const alice = await lookupUser(web, ALICE_EMAIL);
  const bob = await lookupUser(web, BOB_EMAIL);
  if (!alice || !bob) {
    console.log("  Skipping — Alice and/or Bob were not found by email. They must already be members of this Slack workspace.");
    return;
  }

  const phoenixChannel = await ensureChannel(web, "phoenix-private", true);
  const apolloChannel = await ensureChannel(web, "apollo-project", true);

  await inviteIfNeeded(web, phoenixChannel, [alice, bob]);
  await inviteIfNeeded(web, apolloChannel, [alice]);

  if (env.ALICE_SLACK_USER_TOKEN) {
    try {
      const aliceWeb = new WebClient(env.ALICE_SLACK_USER_TOKEN);
      await aliceWeb.chat.postMessage({ channel: phoenixChannel, text: "Kicking off the Phoenix launch checklist." });
      await aliceWeb.chat.postMessage({ channel: phoenixChannel, text: "Docs are up, review by Friday." });
      console.log("  Posted 2 messages as Alice (via ALICE_SLACK_USER_TOKEN).");
    } catch (err) {
      console.log(`  Could not post messages as Alice (token may need to be a real xoxp- user token, not a rotation refresh token): ${describeError(err)}`);
    }
  } else {
    console.log("  Skipping authored messages — set ALICE_SLACK_USER_TOKEN (Alice's own xoxp- user token, scope chat:write) to post as her.");
  }

  console.log(`  Channels ready: #phoenix-private (${phoenixChannel}), #apollo-project (${apolloChannel})`);
}

async function lookupUser(web: WebClient, email: string): Promise<string | null> {
  try {
    const res = await web.users.lookupByEmail({ email });
    return res.user?.id ?? null;
  } catch {
    return null;
  }
}

async function ensureChannel(web: WebClient, name: string, isPrivate: boolean): Promise<string> {
  const list = await web.conversations.list({ types: "private_channel,public_channel", limit: 200 });
  const existing = (list.channels ?? []).find((c) => c.name === name);
  if (existing?.id) {
    console.log(`  Channel #${name} already exists.`);
    return existing.id;
  }
  const created = await web.conversations.create({ name, is_private: isPrivate });
  console.log(`  Created channel #${name}.`);
  return created.channel!.id!;
}

async function inviteIfNeeded(web: WebClient, channel: string, userIds: string[]) {
  const members = await web.conversations.members({ channel, limit: 200 });
  const toInvite = userIds.filter((id) => !(members.members ?? []).includes(id));
  if (toInvite.length === 0) return;
  try {
    await web.conversations.invite({ channel, users: toInvite.join(",") });
    console.log(`  Invited ${toInvite.length} user(s) to ${channel}.`);
  } catch (err) {
    console.log(`  Could not invite users to ${channel}: ${describeError(err)}`);
  }
}

// ---------------------------------------------------------------------------
// Google Drive
// ---------------------------------------------------------------------------
async function seedDrive() {
  console.log("\n--- Google Drive ---");
  const auth = new google.auth.OAuth2(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET);
  auth.setCredentials({ refresh_token: env.GOOGLE_REFRESH_TOKEN });
  const drive = google.drive({ version: "v3", auth });

  const phoenix = await ensureFolder(drive, "Phoenix");
  const apollo = await ensureFolder(drive, "Apollo");

  await ensureFile(drive, phoenix, "launch-notes.txt", "text/plain", "Phoenix launch notes.\n");
  await ensureFile(drive, phoenix, "budget.csv", "text/csv", "item,cost\nlaunch party,500\n");
  await ensureFile(drive, phoenix, "readme.md", "text/markdown", "# Phoenix\n\nSeed file for ZeroTrace demo.\n");

  await ensureFile(drive, apollo, "apollo-notes.txt", "text/plain", "Apollo project notes.\n");

  await sharePermission(drive, phoenix, ALICE_EMAIL, "writer");
  await sharePermission(drive, phoenix, BOB_EMAIL, "writer");
  await sharePermission(drive, apollo, ALICE_EMAIL, "writer");

  console.log(`  Folders ready: Phoenix (${phoenix}), Apollo (${apollo})`);
}

async function ensureFolder(drive: ReturnType<typeof google.drive>, name: string): Promise<string> {
  const res = await drive.files.list({
    q: `mimeType = 'application/vnd.google-apps.folder' and name = '${name}' and trashed = false`,
    fields: "files(id,name)",
  });
  const existing = res.data.files?.[0];
  if (existing?.id) {
    console.log(`  Folder "${name}" already exists.`);
    return existing.id;
  }
  const created = await drive.files.create({
    requestBody: { name, mimeType: "application/vnd.google-apps.folder" },
    fields: "id",
  });
  console.log(`  Created folder "${name}".`);
  return created.data.id!;
}

async function ensureFile(
  drive: ReturnType<typeof google.drive>,
  parentId: string,
  name: string,
  mimeType: string,
  content: string
) {
  const res = await drive.files.list({
    q: `'${parentId}' in parents and name = '${name}' and trashed = false`,
    fields: "files(id)",
  });
  if (res.data.files && res.data.files.length > 0) {
    console.log(`  File "${name}" already exists.`);
    return;
  }
  await drive.files.create({
    requestBody: { name, parents: [parentId] },
    media: { mimeType, body: content },
    fields: "id",
  });
  console.log(`  Uploaded "${name}".`);
}

async function sharePermission(drive: ReturnType<typeof google.drive>, fileId: string, email: string, role: string) {
  const existing = await drive.permissions.list({ fileId, fields: "permissions(emailAddress)" });
  if ((existing.data.permissions ?? []).some((p) => p.emailAddress?.toLowerCase() === email.toLowerCase())) {
    console.log(`  ${email} already has access to ${fileId}.`);
    return;
  }
  await drive.permissions.create({
    fileId,
    requestBody: { type: "user", role, emailAddress: email },
    sendNotificationEmail: false,
  });
  console.log(`  Shared ${fileId} with ${email} (${role}).`);
}

function describeError(err: unknown): string {
  if (err && typeof err === "object" && "message" in err) return String((err as { message: unknown }).message);
  return String(err);
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
