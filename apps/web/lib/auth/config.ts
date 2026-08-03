import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import type {
  GithubProfile,
  VercelProfile,
} from "better-auth/social-providers";
import { nanoid } from "nanoid";
import { authDbSchemaMap } from "@/lib/auth/db-schema-map";
import { impersonationAudit } from "@/lib/auth/impersonation-audit";
import { lastAdminGuard } from "@/lib/auth/last-admin-guard";
import { createAuthPlugins } from "@/lib/auth/plugins";
import { applySignupMembership } from "@/lib/auth/signup-membership-hook";
import { deriveAuthUsername } from "@/lib/auth/username";
import {
  getAuthConfig,
  getGitHubOAuthCredentials,
  getVercelOAuthCredentials,
} from "@/lib/config/auth";
import { getDeploymentConfig } from "@/lib/config/deployment";
import { getPublicConfig } from "@/lib/config/public";
import { db } from "@/lib/db/client";
import { getSeededOrganizationId } from "@/lib/org/seeded-organization";

function normalizeHost(value?: string): string | null {
  if (!value) {
    return null;
  }

  try {
    return new URL(
      value.startsWith("http://") || value.startsWith("https://")
        ? value
        : `https://${value}`,
    ).host;
  } catch {
    return null;
  }
}

function getWildcardHostPattern(host: string): string | null {
  const hostname = host.split(":")[0];
  if (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname.startsWith("[")
  ) {
    return null;
  }

  return `*.${host}`;
}

function getAuthBaseURLFallback(): string | undefined {
  const { baseUrl } = getAuthConfig();
  const { deploymentUrl } = getDeploymentConfig();

  return baseUrl ?? (deploymentUrl ? `https://${deploymentUrl}` : undefined);
}

function getAllowedAuthHosts(): string[] {
  const hosts = new Set<string>(["localhost:3000", "127.0.0.1:3000"]);
  const deployment = getDeploymentConfig();
  const publicConfig = getPublicConfig();

  for (const value of [
    getAuthConfig().baseUrl,
    deployment.deploymentUrl,
    deployment.productionUrl,
    publicConfig.productionUrl,
    publicConfig.appUrl,
  ]) {
    const host = normalizeHost(value);
    if (!host) {
      continue;
    }

    hosts.add(host);

    const wildcardPattern = getWildcardHostPattern(host);
    if (wildcardPattern) {
      hosts.add(wildcardPattern);
    }
  }

  return [...hosts];
}

function mapVercelProfileToUser(profile: VercelProfile): { username: string } {
  return {
    username: deriveAuthUsername({
      id: profile.sub,
      preferred_username: profile.preferred_username,
      email: profile.email,
      name: profile.name,
    }),
  };
}

function mapGitHubProfileToUser(profile: GithubProfile): { username: string } {
  return {
    username: deriveAuthUsername({
      id: profile.id,
      username: profile.login,
      email: profile.email,
      name: profile.name,
    }),
  };
}

const authBaseURLFallback = getAuthBaseURLFallback();
const authAllowedHosts = getAllowedAuthHosts();
const vercelOAuth = getVercelOAuthCredentials();
const githubOAuth = getGitHubOAuthCredentials();

export const auth = betterAuth({
  secret: getAuthConfig().secret,
  baseURL: {
    allowedHosts: authAllowedHosts,
    ...(authBaseURLFallback ? { fallback: authBaseURLFallback } : {}),
  },

  database: drizzleAdapter(db, {
    provider: "pg",
    schema: authDbSchemaMap,
  }),

  plugins: createAuthPlugins(),

  hooks: {
    before: lastAdminGuard,
    after: impersonationAudit,
  },

  user: {
    modelName: "users",
    fields: {
      image: "avatarUrl",
    },
    additionalFields: {
      username: { type: "string", required: true },
      lastLoginAt: { type: "date", required: false },
    },
  },

  databaseHooks: {
    user: {
      create: {
        before: async (user) => ({
          data: {
            username: deriveAuthUsername(user),
          },
        }),
        // The membership allowlist runs exactly once per user, here. Linking a
        // second provider account creates an `account` row rather than a
        // `user` row, so it can never re-run this and can never grant
        // membership — which is what makes `allowDifferentEmails` safe.
        after: applySignupMembership,
      },
    },
    session: {
      create: {
        // Exactly one organization exists, so every new session is scoped to
        // it. Sessions issued before it existed are backfilled by the seeder,
        // and `requirePermission()` resolves the organization explicitly, so a
        // NULL here is never load-bearing.
        before: async () => {
          const activeOrganizationId = await getSeededOrganizationId();
          return activeOrganizationId
            ? { data: { activeOrganizationId } }
            : undefined;
        },
      },
    },
  },

  session: {
    modelName: "auth_sessions",
    // `cookieCache` is deliberately absent. Every permission check is a
    // per-request database lookup; caching the session in a cookie would serve
    // a demoted admin their old role for the cache TTL, and nothing in the
    // code would flag it. `config.test.ts` asserts this stays unset.
  },

  account: {
    encryptOAuthTokens: true,
    accountLinking: {
      enabled: true,
      trustedProviders: ["vercel", "github"],
      allowDifferentEmails: true,
    },
  },

  socialProviders: {
    vercel: {
      clientId: vercelOAuth.clientId ?? "",
      clientSecret: vercelOAuth.clientSecret ?? "",
      scope: ["openid", "email", "profile", "offline_access"],
      overrideUserInfoOnSignIn: true,
      mapProfileToUser: mapVercelProfileToUser,
    },
    github: {
      clientId: githubOAuth.clientId ?? "",
      clientSecret: githubOAuth.clientSecret ?? "",
      mapProfileToUser: mapGitHubProfileToUser,
    },
  },

  advanced: {
    database: {
      generateId: () => nanoid(),
    },
  },
});
