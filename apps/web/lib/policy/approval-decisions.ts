/**
 * Answering a pending approval.
 *
 * Two entry points, one write. They differ only in how the actor was
 * established — `decideApproval` authorizes the caller itself, while
 * `recordAssertedApprovalDecision` is handed an actor the caller has already
 * authorized — and both go through the same conditional UPDATE, so neither can
 * decide a row the other would have refused.
 *
 * For `decideApproval`, authorization runs *before* the row is read, so a
 * caller who may not act on the session learns nothing about whether the
 * approval id exists — a missing approval and somebody else's approval are both
 * 403 at that point.
 *
 * Decisions are one-way. An approval that is already approved, denied, or past
 * its expiry cannot be re-decided: allowing that would let a denial be walked
 * back after the model already received it, and would let an expired approval
 * be revived long after the operation stopped making sense.
 *
 * Deciding an approval is never the same thing as *spending* one. This module
 * only ever moves `pending` to `approved` or `denied`; the single-use
 * compare-and-set that authorizes an execution stays in
 * `approval-enforcement.ts`.
 */

import { and, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";
import type { PermissionCheckOptions } from "@/lib/auth/require-permission";
import { db } from "@/lib/db/client";
import { type Approval, approvals } from "@/lib/db/schema";
import { ApprovalError } from "@/lib/policy/approval-errors";
import { effectiveApprovalDecision } from "@/lib/policy/approval-state";
import { type ApprovalView, toApprovalView } from "@/lib/policy/approval-view";
import {
  getApprovalByToolCall,
  getApprovalForSession,
} from "@/lib/policy/approvals";
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

interface DecisionWrite {
  row: Approval;
  sessionId: string;
  decision: ApprovalDecisionValue;
  /** Attribution. Always an authenticated user, never a claim from a body. */
  actorUserId: string;
  posture: string;
  now: Date;
}

/**
 * The conditional write every decision goes through, plus its audit record.
 *
 * Conditional on the row still being pending, unspent and unexpired, so two
 * decisions racing each other cannot both win and an expired approval cannot be
 * revived. Returns `null` when the write matched nothing; callers decide
 * whether that is an error or simply nothing to do.
 */
async function writeDecision(write: DecisionWrite): Promise<Approval | null> {
  const updated = await db
    .update(approvals)
    .set({
      decision: write.decision,
      decidedBy: write.actorUserId,
      decidedAt: write.now,
    })
    .where(
      and(
        eq(approvals.id, write.row.id),
        eq(approvals.sessionId, write.sessionId),
        eq(approvals.decision, "pending"),
        isNull(approvals.consumedAt),
        gt(approvals.expiresAt, write.now),
      ),
    )
    .returning();

  const next = updated[0];
  if (!next) {
    return null;
  }

  await recordPolicyEvent({
    sessionId: write.sessionId,
    workflowRunId: next.workflowRunId,
    toolName: next.toolName,
    input: next.inputSummary,
    // An approval that was granted is an `ask` that got its answer; a denial
    // is recorded as a denial, which is what the run actually experienced.
    decision: write.decision === "approved" ? "ask" : "deny",
    matchedRule: null,
    posture: isPosture(write.posture) ? write.posture : "auto",
  });

  return next;
}

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

  // The loser of a race gets the same 409 as a late click.
  const next = await writeDecision({
    row,
    sessionId: input.sessionId,
    decision,
    actorUserId: actor.userId,
    posture: actor.session.posture,
    now,
  });

  if (!next) {
    throw new ApprovalError(
      "already-decided",
      "This approval was decided or expired while the decision was being recorded.",
    );
  }

  return toApprovalView(next, now);
}

export interface AssertedApprovalDecisionInput {
  sessionId: string;
  /** The tool call the approval row is keyed on. */
  toolCallId: string;
  decision: ApprovalDecisionValue;
  /**
   * The authenticated caller, whose right to act on this session the caller of
   * *this* function has already established. Never taken from a request body.
   */
  actorUserId: string;
  /** The session's posture, for the audit record. */
  posture: string;
  /** Injected by tests; defaults to the current instant. */
  now?: Date;
}

/**
 * Record the decision a resume request says the user gave.
 *
 * The approval a policy `ask` writes is answered in the chat, and that answer
 * only ever reaches the server inside the next request's message parts. Without
 * this, no path moved a `tool-call` row off `pending`, so every answered `ask`
 * resumed into a refusal and the operation could never run.
 *
 * What keeps that from being a way to mint approvals: this only ever transitions
 * a row that **already exists** because a policy `ask` created it, and only
 * while it is still pending. A claim about a tool call nobody gated finds no
 * row and gets nothing; a claim about a denied, expired, or already-spent row
 * changes nothing. Verification runs immediately afterwards and is what
 * actually admits the request, so a claim this quietly declines to record is
 * still refused there.
 *
 * Never throws for a claim it cannot honour — declining to record is the
 * fail-closed direction, and the refusal is the verifier's to produce.
 */
export async function recordAssertedApprovalDecision(
  input: AssertedApprovalDecisionInput,
): Promise<void> {
  const parsed = approvalDecisionSchema.safeParse(input.decision);
  if (!parsed.success) {
    return;
  }

  const now = input.now ?? new Date();
  const row = await getApprovalByToolCall(input.sessionId, input.toolCallId);

  // A kind mismatch is nothing to decide: an app side effect is answered
  // through its own route, not by asserting a tool call was approved.
  if (!row || row.kind !== "tool-call") {
    return;
  }

  // Terminal states stay terminal, expiry included. The write below is
  // conditional on the same thing, so this only decides the refusal's shape.
  if (effectiveApprovalDecision(row, now) !== "pending") {
    return;
  }

  await writeDecision({
    row,
    sessionId: input.sessionId,
    decision: parsed.data,
    actorUserId: input.actorUserId,
    posture: input.posture,
    now,
  });
}
