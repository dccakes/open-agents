/**
 * The one error the approval modules raise.
 *
 * `kind` distinguishes the cases a caller must act on differently — a decision
 * on an approval that is already terminal is a 409, a malformed request is a
 * 400, an unreadable database is a 503 — so no route has to parse a message
 * string. Authorization refusals are *not* modelled here: those raise
 * `AuthorizationError`, which already carries 401 vs 403.
 */

export type ApprovalFailureKind =
  /** No such approval, or not one this session owns. */
  | "not-found"
  /** Already approved, denied, or expired: decisions are one-way. */
  | "already-decided"
  /** The request itself was malformed. */
  | "invalid"
  /** The store could not be read or written. */
  | "unavailable";

export class ApprovalError extends Error {
  readonly kind: ApprovalFailureKind;

  constructor(kind: ApprovalFailureKind, message: string) {
    super(message);
    this.name = "ApprovalError";
    this.kind = kind;
  }

  /** HTTP status a route should answer with. */
  get status(): 400 | 404 | 409 | 503 {
    switch (this.kind) {
      case "not-found":
        return 404;
      case "already-decided":
        return 409;
      case "invalid":
        return 400;
      default:
        return 503;
    }
  }
}

export function isApprovalError(error: unknown): error is ApprovalError {
  return error instanceof ApprovalError;
}
