/**
 * Requesting — and later recovering — the approval that gates a run's own git
 * automation.
 *
 * The approval is keyed to the workflow run rather than to a tool call, because
 * there is no tool call: the agent loop finished before auto-commit was
 * reached. That also makes the request idempotent, which matters because a
 * workflow step can be retried and a retry must find the row it already wrote
 * instead of prompting the user a second time.
 *
 * Everything the execution route needs later is written into the redacted input
 * summary, because by then the run is gone: which operations were gated, the
 * repository, and the assistant message the outcome has to be reported on.
 *
 * Deliberately imports no authorization: this module is reached from workflow
 * code, and `require-permission` pulls `next/headers` into the workflow VM.
 * Authorizing the *answer* is `approval-decisions.ts`; authorizing the
 * *execution* is `app-side-effect-execution.ts`.
 */

import type { Approval } from "@/lib/db/schema";
import {
  APP_SIDE_EFFECT_RULE,
  APP_SIDE_EFFECT_TOOL_NAME,
  type AppSideEffectOperation,
  describeAppSideEffects,
  parseAppSideEffectOperations,
} from "@/lib/policy/app-side-effects";
import {
  type EffectiveApprovalDecision,
  effectiveApprovalDecision,
} from "@/lib/policy/approval-state";
import {
  createApproval,
  getAppSideEffectApproval,
} from "@/lib/policy/approvals";
import { isPosture, type Posture } from "@/lib/policy/posture";
import { recordPolicyEvent } from "@/lib/policy/policy-events";

export interface RequestAppSideEffectApprovalInput {
  sessionId: string;
  chatId: string;
  workflowRunId: string;
  /** The assistant message the outcome is reported on. */
  messageId: string;
  operations: readonly AppSideEffectOperation[];
  repoOwner: string;
  repoName: string;
  posture: Posture;
  /** Injected by tests; defaults to the current instant. */
  now?: Date;
}

/** Everything the run needs to surface the pause. Serializes across a step. */
export interface AppSideEffectApprovalRequest {
  approvalId: string;
  decision: EffectiveApprovalDecision;
  /** The exact operation, in the words the prompt shows. */
  operation: string;
  rule: string;
  posture: Posture;
  toolName: string;
}

function toRequest(
  row: Approval,
  fallback: { operation: string; posture: Posture },
  now: Date,
): AppSideEffectApprovalRequest {
  const summary = row.inputSummary;

  return {
    approvalId: row.id,
    decision: effectiveApprovalDecision(row, now),
    operation:
      typeof summary.operation === "string"
        ? summary.operation
        : fallback.operation,
    rule:
      typeof summary.rule === "string" ? summary.rule : APP_SIDE_EFFECT_RULE,
    posture: isPosture(summary.posture) ? summary.posture : fallback.posture,
    toolName: row.toolName ?? APP_SIDE_EFFECT_TOOL_NAME,
  };
}

/**
 * Pause the run's git automation behind an approval.
 *
 * Returns the *existing* request when this run already has one, so a retried
 * step is a read rather than a second prompt.
 */
export async function requestAppSideEffectApproval(
  input: RequestAppSideEffectApprovalInput,
): Promise<AppSideEffectApprovalRequest> {
  const now = input.now ?? new Date();
  const operations = [...input.operations];
  const operation = describeAppSideEffects({
    operations,
    repoOwner: input.repoOwner,
    repoName: input.repoName,
  });
  const fallback = { operation, posture: input.posture };

  const existing = await getAppSideEffectApproval(
    input.sessionId,
    input.workflowRunId,
  );
  if (existing) {
    return toRequest(existing, fallback, now);
  }

  const created = await createApproval({
    sessionId: input.sessionId,
    chatId: input.chatId,
    workflowRunId: input.workflowRunId,
    kind: "app-side-effect",
    toolName: APP_SIDE_EFFECT_TOOL_NAME,
    toolCallId: null,
    input: {
      operations,
      repoOwner: input.repoOwner,
      repoName: input.repoName,
      messageId: input.messageId,
      rule: APP_SIDE_EFFECT_RULE,
      posture: input.posture,
      operation,
    },
    now,
  });

  await recordPolicyEvent({
    sessionId: input.sessionId,
    workflowRunId: input.workflowRunId,
    toolName: APP_SIDE_EFFECT_TOOL_NAME,
    input: { operations, repoOwner: input.repoOwner, repoName: input.repoName },
    decision: "ask",
    matchedRule: APP_SIDE_EFFECT_RULE,
    posture: input.posture,
  });

  return toRequest(created, fallback, now);
}

/** What an approved application side effect has to actually do. */
export interface AppSideEffectPlan {
  approvalId: string;
  sessionId: string;
  chatId: string | null;
  messageId: string | null;
  operations: AppSideEffectOperation[];
  repoOwner: string | null;
  repoName: string | null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Recover the plan from the stored summary.
 *
 * Every field is narrowed rather than asserted: the column is `jsonb`, so what
 * comes back is `unknown` however it was written, and an approval whose summary
 * has lost its repository must execute nothing rather than push somewhere else.
 */
export function readAppSideEffectPlan(row: Approval): AppSideEffectPlan {
  const summary = row.inputSummary;

  return {
    approvalId: row.id,
    sessionId: row.sessionId,
    chatId: row.chatId,
    messageId: stringOrNull(summary.messageId),
    operations: parseAppSideEffectOperations(summary.operations),
    repoOwner: stringOrNull(summary.repoOwner),
    repoName: stringOrNull(summary.repoName),
  };
}
