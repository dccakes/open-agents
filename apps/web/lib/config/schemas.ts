/**
 * Reusable value schemas for environment variables.
 *
 * These stay deliberately permissive. The config boundary centralizes *where*
 * variables are read, not *when* they fail — call sites keep their existing
 * checks and user-facing error messages, and `validateServerConfig()` owns the
 * "must be set in production" question.
 */

import { z } from "zod";

/** Raw value, passed through untouched (`undefined` when unset). */
export const optionalRawString = z.string().optional();

/** Trimmed value where blank and whitespace-only collapse to `undefined`. */
export const optionalTrimmedString = z
  .string()
  .optional()
  .transform((value) => {
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
  });

/** Boolean flag using the repo's existing `"true"` / `"1"` convention. */
export const optionalBooleanFlag = z
  .string()
  .optional()
  .transform((value) => value === "true" || value === "1");

/**
 * Split a comma-separated list into lowercase, de-duplicated entries.
 *
 * Returns `undefined` rather than `[]` when nothing survives, so
 * `collectConfigProblems()` sees an unset — or blank — list as *missing* and
 * can enforce a `required-prod` axis on it.
 */
function parseCommaSeparatedList(
  value: string | undefined,
  normalize: (entry: string) => string,
): readonly string[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  const entries = new Set<string>();
  for (const part of value.split(",")) {
    const normalized = normalize(part.trim().toLowerCase());
    if (normalized) {
      entries.add(normalized);
    }
  }

  return entries.size > 0 ? [...entries] : undefined;
}

/**
 * Comma-separated email domains, e.g. `nextdegree.org,example.com`.
 *
 * A leading `@` is tolerated so `@example.com` and `example.com` mean the same
 * thing. Matching is exact on the domain part — no subdomain wildcards.
 */
export const optionalDomainList = z
  .string()
  .optional()
  .transform((value) =>
    parseCommaSeparatedList(value, (entry) =>
      entry.startsWith("@") ? entry.slice(1) : entry,
    ),
  );

/** Comma-separated email addresses, compared case-insensitively. */
export const optionalEmailList = z
  .string()
  .optional()
  .transform((value) => parseCommaSeparatedList(value, (entry) => entry));
