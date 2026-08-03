/**
 * Better Auth session signing plus the OAuth client secrets for the two
 * sign-in providers. Client IDs are browser-visible and live in
 * `lib/config/public.ts`.
 */

import { defineEnvGroup } from "@/lib/config/env-group";
import { getPublicConfig } from "@/lib/config/public";
import { optionalRawString } from "@/lib/config/schemas";

export const authEnv = defineEnvGroup({
  name: "auth",
  specs: {
    BETTER_AUTH_SECRET: {
      axis: "required-prod",
      secret: true,
      description:
        "Signing key for better-auth sessions; also derives the AES key for the stored Linear workspace token.",
      schema: optionalRawString,
    },
    BETTER_AUTH_URL: {
      axis: "optional",
      description:
        "Explicit base URL for better-auth. Falls back to the Vercel deployment URL, then the request origin.",
      example: "http://localhost:3000",
      schema: optionalRawString,
    },
    VERCEL_APP_CLIENT_SECRET: {
      axis: "required-prod",
      secret: true,
      description: "Vercel OAuth client secret (pairs with the client ID).",
      schema: optionalRawString,
    },
    GITHUB_CLIENT_SECRET: {
      axis: "optional",
      requiredWith: ["NEXT_PUBLIC_GITHUB_CLIENT_ID"],
      secret: true,
      description: "GitHub OAuth client secret (pairs with the client ID).",
      schema: optionalRawString,
    },
  },
});

export interface AuthConfig {
  /** Session signing secret. */
  secret?: string;
  /** Explicit better-auth base URL override. */
  baseUrl?: string;
}

export interface OAuthClientCredentials {
  clientId?: string;
  clientSecret?: string;
}

export function getAuthConfig(): AuthConfig {
  const env = authEnv.read();

  return {
    secret: env.BETTER_AUTH_SECRET,
    baseUrl: env.BETTER_AUTH_URL,
  };
}

export function getVercelOAuthCredentials(): OAuthClientCredentials {
  return {
    clientId: getPublicConfig().vercelClientId,
    clientSecret: authEnv.read().VERCEL_APP_CLIENT_SECRET,
  };
}

export function getGitHubOAuthCredentials(): OAuthClientCredentials {
  return {
    clientId: getPublicConfig().githubClientId,
    clientSecret: authEnv.read().GITHUB_CLIENT_SECRET,
  };
}
