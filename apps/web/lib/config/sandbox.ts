/**
 * Sandbox infrastructure: provider credentials, env resolvers, and the DB
 * provisioners that back session-scoped databases.
 *
 * Provider *config fields* (`VERCEL_TEAM`, `DOCKER_SANDBOX_IMAGE`,
 * `DAYTONA_*`) are declared by `@open-agents/sandbox` and looked up by key at
 * runtime, so they are documented here but reached through
 * `readProviderConfigValue()` rather than a typed accessor.
 */

import { defineEnvGroup } from "@/lib/config/env-group";
import { readServerEnvValue } from "@/lib/config/env-source";
import { optionalRawString } from "@/lib/config/schemas";

export const sandboxEnv = defineEnvGroup({
  name: "sandbox",
  specs: {
    SANDBOX_ENV_RESOLVER: {
      axis: "optional",
      description:
        "Backend used to resolve env vars injected into sandboxes: `vercel` or `infisical`. Unset disables resolution.",
      schema: optionalRawString,
    },
    VERCEL_SANDBOX_BASE_SNAPSHOT_ID: {
      axis: "optional",
      description:
        "Optional prebuilt snapshot for fresh cloud sandboxes. Unset starts from Vercel's standard runtime.",
      schema: optionalRawString,
    },
    VERCEL_SANDBOX_TIMEOUT_MS: {
      axis: "optional",
      description:
        "Override for the default sandbox lifetime in milliseconds. Ignored when non-numeric; clamped to the provider maximum.",
      example: "17970000",
      schema: optionalRawString,
    },
    VERCEL_ACCESS_TOKEN: {
      axis: "optional",
      requiredWith: ["SANDBOX_ENV_RESOLVER"],
      secret: true,
      description:
        "Vercel API token used by the `vercel` env resolver to read project environment variables.",
      schema: optionalRawString,
    },
    VERCEL_PROJECT_ID: {
      axis: "optional",
      description:
        "Project whose environment variables the `vercel` env resolver reads.",
      schema: optionalRawString,
    },
    VERCEL_TEAM: {
      axis: "optional",
      description:
        "Vercel team slug for the Vercel sandbox provider. Also settable per user in sandbox settings.",
      schema: optionalRawString,
    },
    INFISICAL_TOKEN: {
      axis: "optional",
      secret: true,
      description: "Infisical service token for the `infisical` env resolver.",
      schema: optionalRawString,
    },
    INFISICAL_PROJECT_ID: {
      axis: "optional",
      description: "Infisical workspace/project ID for the env resolver.",
      schema: optionalRawString,
    },
    INFISICAL_BASE_URL: {
      axis: "optional",
      description:
        "Infisical API base URL (default https://app.infisical.com). Set for self-hosted instances.",
      example: "https://app.infisical.com",
      schema: optionalRawString,
    },
    NEON_API_KEY: {
      axis: "optional",
      requiredWith: ["NEON_PROJECT_ID"],
      secret: true,
      description:
        "Neon API key used to branch a session-scoped database per sandbox.",
      schema: optionalRawString,
    },
    NEON_PROJECT_ID: {
      axis: "optional",
      requiredWith: ["NEON_API_KEY"],
      description: "Neon project the session database branches are created in.",
      schema: optionalRawString,
    },
    DOCKER_SANDBOX_IMAGE: {
      axis: "dev-only",
      description:
        "Image used by the local Docker sandbox provider (default open-agents/sandbox-dev:latest).",
      example: "open-agents/sandbox-dev:latest",
      schema: optionalRawString,
    },
    DOCKER_POSTGRES_IMAGE: {
      axis: "dev-only",
      description:
        "Image used to provision a local Postgres for Docker sandboxes (default postgres:16-alpine).",
      example: "postgres:16-alpine",
      schema: optionalRawString,
    },
    DOCKER_POSTGRES_USER: {
      axis: "dev-only",
      description:
        "User for the locally provisioned Postgres container (default postgres).",
      example: "postgres",
      schema: optionalRawString,
    },
    DAYTONA_BETA_ENABLED: {
      axis: "optional",
      description:
        "Set to `true` or `1` to expose the beta Daytona sandbox provider.",
      schema: optionalRawString,
    },
    DAYTONA_API_KEY: {
      axis: "optional",
      secret: true,
      description:
        "Daytona API key. Also settable per user in sandbox settings.",
      schema: optionalRawString,
    },
    DAYTONA_SERVER_URL: {
      axis: "optional",
      description:
        "Daytona server URL. Also settable per user in sandbox settings.",
      example: "https://app.daytona.io",
      schema: optionalRawString,
    },
  },
});

export interface SandboxEnvResolverConfig {
  /** Selected backend, unvalidated — the resolver factory owns the error. */
  backend?: string;
  vercelAccessToken?: string;
  vercelProjectId?: string;
  infisicalToken?: string;
  infisicalProjectId?: string;
  infisicalBaseUrl?: string;
}

export interface SandboxRuntimeConfig {
  baseSnapshotId?: string;
  /** Raw timeout override; parsing and clamping stay with the caller. */
  timeoutMsOverride?: string;
}

export interface SandboxDbProvisionerConfig {
  neonApiKey?: string;
  neonProjectId?: string;
  dockerPostgresImage?: string;
  dockerPostgresUser?: string;
}

export function getSandboxRuntimeConfig(): SandboxRuntimeConfig {
  const env = sandboxEnv.read();

  return {
    baseSnapshotId: env.VERCEL_SANDBOX_BASE_SNAPSHOT_ID,
    timeoutMsOverride: env.VERCEL_SANDBOX_TIMEOUT_MS,
  };
}

export function getSandboxEnvResolverConfig(): SandboxEnvResolverConfig {
  const env = sandboxEnv.read();

  return {
    backend: env.SANDBOX_ENV_RESOLVER,
    vercelAccessToken: env.VERCEL_ACCESS_TOKEN,
    vercelProjectId: env.VERCEL_PROJECT_ID,
    infisicalToken: env.INFISICAL_TOKEN,
    infisicalProjectId: env.INFISICAL_PROJECT_ID,
    infisicalBaseUrl: env.INFISICAL_BASE_URL,
  };
}

export function getSandboxDbProvisionerConfig(): SandboxDbProvisionerConfig {
  const env = sandboxEnv.read();

  return {
    neonApiKey: env.NEON_API_KEY,
    neonProjectId: env.NEON_PROJECT_ID,
    dockerPostgresImage: env.DOCKER_POSTGRES_IMAGE,
    dockerPostgresUser: env.DOCKER_POSTGRES_USER,
  };
}

/**
 * Look up a sandbox provider config field by key.
 *
 * Provider definitions carry their own field lists, so the key is only known
 * at runtime. Every key reachable here is declared in `sandboxEnv` above.
 */
export function readProviderConfigValue(key: string): string | undefined {
  return readServerEnvValue(key);
}
