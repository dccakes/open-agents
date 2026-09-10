/**
 * Audit trail for membership and impersonation events.
 *
 * There is no durable audit table yet — `config_audit` arrives with the
 * `shared-config-governance` change, and this change is explicitly not allowed
 * to add a migration. Until it lands, an audit record is a single structured
 * log line, which is queryable in the platform's log drain and is strictly
 * better than the nothing that exists today.
 *
 * Written on a best-effort basis: an audit failure must never take down the
 * action it describes.
 */

export type AuditAction =
  | "membership.auto_granted"
  | "membership.approved"
  | "membership.rejected"
  | "membership.role_changed"
  | "membership.removed"
  | "membership.shares_revoked"
  | "membership.sessions_revoked"
  | "platform_role.changed"
  | "impersonation.started"
  | "impersonation.stopped";

export interface AuditEvent {
  action: AuditAction;
  /** The user who performed the action, when there is one. */
  actorId?: string | null;
  /** The user the action was performed on. */
  targetId?: string | null;
  organizationId?: string | null;
  metadata?: Record<string, string | number | boolean | null>;
}

/** The prefix every audit line carries, so a log query can select on it. */
export const AUDIT_LOG_PREFIX = "[audit]";

export function recordAuditEvent(event: AuditEvent): void {
  try {
    console.info(
      AUDIT_LOG_PREFIX,
      JSON.stringify({ at: new Date().toISOString(), ...event }),
    );
  } catch {
    // An audit write must never fail the action it describes.
  }
}
