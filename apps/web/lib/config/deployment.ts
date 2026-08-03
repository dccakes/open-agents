/**
 * Deployment shape: which environment this process is, and where it is served.
 *
 * Read through literal `process.env.*` expressions so Next.js keeps inlining
 * `NODE_ENV` in bundles that are also reachable from the browser.
 */

import { defineEnvGroup } from "@/lib/config/env-group";
import { optionalRawString } from "@/lib/config/schemas";

export type DeploymentEnvironment = "production" | "preview" | "development";

export type ResourceProfile = "standard" | "hobby";

export const deploymentEnv = defineEnvGroup({
  name: "deployment",
  source: () => ({
    NODE_ENV: process.env.NODE_ENV,
    VERCEL_ENV: process.env.VERCEL_ENV,
    VERCEL_URL: process.env.VERCEL_URL,
    VERCEL_PROJECT_PRODUCTION_URL: process.env.VERCEL_PROJECT_PRODUCTION_URL,
    OPEN_AGENTS_RESOURCE_PROFILE: process.env.OPEN_AGENTS_RESOURCE_PROFILE,
    BOTID_EXTRA_ALLOWED_HOSTS: process.env.BOTID_EXTRA_ALLOWED_HOSTS,
  }),
  specs: {
    NODE_ENV: {
      axis: "optional",
      description:
        "Node environment. Set by the framework — `development`, `production`, or `test`.",
      example: "development",
      schema: optionalRawString,
    },
    VERCEL_ENV: {
      axis: "optional",
      description:
        "Vercel deployment environment (`production`, `preview`, `development`). Set automatically by Vercel.",
      schema: optionalRawString,
    },
    VERCEL_URL: {
      axis: "optional",
      description:
        "Hostname of this specific deployment. Set automatically by Vercel.",
      schema: optionalRawString,
    },
    VERCEL_PROJECT_PRODUCTION_URL: {
      axis: "optional",
      description:
        "Production hostname of the project. Set automatically by Vercel.",
      schema: optionalRawString,
    },
    OPEN_AGENTS_RESOURCE_PROFILE: {
      axis: "optional",
      description:
        "Set to `hobby` to shrink sandbox vCPUs and lifetimes for Vercel Hobby limits.",
      example: "standard",
      schema: optionalRawString,
    },
    BOTID_EXTRA_ALLOWED_HOSTS: {
      axis: "optional",
      description:
        "Comma-separated extra frontend hosts allowed to call BotID-protected endpoints.",
      example: "quackops.example.com,www.quackops.example.com",
      schema: optionalRawString,
    },
  },
});

export interface DeploymentConfig {
  /** Effective deployment environment (`VERCEL_ENV`, else derived from `NODE_ENV`). */
  environment: DeploymentEnvironment;
  /** True when `NODE_ENV === "production"` — the check most call sites want. */
  isProduction: boolean;
  /** True when `NODE_ENV === "development"`. */
  isDevelopment: boolean;
  /** True when this is a Vercel preview deployment. */
  isPreview: boolean;
  /** Hostname of this deployment, when Vercel provides one. */
  deploymentUrl?: string;
  /** Production hostname of the project, when Vercel provides one. */
  productionUrl?: string;
  /** Sandbox resource profile. */
  resourceProfile: ResourceProfile;
  /** Raw comma-separated BotID host allowlist, if configured. */
  botIdExtraAllowedHosts?: string;
}

function resolveEnvironment(
  vercelEnv: string | undefined,
  nodeEnv: string | undefined,
): DeploymentEnvironment {
  if (
    vercelEnv === "production" ||
    vercelEnv === "preview" ||
    vercelEnv === "development"
  ) {
    return vercelEnv;
  }

  return nodeEnv === "production" ? "production" : "development";
}

export function getDeploymentConfig(): DeploymentConfig {
  const env = deploymentEnv.read();

  return {
    environment: resolveEnvironment(env.VERCEL_ENV, env.NODE_ENV),
    isProduction: env.NODE_ENV === "production",
    isDevelopment: env.NODE_ENV === "development",
    isPreview: env.VERCEL_ENV === "preview",
    deploymentUrl: env.VERCEL_URL,
    productionUrl: env.VERCEL_PROJECT_PRODUCTION_URL,
    resourceProfile:
      env.OPEN_AGENTS_RESOURCE_PROFILE === "hobby" ? "hobby" : "standard",
    botIdExtraAllowedHosts: env.BOTID_EXTRA_ALLOWED_HOSTS,
  };
}

/** True only for a Vercel *production* deployment, used by boot validation. */
export function isProductionDeployment(): boolean {
  return getDeploymentConfig().environment === "production";
}
