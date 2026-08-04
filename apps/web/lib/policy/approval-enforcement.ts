/**
 * Execute-time verification: the reason the `approval` table exists.
 *
 * Today an approval decision travels back to the server inside the
 * client-supplied `messages[].parts` of the resume request and is persisted
 * straight from there (`app/api/chat/_lib/persist-tool-results.ts`). That makes
 * "this tool call was approved" an assertion by whoever can send the request,
 * not an authorization. This module is the server-side fact that replaces it:
 * before an operation whose policy decision was `ask` runs, there must be a
 * matching `approved` row that is not expired and has not already been spent.
 *
 * **Single use is enforced by the UPDATE, not by the read.** Two concurrent
 * requests can both pass a read of an unconsumed row. The compare-and-set —
 * `SET consumed_at = now WHERE id = ? AND decision = 'approved' AND consumed_at
 * IS NULL AND expires_at > now` — is what decides between them: exactly one
 * matches a row, and a replayed message body matches none.
 *
 * SEAM — the call site inside a tool's `execute` lives in
 * `packages/agent/tools/*`, which this change does not touch, and the agent
 * package cannot reach the database. The wiring is: the host passes a
 * verifier through the agent's call options alongside the policy, the tool's
 * `execute` calls it with its own `toolCallId` after re-evaluating policy, and
 * a refusal becomes the tool's structured error result rather than an
 * execution. `verifyAssertedApprovals` in `approval-assertions.ts` is the
 * matching request-admission check for the same claims.
 */

import type { ApprovalGateRefusalCode } from "@open-agents/agent";
import { and, eq, gt, isNull, type SQL } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { approvals } from "@/lib/db/schema";
import { isPastExpiry } from "@/lib/policy/approval-state";
import type { ApprovalKind } from "@/lib/policy/approval-view";
import {
  getApprovalByToolCall,
  getApprovalForSession,
} from "@/lib/policy/approvals";
import type { Approval } from "@/lib/db/schema";

/**
 * Why an operation was refused. Distinct codes so the model can react.
 *
 * Derived from the agent's schema rather than restated, so the codes a tool can
 * receive and the codes this module can produce cannot drift apart. Two are
 * excluded: `unavailable` (the gate failing to answer) and `no_gate` (no gate
 * wired at all). Both describe the seam rather than a state a row can be in, so
 * they are the agent-side wrapper's to report. The type import is erased at
 * build time, as in `approval-gate.ts`.
 */
export type ApprovalRefusalCode = Exclude<
  ApprovalGateRefusalCode,
  "unavailable" | "no_gate"
>;

export type ApprovalVerification =
  | { authorized: true; approvalId: string }
  | {
      authorized: false;
      code: ApprovalRefusalCode;
      message: string;
      approvalId: string | null;
    };

export interface ToolCallApprovalRequest {
  sessionId: string;
  toolCallId: string;
  /** Injected by tests; defaults to the current instant. */
  now?: Date;
}

export interface AppSideEffectApprovalRequest {
  sessionId: string;
  approvalId: string;
  /** Injected by tests; defaults to the current instant. */
  now?: Date;
}

const REFUSAL_MESSAGES: Record<ApprovalRefusalCode, string> = {
  no_approval_record:
    "This operation requires approval and no approval was ever requested for it on the server. The request asserted an approval that does not exist, so nothing was executed.",
  not_approved:
    "This operation is still waiting for approval. It will run once a user with access to this session approves it.",
  denied: "A user denied this operation, so it was not executed.",
  expired:
    "The approval for this operation timed out and was not answered in time. An expired approval counts as a denial; request it again if it is still needed.",
  already_consumed:
    "This approval has already authorized one execution. Approvals are single use, so it cannot authorize another.",
};

function refuse(
  code: ApprovalRefusalCode,
  approvalId: string | null,
): ApprovalVerification {
  return {
    authorized: false,
    code,
    message: REFUSAL_MESSAGES[code],
    approvalId,
  };
}

/**
 * The compare-and-set that makes an approval single use.
 *
 * Exported so it is visible and testable as the enforcement point, rather than
 * being an inline condition a later edit could quietly weaken.
 */
export function spendableApprovalCondition(
  approvalId: string,
  now: Date,
): SQL | undefined {
  return and(
    eq(approvals.id, approvalId),
    eq(approvals.decision, "approved"),
    isNull(approvals.consumedAt),
    gt(approvals.expiresAt, now),
  );
}

