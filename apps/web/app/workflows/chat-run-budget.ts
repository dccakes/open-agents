/**
 * The budget a run executes under, and the usage it is measured against.
 *
 * Two things live here that the workflow body cannot do itself:
 *
 * - **Resolving the limits.** They come from the configuration module and from
 *   the organization's settings, both of which need a real environment and a
 *   database, so they are resolved in a step. Everything returned is plain
 *   JSON, because it crosses the step boundary.
 * - **Seeding the accumulated usage.** A run that resumes after an approval
 *   pause is a *brand new workflow run* with a new run id — the loop does not
 *   park, it ends (see `chat.ts`). So "the run's accumulated usage" cannot come
 *   from the run row; it comes from the assistant message the resume continues,
 *   whose `totalMessageUsage` and step-finish list have been accumulating
 *   across every run that contributed to it. That is the persisted figure a
 *   resumed run's budget is evaluated against.
 */

import type { LanguageModelUsage } from "ai";
import type { WebAgentBudgetHaltData, WebAgentUIMessage } from "@/app/types";
import type {
  BudgetBreach,
  DailyBudgetSnapshot,
  RunUsage,
} from "@/lib/budget/run-budget";
import { UTC_DAY_BOUNDARY_NOTICE } from "@/lib/budget/utc-day";
import {
  getRunStepBudget,
  getRunTokenBudget,
  type RunTokenBudget,
} from "@/lib/config/agent-policy";

/** Everything the loop needs to decide whether it may take another step. */
export interface RunBudgetLimits {
  stepBudget: number;
  tokenBudget: RunTokenBudget;
  daily: DailyBudgetSnapshot;
}

export const ZERO_RUN_USAGE: RunUsage = {
  inputTokens: 0,
  outputTokens: 0,
  stepCount: 0,
};

/**
 * The run's ceilings, resolved once per run.
 *
 * `daily-budget` is imported dynamically, from inside the step, and that is not
 * stylistic: it reaches `lib/org/settings`, which reaches
 * `lib/auth/require-permission`, which imports `next/headers` and the
 * better-auth server. A static import would drag all of that into the workflow
 * VM's module graph — the same class of breakage the `ai` runtime causes there.
 */
export async function resolveRunBudget(): Promise<RunBudgetLimits> {
  "use step";

  const { readDailyBudgetSnapshot } = await import("@/lib/budget/daily-budget");

  return {
    stepBudget: getRunStepBudget(),
    tokenBudget: getRunTokenBudget(),
    daily: await readDailyBudgetSnapshot(),
  };
}

/**
 * What the assistant message being continued has already spent.
 *
 * Zero for a fresh turn. For a resume, the usage and step count carried on the
 * message the run is continuing — so an approval pause costs the run nothing
 * and buys it nothing.
 */
export function seedRunUsage(message: WebAgentUIMessage | undefined): RunUsage {
  if (!message || message.role !== "assistant") {
    return ZERO_RUN_USAGE;
  }

  const metadata = message.metadata;
  const usage = metadata?.totalMessageUsage;

  return {
    inputTokens: usage?.inputTokens ?? 0,
    outputTokens: usage?.outputTokens ?? 0,
    stepCount: metadata?.stepFinishReasons?.length ?? 0,
  };
}

/** The seed plus what this run has spent so far. */
export function accumulateRunUsage(
  seed: RunUsage,
  runUsage: LanguageModelUsage | undefined,
  stepsThisRun: number,
): RunUsage {
  return {
    inputTokens: seed.inputTokens + (runUsage?.inputTokens ?? 0),
    outputTokens: seed.outputTokens + (runUsage?.outputTokens ?? 0),
    stepCount: seed.stepCount + stepsThisRun,
  };
}

/** The breach as the chat renders it. */
export function toBudgetHaltData(breach: BudgetBreach): WebAgentBudgetHaltData {
  return {
    budget: breach.budget,
    limit: breach.limit,
    used: breach.used,
    message: breach.message,
    ...(breach.budget === "org-daily-tokens"
      ? { dayBoundary: UTC_DAY_BOUNDARY_NOTICE }
      : {}),
  };
}
