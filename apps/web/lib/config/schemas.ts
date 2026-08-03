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
