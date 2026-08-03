/**
 * Redis / Vercel KV connection and the rate-limit timeout that depends on it.
 *
 * Both URLs are trimmed and blank-collapsed here because the callers treat
 * whitespace-only values as "not configured".
 */

import { defineEnvGroup } from "@/lib/config/env-group";
import { optionalRawString, optionalTrimmedString } from "@/lib/config/schemas";

export const redisEnv = defineEnvGroup({
  name: "redis",
  specs: {
    REDIS_URL: {
      axis: "optional",
      secret: true,
      description:
        "Redis connection string. Enables rate limiting and workspace status fan-out; preferred over KV_URL.",
      schema: optionalTrimmedString,
    },
    KV_URL: {
      axis: "optional",
      secret: true,
      description:
        "Vercel KV connection string, used when REDIS_URL is unset. Provided by the Upstash integration.",
      schema: optionalTrimmedString,
    },
    RATE_LIMIT_TIMEOUT_MS: {
      axis: "optional",
      description:
        "Milliseconds to wait on a Redis rate-limit check before failing open (default 1000).",
      example: "1000",
      schema: optionalRawString,
    },
  },
});

export interface RedisConfig {
  /** Effective Redis URL: `REDIS_URL`, else `KV_URL`, else `null`. */
  url: string | null;
  /** Raw rate-limit timeout override; parsing stays with the caller. */
  rateLimitTimeoutMs?: string;
}

export function getRedisConfig(): RedisConfig {
  const env = redisEnv.read();

  return {
    url: env.REDIS_URL ?? env.KV_URL ?? null,
    rateLimitTimeoutMs: env.RATE_LIMIT_TIMEOUT_MS,
  };
}
