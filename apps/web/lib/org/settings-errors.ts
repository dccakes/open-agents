/**
 * The one error the organization-settings module raises.
 *
 * `kind` distinguishes "the settings could not be read" from "the caller sent
 * nonsense", following `AuthorizationError`'s shape rather than adding a class
 * hierarchy. The distinction is load-bearing: a run-start path must refuse the
 * run on `unavailable`, and no caller should have to parse a message string to
 * work that out.
 */

export type OrgSettingsFailureKind = "unavailable" | "invalid";

export class OrgSettingsError extends Error {
  readonly kind: OrgSettingsFailureKind;

  constructor(kind: OrgSettingsFailureKind, message: string) {
    super(message);
    this.name = "OrgSettingsError";
    this.kind = kind;
  }

  /** HTTP status a caller should answer with. */
  get status(): 400 | 503 {
    return this.kind === "invalid" ? 400 : 503;
  }
}

export function isOrgSettingsError(error: unknown): error is OrgSettingsError {
  return error instanceof OrgSettingsError;
}
