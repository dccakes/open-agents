/**
 * Frontend origins permitted to call BotID-protected endpoints.
 *
 * The upstream template hard-codes its own domain, which is wrong for forks
 * served from a custom domain. `BOTID_EXTRA_ALLOWED_HOSTS` (comma-separated)
 * lets a deployment declare its own hosts without editing code.
 */

import { getDeploymentConfig } from "@/lib/config/deployment";

/** Vercel-owned hosts plus the upstream template domain. */
export const BASE_BOTID_ALLOWED_HOSTS = [
  "vercel.com",
  "*.vercel.com",
  "*.vercel.dev",
  "*.vercel.run",
  "*.open-agents.dev",
] as const;

/** Parse a comma-separated host list into normalized, de-duplicated entries. */
export function parseExtraAllowedHosts(rawValue: string | undefined): string[] {
  return Array.from(
    new Set(
      (rawValue ?? "")
        .split(",")
        .map((host) => host.trim().toLowerCase())
        .filter((host) => host.length > 0),
    ),
  );
}

/** Resolve the full allowed-host list for the current deployment. */
export function resolveBotIdAllowedHosts(
  rawValue: string | undefined = getDeploymentConfig().botIdExtraAllowedHosts,
): string[] {
  const configured = parseExtraAllowedHosts(rawValue);
  return Array.from(new Set([...BASE_BOTID_ALLOWED_HOSTS, ...configured]));
}
