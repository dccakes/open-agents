/**
 * The expiry sweeper.
 *
 * This job is *not* what makes approvals time out. Expiry is computed on read
 * by `approval-state.ts`, in every environment, whether or not this has ever
 * run — because this handler deliberately writes nothing outside production,
 * and "the 24-hour timeout only works in production" would be a security
 * property that silently did not hold in preview or locally.
 *
 * What the sweeper adds is materialization: it turns rows that already *read*
 * as expired into rows that *are* expired, and emits the `policy_event` for
 * each, so the audit trail records the timeout as an event rather than leaving
 * it implicit in a comparison nobody logged.
 *
 * The production-only guard is the phase ground rule: preview databases are
 * Neon forks of production, so a preview cron writing to them writes against
 * forked rows that point at real external resources.
 */

import { and, eq, lte } from "drizzle-orm";
import { getDeploymentConfig } from "@/lib/config/deployment";
import { db } from "@/lib/db/client";
import { approvals } from "@/lib/db/schema";
import { recordPolicyEvents } from "@/lib/policy/policy-events";

export interface SweepResult {
  /** True when the handler returned without writing anything. */
  skipped: boolean;
  /** Why it was skipped, when it was. */
  reason?: string;
  /** How many approvals were materialized as expired. */
  expired: number;
}

export const SWEEPER_SKIPPED_REASON =
  "The approval expiry sweeper only writes on a production deployment; preview databases are forks of production. Expiry itself is computed on read and is unaffected.";

/**
 * Materialize every pending approval whose expiry has passed.
 *
 * @param now injected by tests; defaults to the current instant.
 */
export async function sweepExpiredApprovals(
  now: Date = new Date(),
): Promise<SweepResult> {
  if (getDeploymentConfig().environment !== "production") {
    return { skipped: true, reason: SWEEPER_SKIPPED_REASON, expired: 0 };
  }

  const expired = await db
    .update(approvals)
    .set({ decision: "expired" })
    .where(
      and(eq(approvals.decision, "pending"), lte(approvals.expiresAt, now)),
    )
    .returning();

  if (expired.length === 0) {
    return { skipped: false, expired: 0 };
  }

  await recordPolicyEvents(
    expired.map((row) => ({
      sessionId: row.sessionId,
      workflowRunId: row.workflowRunId,
      toolName: row.toolName,
      input: row.inputSummary,
      decision: "expired" as const,
      matchedRule: null,
      // The sweeper does not know the posture the run had; the approval row is
      // the record of the operation, and the policy event records the timeout.
      posture: "auto" as const,
    })),
  );

  return { skipped: false, expired: expired.length };
}
