/**
 * Answering a pending approval.
 *
 * Authorization runs *before* the row is read, so a caller who may not act on
 * the session learns nothing about whether the approval id exists — a missing
 * approval and somebody else's approval are both 403 at that point.
 *
 * Decisions are one-way. An approval that is already approved, denied, or past
 * its expiry cannot be re-decided: allowing that would let a denial be walked
 * back after the model already received it, and would let an expired approval
 * be revived long after the operation stopped making sense.
 */

import { and, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";
import type { PermissionCheckOptions } from "@/lib/auth/require-permission";
import { db } from "@/lib/db/client";
import { approvals } from "@/lib/db/schema";
import { ApprovalError } from "@/lib/policy/approval-errors";
import { effectiveApprovalDecision } from "@/lib/policy/approval-state";
import { type ApprovalView, toApprovalView } from "@/lib/policy/approval-view";
import { getApprovalForSession } from "@/lib/policy/approvals";
import { isPosture } from "@/lib/policy/posture";
import { recordPolicyEvent } from "@/lib/policy/policy-events";
import { requireSessionActor } from "@/lib/policy/session-access";

/** The only two answers a user can give. */
export const approvalDecisionSchema = z.enum(["approved", "denied"]);
export type ApprovalDecisionValue = z.infer<typeof approvalDecisionSchema>;

export interface DecideApprovalInput {
  sessionId: string;
  approvalId: string;
  decision: ApprovalDecisionValue;
  /** Injected by tests; defaults to the current instant. */
  now?: Date;
  options?: PermissionCheckOptions;
}

const TERMINAL_MESSAGE: Record<string, string> = {
  approved: "This approval has already been approved.",
  denied: "This approval has already been denied.",
  expired:
    "This approval timed out before it was answered, and an expired approval counts as a denial.",
};

/**
 * Record a decision on a pending approval.
 *
 * @throws AuthorizationError when the caller may not act on the session, or
 * ApprovalError (`not-found` / `already-decided` / `invalid`).
 */
export async function decideApproval(
  input: DecideApprovalInput,
): Promise<ApprovalView> {
  const actor = await requireSessionActor(input.sessionId, input.options);

  const parsed = approvalDecisionSchema.safeParse(input.decision);
  if (!parsed.success) {
    throw new ApprovalError(
      "invalid",
      "A decision must be either approved or denied.",
    );
  }
  const decision = parsed.data;
  const now = input.now ?? new Date();

  const row = await getApprovalForSession(input.sessionId, input.approvalId);
  if (!row) {
    throw new ApprovalError(
      "not-found",
      "There is no such approval on this session.",
    );
  }

  const current = effectiveApprovalDecision(row, now);
  if (current !== "pending") {
    throw new ApprovalError(
      "already-decided",
      TERMINAL_MESSAGE[current] ?? "This approval has already been decided.",
    );
  }

  // Conditional on still being pending and unexpired, so two decisions racing
  // each other cannot both win — the loser gets the same 409 as a late click.
  const updated = await db
    .update(approvals)
    .set({ decision, decidedBy: actor.userId, decidedAt: now })
    .where(
      and(
        eq(approvals.id, row.id),
        eq(approvals.sessionId, input.sessionId),
        eq(approvals.decision, "pending"),
        isNull(approvals.consumedAt),
        gt(approvals.expiresAt, now),
      ),
    )
    .returning();

  const next = updated[0];
  if (!next) {
    throw new ApprovalError(
      "already-decided",
      "This approval was decided or expired while the decision was being recorded.",
    );
  }

  const posture = actor.session.posture;
  await recordPolicyEvent({
    sessionId: input.sessionId,
    workflowRunId: next.workflowRunId,
    toolName: next.toolName,
    input: next.inputSummary,
    // An approval that was granted is an `ask` that got its answer; a denial
    // is recorded as a denial, which is what the run actually experienced.
    decision: decision === "approved" ? "ask" : "deny",
    matchedRule: null,
    posture: isPosture(posture) ? posture : "auto",
  });

  return toApprovalView(next, now);
}
