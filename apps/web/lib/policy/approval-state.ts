/**
 * What an approval row *means* right now.
 *
 * Expiry is computed here, on read, rather than being a state some job is
 * responsible for writing. The sweeper (`approval-sweeper.ts`) only
 * materializes what this module already reports, and it only runs in
 * production — so if expiry were a written state, the 24-hour timeout would be
 * a security property that silently did not hold in preview or locally.
 *
 * Pure: no database, no configuration read beyond the timeout, no clock of its
 * own. Callers pass `now`, which is what makes expiry testable without waiting.
 */

import { getApprovalTimeoutMs } from "@/lib/config/agent-policy";

/** The stored column value. */
export type StoredApprovalDecision =
  | "pending"
  | "approved"
  | "denied"
  | "expired";

/** The decision as a reader must act on it. */
export type EffectiveApprovalDecision = StoredApprovalDecision;

/** The subset of an approval row this module needs. */
export interface ApprovalStateView {
  decision: StoredApprovalDecision;
  expiresAt: Date;
  consumedAt: Date | null;
}

/** True once the expiry instant has arrived. The instant itself counts. */
export function isPastExpiry(view: ApprovalStateView, now: Date): boolean {
  return view.expiresAt.getTime() <= now.getTime();
}

/**
 * The decision every reader must act on.
 *
 * An `approved` row past its expiry reports `expired`, not `approved`:
 * approving does not freeze the clock, so an approval granted three days ago
 * cannot still authorize an execution today. An explicit `denied` stays
 * `denied` — it is already terminal and the reason it is terminal matters.
 */
export function effectiveApprovalDecision(
  view: ApprovalStateView,
  now: Date,
): EffectiveApprovalDecision {
  if (view.decision === "denied") {
    return "denied";
  }
  if (view.decision === "expired") {
    return "expired";
  }
  return isPastExpiry(view, now) ? "expired" : view.decision;
}

/**
 * Whether this approval refuses the operation.
 *
 * An expired approval is a *denial*, not a re-prompt: the user already chose
 * not to answer, and asking again would let an attacker who can wait out the
 * window get a second chance at the same prompt.
 */
export function isApprovalDenied(view: ApprovalStateView, now: Date): boolean {
  const decision = effectiveApprovalDecision(view, now);
  return decision === "denied" || decision === "expired";
}

/**
 * Whether this approval can still authorize one execution.
 *
 * Approvals are single-use, so a row that has already been consumed is not
 * spendable however recently it was approved. The atomic compare-and-set that
 * *makes* consumption single-use lives in `approval-enforcement.ts`; this is
 * the read-side predicate for reporting and for tests.
 */
export function isApprovalSpendable(
  view: ApprovalStateView,
  now: Date,
): boolean {
  return (
    effectiveApprovalDecision(view, now) === "approved" &&
    view.consumedAt === null
  );
}

/** The expiry a newly requested approval should carry. */
export function approvalExpiresAt(createdAt: Date): Date {
  return new Date(createdAt.getTime() + getApprovalTimeoutMs());
}