/**
 * The refusal a row in a terminal or unspendable state produces, if any.
 *
 * The single ladder, used by every entry point, so a denial, an expiry, and a
 * second spend read identically whether the row is being reported on or spent
 * and whichever kind of approval it is. Expiry is checked first deliberately:
 * a row that is both denied and past its expiry is reported the same way from
 * everywhere, rather than depending on which door the caller came through.
 */
function refusalForRow(row: Approval, now: Date): ApprovalVerification | null {
  if (isPastExpiry(row, now) || row.decision === "expired") {
    return refuse("expired", row.id);
  }
  if (row.decision === "denied") {
    return refuse("denied", row.id);
  }
  if (row.decision === "pending") {
    return refuse("not_approved", row.id);
  }
  if (row.consumedAt !== null) {
    return refuse("already_consumed", row.id);
  }
  return null;
}

/** The compare-and-set, shared by both consume paths. */
async function spendApproval(
  row: Approval,
  now: Date,
): Promise<ApprovalVerification> {
  const spent = await db
    .update(approvals)
    .set({ consumedAt: now })
    .where(spendableApprovalCondition(row.id, now))
    .returning({ id: approvals.id });

  if (spent.length === 0) {
    // The row moved between the read and the write: another execution spent
    // it, or it expired. Either way this call does not get to run.
    return refuse("already_consumed", row.id);
  }

  return { authorized: true, approvalId: row.id };
}

/**
 * The row this request is about, or the refusal that it is not usable.
 *
 * A kind mismatch is reported as "no record": an approval of the other kind is
 * not this authorization, so from here it may as well not exist.
 */
function usableRow(
  row: Approval | null,
  kind: ApprovalKind,
  now: Date,
): { row: Approval } | { refusal: ApprovalVerification } {
  if (!row || row.kind !== kind) {
    return { refusal: refuse("no_approval_record", null) };
  }

  const refusal = refusalForRow(row, now);
  return refusal ? { refusal } : { row };
}

/**
 * Whether this tool call is currently authorized — a read, with no side effect.
 *
 * Use this to *report*; use `consumeToolCallApproval` to actually execute.
 */
export async function verifyToolCallApproval(
  request: ToolCallApprovalRequest,
): Promise<ApprovalVerification> {
  const now = request.now ?? new Date();
  const resolved = usableRow(
    await getApprovalByToolCall(request.sessionId, request.toolCallId),
    "tool-call",
    now,
  );

  return "refusal" in resolved
    ? resolved.refusal
    : { authorized: true, approvalId: resolved.row.id };
}

/**
 * Spend an approval, authorizing exactly one execution.
 *
 * The preceding read exists to produce a specific refusal code; it is the
 * conditional UPDATE that authorizes. A caller must treat anything other than
 * `authorized: true` as "do not execute". Refusing before the write is what
 * keeps a denied or expired approval from ever being touched.
 */
async function consumeApproval(
  row: Approval | null,
  kind: ApprovalKind,
  now: Date,
): Promise<ApprovalVerification> {
  const resolved = usableRow(row, kind, now);
  return "refusal" in resolved
    ? resolved.refusal
    : spendApproval(resolved.row, now);
}

/** Spend the approval for this tool call. */
export async function consumeToolCallApproval(
  request: ToolCallApprovalRequest,
): Promise<ApprovalVerification> {
  const now = request.now ?? new Date();
  return consumeApproval(
    await getApprovalByToolCall(request.sessionId, request.toolCallId),
    "tool-call",
    now,
  );
}

/**
 * Spend the approval gating an application-level side effect.
 *
 * Keyed by approval id rather than tool call id, because there is no tool call
 * — the agent loop had already finished when this was requested. Everything
 * else is identical to the tool-call path, including single use: granting an
 * auto-commit authorizes exactly one execution of it, so a replayed request to
 * the execution route cannot push twice.
 */
export async function consumeAppSideEffectApproval(
  request: AppSideEffectApprovalRequest,
): Promise<ApprovalVerification> {
  const now = request.now ?? new Date();
  return consumeApproval(
    await getApprovalForSession(request.sessionId, request.approvalId),
    "app-side-effect",
    now,
  );
}
