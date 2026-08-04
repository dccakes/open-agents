import { eq, isNotNull, type SQL } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "./client";
import { workflowRuns, workflowRunSteps } from "./schema";

/**
 * The run row now spans the whole life of the run.
 *
 * It used to be written once, from the workflow's `finally`, which meant a run
 * in flight had no record at all and its spend was invisible until it ended.
 * Now it is inserted at start (`running`), updated per step with the running
 * totals, and finished once.
 *
 * The cost of that, stated where it bites: **a row no longer implies a finished
 * run.** Every reader that means "finished" must say so — use
 * {@link isFinishedWorkflowRun} rather than assuming. A crashed run leaves a
 * `running` row with a null `finishedAt` forever; that is deliberate, and
 * visible, which is better than a run that simply never existed.
 */

export type WorkflowRunStatus =
  | "running"
  | "completed"
  | "aborted"
  | "failed"
  | "budget-exceeded";

export type WorkflowRunStepTiming = {
  stepNumber: number;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  finishReason?: string;
  rawFinishReason?: string;
};

/**
 * The predicate every reader of finished runs must apply.
 *
 * Exported as a value rather than repeated inline so the invariant has one
 * definition and a new reader has something to reach for.
 */
export function isFinishedWorkflowRun(): SQL {
  return isNotNull(workflowRuns.finishedAt);
}

export interface StartWorkflowRunInput {
  id: string;
  chatId: string;
  sessionId: string;
  userId: string;
  modelId?: string;
  startedAt: string;
}

/**
 * Write the run row before the first step.
 *
 * Idempotent: the workflow can be retried, and a second start must find the
 * existing run rather than replace it — replacing it would reset the running
 * totals a resumed run's budget depends on.
 */
export async function startWorkflowRun(
  input: StartWorkflowRunInput,
): Promise<void> {
  await db
    .insert(workflowRuns)
    .values({
      id: input.id,
      chatId: input.chatId,
      sessionId: input.sessionId,
      userId: input.userId,
      modelId: input.modelId ?? null,
      status: "running",
      startedAt: new Date(input.startedAt),
      finishedAt: null,
      totalDurationMs: null,
      inputTokens: 0,
      outputTokens: 0,
      stepCount: 0,
    })
    .onConflictDoNothing({ target: workflowRuns.id });
}

export interface WorkflowRunProgress {
  id: string;
  inputTokens: number;
  outputTokens: number;
  stepCount: number;
}

/**
 * The run's spend so far.
 *
 * Written every step, because `usage_events` is written once terminally and so
 * can never answer "what has this run spent?" while the run is still going.
 */
export async function updateWorkflowRunProgress(
  progress: WorkflowRunProgress,
): Promise<void> {
  await db
    .update(workflowRuns)
    .set({
      inputTokens: progress.inputTokens,
      outputTokens: progress.outputTokens,
      stepCount: progress.stepCount,
    })
    .where(eq(workflowRuns.id, progress.id));
}

export interface FinishWorkflowRunInput {
  id: string;
  chatId: string;
  sessionId: string;
  userId: string;
  modelId?: string;
  status: WorkflowRunStatus;
  startedAt: string;
  finishedAt: string;
  totalDurationMs: number;
  inputTokens?: number;
  outputTokens?: number;
  stepCount?: number;
  /** Names the budget and the totals, when a budget is why the run stopped. */
  haltReason?: string | null;
}

/**
 * Close the run out.
 *
 * An upsert rather than an insert: the start row is normally already there, and
 * a run whose start write was lost must still end up recorded rather than
 * silently discarded.
 */
export async function finishWorkflowRun(
  input: FinishWorkflowRunInput,
  client: Pick<typeof db, "insert"> = db,
): Promise<void> {
  const finishedAt = new Date(input.finishedAt);
  const finishColumns = {
    modelId: input.modelId ?? null,
    status: input.status,
    finishedAt,
    totalDurationMs: input.totalDurationMs,
    ...(input.inputTokens === undefined
      ? {}
      : { inputTokens: input.inputTokens }),
    ...(input.outputTokens === undefined
      ? {}
      : { outputTokens: input.outputTokens }),
    ...(input.stepCount === undefined ? {} : { stepCount: input.stepCount }),
    haltReason: input.haltReason ?? null,
  };

  await client
    .insert(workflowRuns)
    .values({
      id: input.id,
      chatId: input.chatId,
      sessionId: input.sessionId,
      userId: input.userId,
      startedAt: new Date(input.startedAt),
      inputTokens: input.inputTokens ?? 0,
      outputTokens: input.outputTokens ?? 0,
      stepCount: input.stepCount ?? 0,
      ...finishColumns,
    })
    .onConflictDoUpdate({
      target: workflowRuns.id,
      set: finishColumns,
    });
}

export async function recordWorkflowRun(
  data: FinishWorkflowRunInput & { stepTimings: WorkflowRunStepTiming[] },
) {
  await db.transaction(async (tx) => {
    await finishWorkflowRun(data, tx);

    if (data.stepTimings.length === 0) {
      return;
    }

    await tx
      .insert(workflowRunSteps)
      .values(
        data.stepTimings.map((stepTiming) => ({
          id: nanoid(),
          workflowRunId: data.id,
          stepNumber: stepTiming.stepNumber,
          startedAt: new Date(stepTiming.startedAt),
          finishedAt: new Date(stepTiming.finishedAt),
          durationMs: stepTiming.durationMs,
          finishReason: stepTiming.finishReason ?? null,
          rawFinishReason: stepTiming.rawFinishReason ?? null,
        })),
      )
      .onConflictDoNothing({
        target: [workflowRunSteps.workflowRunId, workflowRunSteps.stepNumber],
      });
  });
}
