/**
 * The audit seam for organization-settings changes.
 *
 * Org settings is an app-owned mutation, so the strong guarantee applies: the
 * audit record has to be written in the *same transaction* as the mutation, or
 * a crash between the two produces a change nobody can account for. That is
 * why `recordOrgSettingsAudit` takes the transaction handle rather than the
 * `db` client — the fill-in is transactional by construction, not by the next
 * author remembering.
 *
 * Deliberately separate from `lib/audit/record.ts`, which logs membership and
 * impersonation events on a best-effort basis and swallows its own failures.
 * That is the right shape there and the wrong one here: an org-settings change
 * is an app-owned mutation, so its record must be able to fail the mutation.
 * `shared-config-governance` should fold both onto `config_audit`.
 *
 * SEAM — the `config_audit` table belongs to the `shared-config-governance`
 * change and does not exist yet. That change fills the body of
 * `recordOrgSettingsAudit` with its `tx.insert(configAudit)...` and nothing
 * else here has to move: the call site, the transaction boundary, the actor,
 * the field-level before/after values, and the timestamp are already assembled.
 * Until then the entry is logged, so a change made before the table lands is
 * still traceable in deployment logs rather than silently unrecorded.
 */

import type { db } from "@/lib/db/client";

/** The transaction handle Drizzle hands to `db.transaction(...)`. */
export type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** One column's before/after, so the record answers "changed from what?". */
export interface OrgSettingsChange {
  field: "agentRunsPaused" | "dailyTokenBudget";
  previousValue: boolean | number | null;
  newValue: boolean | number | null;
}

export interface OrgSettingsAuditEntry {
  organizationId: string;
  /** The user id of the caller who made the change. */
  actorId: string;
  changes: OrgSettingsChange[];
  occurredAt: Date;
}

/**
 * Record an organization-settings change.
 *
 * @param transaction the open transaction the mutation was made in — passing
 * the `db` client instead would break the atomicity this exists to provide.
 */
export async function recordOrgSettingsAudit(
  transaction: DbTransaction,
  entry: OrgSettingsAuditEntry,
): Promise<void> {
  // SEAM: `shared-config-governance` replaces this log with an insert into
  // `config_audit` using `transaction`, keeping the call inside this function
  // so the transaction boundary above stays the one that governs it.
  void transaction;

  const summary = entry.changes
    .map(
      (change) =>
        `${change.field}: ${String(change.previousValue)} -> ${String(change.newValue)}`,
    )
    .join(", ");

  console.info(
    `[org-settings] ${entry.actorId} changed ${summary} for organization ${entry.organizationId} at ${entry.occurredAt.toISOString()}`,
  );
}
