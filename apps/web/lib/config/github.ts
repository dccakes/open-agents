/**
 * GitHub App credentials and webhook secret.
 *
 * The GitHub App is what grants repository access to sandboxes; its OAuth
 * counterpart (sign-in) lives in `lib/config/auth.ts`.
 */

import { defineEnvGroup } from "@/lib/config/env-group";
import { optionalRawString } from "@/lib/config/schemas";

export const githubEnv = defineEnvGroup({
  name: "github",
  specs: {
    GITHUB_APP_ID: {
      axis: "optional",
      requiredWith: ["GITHUB_APP_PRIVATE_KEY"],
      description: "Numeric ID of the GitHub App used for repository access.",
      example: "123456",
      schema: optionalRawString,
    },
    GITHUB_APP_PRIVATE_KEY: {
      axis: "optional",
      requiredWith: ["GITHUB_APP_ID"],
      secret: true,
      description:
        "GitHub App private key, either PEM (with escaped newlines) or base64-encoded PEM.",
      schema: optionalRawString,
    },
    GITHUB_WEBHOOK_SECRET: {
      axis: "optional",
      requiredWith: ["GITHUB_APP_ID"],
      secret: true,
      description:
        "Shared secret for GitHub webhook HMAC verification. Without it `/api/github/webhook` answers 500.",
      schema: optionalRawString,
    },
  },
});

export interface GitHubAppEnvConfig {
  appId?: string;
  privateKey?: string;
  webhookSecret?: string;
}

export function getGitHubAppEnvConfig(): GitHubAppEnvConfig {
  const env = githubEnv.read();

  return {
    appId: env.GITHUB_APP_ID,
    privateKey: env.GITHUB_APP_PRIVATE_KEY,
    webhookSecret: env.GITHUB_WEBHOOK_SECRET,
  };
}
