/**
 * Better Auth session signing, the OAuth client secrets for the two sign-in
 * providers, and the sign-in-time membership decisions (who is auto-approved
 * into the organization, who is bootstrapped as an admin, and what that
 * organization is called). Client IDs are browser-visible and live in
 * `lib/config/public.ts`.
 */

import { defineEnvGroup } from "@/lib/config/env-group";
import { getPublicConfig } from "@/lib/config/public";
import {
  optionalDomainList,
  optionalEmailList,
  optionalRawString,
  optionalTrimmedString,
} from "@/lib/config/schemas";

/** Applied when `DEFAULT_ORG_NAME` is unset. */
const FALLBACK_ORG_NAME = "QuackOps";
/** Applied when `DEFAULT_ORG_SLUG` is unset. */
const FALLBACK_ORG_SLUG = "quackops";

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
    ALLOWED_EMAIL_DOMAINS: {
      axis: "optional",
      description:
        "Comma-separated email domains auto-approved into the organization on sign-up. Unset means nobody is auto-approved — every sign-up lands pending.",
      example: "nextdegree.org,example.com",
      schema: optionalDomainList,
    },
    ADMIN_EMAILS: {
      axis: "required-prod",
      description:
        "Comma-separated emails granted platform admin and organization owner on first sign-in, so a fresh deployment is never adminless.",
      example: "admin@nextdegree.org",
      schema: optionalEmailList,
    },
    DEFAULT_ORG_NAME: {
      axis: "optional",
      description: `Display name of the single seeded organization (default ${FALLBACK_ORG_NAME}).`,
      example: FALLBACK_ORG_NAME,
      schema: optionalTrimmedString,
    },
    DEFAULT_ORG_SLUG: {
      axis: "optional",
      description: `Slug of the single seeded organization; the seeder's idempotency key (default ${FALLBACK_ORG_SLUG}).`,
      example: FALLBACK_ORG_SLUG,
      schema: optionalTrimmedString,
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

export interface MembershipConfig {
  /** Domains auto-approved into the seeded organization. Empty = nobody. */
  allowedEmailDomains: readonly string[];
  /** Emails bootstrapped as platform admin + organization owner. */
  adminEmails: readonly string[];
  /** Display name of the seeded organization. */
  defaultOrgName: string;
  /** Slug of the seeded organization; the seeder's idempotency key. */
  defaultOrgSlug: string;
}

/**
 * Membership decisions made at sign-in time.
 *
 * Both allowlists default to empty rather than "everyone": an unset
 * `ALLOWED_EMAIL_DOMAINS` must fail closed, or the membership gate would be a
 * no-op on any deployment that forgot to set it.
 */
export function getMembershipConfig(): MembershipConfig {
  const env = authEnv.read();

  return {
    allowedEmailDomains: env.ALLOWED_EMAIL_DOMAINS ?? [],
    adminEmails: env.ADMIN_EMAILS ?? [],
    defaultOrgName: env.DEFAULT_ORG_NAME ?? FALLBACK_ORG_NAME,
    defaultOrgSlug: (env.DEFAULT_ORG_SLUG ?? FALLBACK_ORG_SLUG).toLowerCase(),
  };
}
