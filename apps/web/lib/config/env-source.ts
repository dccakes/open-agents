/**
 * The single place server-side configuration reads the raw environment.
 *
 * Everything outside `lib/config/**` goes through a typed config group instead
 * — `scripts/check-env-boundary.ts` enforces that in `bun run ci`.
 *
 * Client-visible variables are not read here: Next.js inlines
 * `process.env.NEXT_PUBLIC_*` only for literal member expressions, so those
 * live in `lib/config/public.ts` where they can be written out one by one.
 */

export type RawEnv = Record<string, string | undefined>;

/** Raw server environment, read fresh so runtime mutations are picked up. */
export function readServerEnv(): RawEnv {
  return process.env;
}

/** Read a single server variable by name (for dynamic, schema-less lookups). */
export function readServerEnvValue(name: string): string | undefined {
  return process.env[name];
}
