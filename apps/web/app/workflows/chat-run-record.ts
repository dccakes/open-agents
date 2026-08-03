/**
 * The run row's lifecycle, as workflow steps.
 *
 * The row used to be written once, from the workflow's `finally`. It is now
 * written at run start and updated as the run spends, so that a run in flight
 * has a record at all — which is what makes spend observable before the run
 * ends, and what leaves a crashed run visible as "stuck" rather than as
 * nothing.
 *
 * Both steps swallow their failures. Neither is load-bearing for correctness:
 * the budget is evaluated against orchestrator state, not against this row, so
 * a failed write costs observability and never a wrong decision.
 */

import {
  startWorkflowRun,
  updateWorkflowRunProgress,
} from "@/lib/db/workflow-runs";

export async function startRunRecord(params: {
  workflowRunId: string;
  chatId: string;
  sessionId: string;
  userId: string;
  modelId?: string;
  startedAt: string;
}): Promise<void> {
  "use step";

  try {
    await startWorkflowRun({
      id: params.workflowRunId,
      chatId: params.chatId,
      sessionId: params.sessionId,
      userId: params.userId,
      modelId: params.modelId,
      startedAt: params.startedAt,
    });
  } catch (error) {
    console.error("[workflow] Failed to open the workflow run record:", error);
  }
}

export async function persistRunProgress(params: {
  workflowRunId: string;
  inputTokens: number;
  outputTokens: number;
  stepCount: number;
}): Promise<void> {
  "use step";

  try {
    await updateWorkflowRunProgress({
      id: params.workflowRunId,
      inputTokens: params.inputTokens,
      outputTokens: params.outputTokens,
      stepCount: params.stepCount,
    });
  } catch (error) {
    console.error("[workflow] Failed to persist run progress:", error);
  }
}
