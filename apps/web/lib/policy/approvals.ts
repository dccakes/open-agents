/**
 * Persistence for approval records.
 *
 * Creation and reads only. Deciding an approval lives in
 * `approval-decisions.ts` (it needs authorization) and spending one lives in
 * `approval-enforcement.ts` (it needs an atomic compare-and-set), so neither
 * can be done by accident from here.
 *
 * Every read reports the *effective* decision from `approval-state.ts`, which
 * means a caller cannot accidentally act on a stored `pending` that is really
 * an expiry. The stored value is reported alongside it for display.
 */

import { and, desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db/client";
import { type Approval, approvals, type NewApproval } from "@/lib/db/schema";
import { ApprovalError } from "@/lib/policy/approval-errors";
import { approvalExpiresAt } from "@/lib/policy/approval-state";
import {
  type ApprovalKind,
  type ApprovalView,
  toApprovalView,
} from "@/lib/policy/approval-view";
import { redactInputSummary } from "@/lib/policy/redaction";

export interface CreateApprovalInput {
  sessionId: string;
  /** NULL for an application side effect, which has no chat turn. */
  chatId?: string | null;
  workflowRunId?: string | null;
  kind: ApprovalKind;
  toolName?: string | null;
  /** Required for `tool-call`: it is what execute-time verification matches on. */
  toolCallId?: string | null;
  /** Redacted before storage, so no caller can forget to. */
  input: unknown;
  /** Injected by tests; defaults to the current instant. */
  now?: Date;
}

function buildRow(input: CreateApprovalInput, now: Date): NewApproval {
  if (input.kind === "tool-call" && !input.toolCallId) {
    throw new ApprovalError(
      "invalid",
      "A tool-call approval must name the tool call it gates; without one there is nothing for execute-time verification to match.",
    );
  }

  return {
    id: nanoid(),
    sessionId: input.sessionId,
    chatId: input.chatId ?? null,
    workflowRunId: input.workflowRunId ?? null,
    kind: input.kind,
    toolName: input.toolName ?? null,
    toolCallId: input.toolCallId ?? null,
    inputSummary: redactInputSummary(input.input),
    decision: "pending",
    decidedBy: null,
    consumedAt: null,
    expiresAt: approvalExpiresAt(now),
    createdAt: now,
    decidedAt: null,
  };
}

/**
 * Request an approval.
 *
 * Idempotent per tool call: the unique index on `tool_call_id` means two
 * concurrent requests cannot produce two competing approvals for the same
 * call, and the loser reads the winner's row rather than failing.
 */
export async function createApproval(
  input: CreateApprovalInput,
): Promise<Approval> {
  const now = input.now ?? new Date();
  const row = buildRow(input, now);

  const written = await db
    .insert(approvals)
    .values(row)
    .onConflictDoNothing({ target: approvals.toolCallId })
    .returning();

  const created = written[0];
  if (created) {
    return created;
  }

  const existing = input.toolCallId
    ? await getApprovalByToolCall(input.sessionId, input.toolCallId)
    : null;

  if (!existing) {
    throw new ApprovalError(
      "unavailable",
      "The approval could not be written and no existing approval was found for this tool call.",
    );
  }

  return existing;
}

/** An approval scoped to its session, so an id alone cannot reach another's. */
export async function getApprovalForSession(
  sessionId: string,
  approvalId: string,
): Promise<Approval | null> {
  const rows = await db
    .select()
    .from(approvals)
    .where(
      and(eq(approvals.sessionId, sessionId), eq(approvals.id, approvalId)),
    )
    .limit(1);

  return rows[0] ?? null;
}

/** The approval gating a given tool call, or null when nobody requested one. */
export async function getApprovalByToolCall(
  sessionId: string,
  toolCallId: string,
): Promise<Approval | null> {
  const rows = await db
    .select()
    .from(approvals)
    .where(
      and(
        eq(approvals.sessionId, sessionId),
        eq(approvals.toolCallId, toolCallId),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

/**
 * The approval gating this run's application-level git automation.
 *
 * There is at most one per run: the turn's auto-commit and auto-PR are approved
 * as a unit. Looked up rather than tracked in memory because the workflow step
 * that requests it can be retried, and a retry must find the row it already
 * wrote instead of asking the user a second time.
 */
export async function getAppSideEffectApproval(
  sessionId: string,
  workflowRunId: string,
): Promise<Approval | null> {
  const rows = await db
    .select()
    .from(approvals)
    .where(
      and(
        eq(approvals.sessionId, sessionId),
        eq(approvals.workflowRunId, workflowRunId),
        eq(approvals.kind, "app-side-effect"),
      ),
    )
    .orderBy(desc(approvals.createdAt))
    .limit(1);

  return rows[0] ?? null;
}

/** Every approval on a session, newest first, with expiry already applied. */
export async function listSessionApprovals(
  sessionId: string,
  now: Date = new Date(),
): Promise<ApprovalView[]> {
  const rows = await db
    .select()
    .from(approvals)
    .where(eq(approvals.sessionId, sessionId))
    .orderBy(desc(approvals.createdAt));

  return rows.map((row) => toApprovalView(row, now));
}
