/**
 * Browser-visible configuration (`NEXT_PUBLIC_*`).
 *
 * Values are read through literal `process.env.NEXT_PUBLIC_*` expressions:
 * Next.js only inlines that exact shape into client bundles, so a dynamic
 * lookup here would silently resolve to `undefined` in the browser. This module
 * must stay free of server-only imports — client components import it.
 */

import { defineEnvGroup } from "@/lib/config/env-group";
import { optionalRawString } from "@/lib/config/schemas";

export const publicEnv = defineEnvGroup({
  name: "public",
  source: () => ({
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_GITHUB_APP_SLUG: process.env.NEXT_PUBLIC_GITHUB_APP_SLUG,
    NEXT_PUBLIC_GITHUB_CLIENT_ID: process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID,
    NEXT_PUBLIC_VERCEL_APP_CLIENT_ID:
      process.env.NEXT_PUBLIC_VERCEL_APP_CLIENT_ID,
    NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL:
      process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL,
  }),
  specs: {
    NEXT_PUBLIC_APP_URL: {
      axis: "optional",
      description:
        "Canonical public origin, e.g. https://quackops.example.com. Used for OAuth redirects and Linear webhook registration; falls back to the request origin.",
      example: "https://quackops.example.com",
      schema: optionalRawString,
    },
    NEXT_PUBLIC_GITHUB_APP_SLUG: {
      axis: "optional",
      requiredWith: ["GITHUB_APP_ID"],
      description:
        "Slug of the GitHub App, used to build install and manage URLs.",
      example: "quackops",
      schema: optionalRawString,
    },
    NEXT_PUBLIC_GITHUB_CLIENT_ID: {
      axis: "optional",
      requiredWith: ["GITHUB_CLIENT_SECRET"],
      description: "GitHub OAuth client ID used for sign-in and repo access.",
      example: "Iv1.0123456789abcdef",
      schema: optionalRawString,
    },
    NEXT_PUBLIC_VERCEL_APP_CLIENT_ID: {
      axis: "required-prod",
      description: "Vercel OAuth client ID — the primary sign-in provider.",
      example: "oac_0123456789abcdef",
      schema: optionalRawString,
    },
    NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL: {
      axis: "optional",
      description:
        "Production hostname exposed to the browser (Vercel sets this automatically). Used for share links and PR back-links.",
      example: "quackops.example.com",
      schema: optionalRawString,
    },
  },
});

export interface PublicConfig {
  /** Canonical public origin, when the deployment declares one. */
  appUrl?: string;
  /** GitHub App slug, when the GitHub App is configured. */
  githubAppSlug?: string;
  /** GitHub OAuth client ID. */
  githubClientId?: string;
  /** Vercel OAuth client ID. */
  vercelClientId?: string;
  /** Production hostname (no protocol), when known. */
  productionUrl?: string;
}

export function getPublicConfig(): PublicConfig {
  const env = publicEnv.read();

  return {
    appUrl: env.NEXT_PUBLIC_APP_URL,
    githubAppSlug: env.NEXT_PUBLIC_GITHUB_APP_SLUG,
    githubClientId: env.NEXT_PUBLIC_GITHUB_CLIENT_ID,
    vercelClientId: env.NEXT_PUBLIC_VERCEL_APP_CLIENT_ID,
    productionUrl: env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL,
  };
}
