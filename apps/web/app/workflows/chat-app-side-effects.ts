/**
 * The workflow's half of the application-side-effect gate.
 *
 * The gate itself (`lib/policy/app-side-effects.ts`) is pure and is consulted
 * inline in `chat.ts`. What needs a step is *recording* the approval, because
 * that writes to the database — and the module that writes it must not be
 * imported statically from workflow code: it reaches the approval persistence
 * layer, and `chat-run-budget.ts`'s comment explains why that class of import
 * breaks the workflow VM. Hence the dynamic import inside the step, matching
 * the pattern `chat-run-policy.ts` and `chat-run-budget.ts` already use.
 *
 * Everything crossing the step boundary here is plain JSON.
 */

import type { AppSideEffectOperation } from "@/lib/policy/app-side-effects";
import type { Posture } from "@/lib/policy/posture";

/** What the run needs to surface the pause. Serializes across a step. */
export interface AppSideEffectApprovalState {
  approvalId: string;
  decision: "pending" | "approved" | "denied" | "expired";
  /** The exact operation, in the words the prompt shows. */
  operation: string;
  rule: string;
  posture: Posture;
  toolName: string;
}

export interface RequestAppSideEffectApprovalStepParams {
  sessionId: string;
  chatId: string;
  workflowRunId: string;
  messageId: string;
  operations: AppSideEffectOperation[];
  repoOwner: string;
  repoName: string;
  posture: Posture;
}

/**
 * Record the approval that stands in for the side effect this run refused.
 *
 * Returns `null` when the approval could not be written. That is a **fail
 * closed** signal, not a fallback: the caller must still not perform the
 * operation, because an approval that was never recorded can never be granted,
 * and performing it anyway would push under `strict` with nobody having agreed.
 */
export async function requestAppSideEffectApprovalStep(
  params: RequestAppSideEffectApprovalStepParams,
): Promise<AppSideEffectApprovalState | null> {
  "use step";

  try {
    const { requestAppSideEffectApproval } =
      await import("@/lib/policy/app-side-effect-approvals");

    const request = await requestAppSideEffectApproval({
      sessionId: params.sessionId,
      chatId: params.chatId,
      workflowRunId: params.workflowRunId,
      messageId: params.messageId,
      operations: params.operations,
      repoOwner: params.repoOwner,
      repoName: params.repoName,
      posture: params.posture,
    });

    return {
      approvalId: request.approvalId,
      decision: request.decision,
      operation: request.operation,
      rule: request.rule,
      posture: request.posture,
      toolName: request.toolName,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(
      `[policy] Could not request approval for session ${params.sessionId}'s git automation:`,
      detail,
    );
    return null;
  }
}
