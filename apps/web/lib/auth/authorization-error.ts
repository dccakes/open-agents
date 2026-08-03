/**
 * The one error every authorization refusal raises.
 *
 * `reason` distinguishes "no session" from "session, but not allowed" so a
 * route can answer 401 or 403 without two class hierarchies.
 */

export type AuthorizationFailureReason = "unauthenticated" | "forbidden";

export class AuthorizationError extends Error {
  readonly reason: AuthorizationFailureReason;

  constructor(reason: AuthorizationFailureReason, message?: string) {
    super(
      message ??
        (reason === "unauthenticated" ? "Not authenticated" : "Forbidden"),
    );
    this.name = "AuthorizationError";
    this.reason = reason;
  }

  /** HTTP status a route should answer with. */
  get status(): 401 | 403 {
    return this.reason === "unauthenticated" ? 401 : 403;
  }
}

export function isAuthorizationError(
  error: unknown,
): error is AuthorizationError {
  return error instanceof AuthorizationError;
}
