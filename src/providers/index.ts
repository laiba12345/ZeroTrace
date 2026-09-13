import { githubProvider } from "./github";
import { slackProvider } from "./slack";
import { driveProvider } from "./drive";
import type { AccessProvider, ProviderName } from "./types";

export const providers: Record<ProviderName, AccessProvider> = {
  github: githubProvider,
  slack: slackProvider,
  drive: driveProvider,
};

export function getProvider(name: ProviderName): AccessProvider {
  return providers[name];
}

export const PROVIDER_ORDER: ProviderName[] = ["github", "slack", "drive"];

export const OPERATION_TYPE_FOR_PROVIDER: Record<ProviderName, string> = {
  github: "GITHUB_REVOKE_REPO_OR_PROJECT_TEAM_ACCESS",
  slack: "SLACK_REMOVE_CHANNEL_MEMBER",
  drive: "DRIVE_DELETE_PROJECT_PERMISSION",
};

export { githubProvider, slackProvider, driveProvider };
export * from "./types";
