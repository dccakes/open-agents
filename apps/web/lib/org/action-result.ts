/**
 * The one result envelope the admin-area server actions return.
 *
 * `status` travels with the result so a denial reads as 403 at the caller
 * rather than as an indistinguishable failure string — that is the whole
 * reason this is a discriminated result rather than a thrown error crossing
 * the `"use server"` boundary.
 *
 * The mapping is deliberately narrow: an `AuthorizationError` and an
 * `OrgSettingsError` carry a status worth surfacing, and anything else is
 * logged server-side and reported as a generic 500. A raw error message from
 * an unexpected failure is not something to put in front of a user.
 */

import { isAuthorizationError } from "@/lib/auth/authorization-error";
import { isOrgSettingsError } from "@/lib/org/settings-errors";

export type ActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; status: number };

/**
 * The failure half, on its own.
 *
 * `toActionError` only ever produces this, and saying so lets callers whose
 * success branch is shaped differently (`{ settings }` rather than `{ data }`)
 * reuse the mapping without a cast.
 */
export interface ActionFailure {
  success: false;
  error: string;
  status: number;
}

export interface ActionErrorOptions {
  /** Prefixes the server-side log line for an unexpected failure. */
  logPrefix: string;
  /** Shown to the user when the failure is not one we can explain. */
  fallbackMessage: string;
}

export function toActionError(
  error: unknown,
  options: ActionErrorOptions,
): ActionFailure {
  if (isAuthorizationError(error)) {
    return { success: false, error: error.message, status: error.status };
  }
  if (isOrgSettingsError(error)) {
    return { success: false, error: error.message, status: error.status };
  }

  const message = error instanceof Error ? error.message : String(error);
  console.error(`${options.logPrefix} Action failed:`, message);
  return {
    success: false,
    error: options.fallbackMessage,
    status: 500,
  };
}
