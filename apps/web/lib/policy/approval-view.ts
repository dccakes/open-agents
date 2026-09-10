/**
 * The shape an approval takes when it leaves the data layer.
 *
 * Separate from persistence on purpose: every consumer — the decision route,
 * the session's pending list, the chat prompt — must see the *effective*
 * decision with expiry already applied, not the raw column. Doing that mapping
 * in one place is what stops a reader from acting on a stored `pending` that is
 * really an expiry.
 */

import type { Approval } from "@/lib/db/schema";
import {
  type EffectiveApprovalDecision,
  effectiveApprovalDecision,
  isApprovalSpendable,
  type StoredApprovalDecision,
} from "@/lib/policy/approval-state";

/** Whether the approval gates a tool dispatch or an application side effect. */
export type ApprovalKind = "tool-call" | "app-side-effect";

export interface ApprovalView {
  id: string;
  sessionId: string;
  chatId: string | null;
  workflowRunId: string | null;
  kind: ApprovalKind;
  toolName: string | null;
  toolCallId: string | null;
  inputSummary: Record<string, unknown>;
  /** The decision to act on — expiry already applied. */
  decision: EffectiveApprovalDecision;
  /** What the column holds, which may lag the effective decision. */
  storedDecision: StoredApprovalDecision;
  decidedBy: string | null;
  decidedAt: Date | null;
  consumedAt: Date | null;
  expiresAt: Date;
  createdAt: Date;
  /** Whether this approval could still authorize one execution. */
  spendable: boolean;
}

export function toApprovalView(row: Approval, now: Date): ApprovalView {
  return {
    id: row.id,
    sessionId: row.sessionId,
    chatId: row.chatId,
    workflowRunId: row.workflowRunId,
    kind: row.kind,
    toolName: row.toolName,
    toolCallId: row.toolCallId,
    inputSummary: row.inputSummary,
    decision: effectiveApprovalDecision(row, now),
    storedDecision: row.decision,
    decidedBy: row.decidedBy,
    decidedAt: row.decidedAt,
    consumedAt: row.consumedAt,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    spendable: isApprovalSpendable(row, now),
  };
}
