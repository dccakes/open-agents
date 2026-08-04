/**
 * What bounds a run: its own token ceiling, its step ceiling, and the
 * organization's daily ceiling.
 *
 * Pure and synchronous on purpose. It is evaluated in the workflow's step loop
 * against `totalUsage`, which is orchestrator-local and the only accurate live
 * figure — `usage_events` is written once, terminally, so a mid-run read of it
 * sees nothing from the current run.
 *
 * The token budget ships **unset** (unlimited). A ceiling guessed without data
 * turns a working product into a broken one; the step budget bounds the run in
 * the meantime, and the data to pick a token number only started existing when
 * usage became attributable.
 */

import type { RunTokenBudget } from "@/lib/config/agent-policy";
import type { DailyTokenBudget } from "@/lib/org/settings";
import { UTC_DAY_BOUNDARY_NOTICE } from "@/lib/budget/utc-day";

/** Which ceiling was hit. */
export type BudgetKind = "run-tokens" | "run-steps" | "org-daily-tokens";

export interface BudgetBreach {
  budget: BudgetKind;
  limit: number;
  used: number;
  /** Names the budget and the totals, for the halt reason and the UI. */
  message: string;
}

export type BudgetVerdict =
  | { withinBudget: true }
  | { withinBudget: false; breach: BudgetBreach };

export interface RunUsage {
  inputTokens: number;
  outputTokens: number;
  stepCount: number;
}

/**
 * The organization's position at the moment the run started.
 *
 * Read once per run rather than once per step: `usage_events` is not written
 * until the run ends, so re-reading it mid-run would return the same number
 * every time at the cost of a query per step. The consequence is that
 * concurrent runs each see the same baseline and can jointly overshoot the
 * daily ceiling; each of them still halts the moment its own share crosses it.
 */
export interface DailyBudgetSnapshot {
  limit: DailyTokenBudget;
  /** Tokens the organization had already spent this UTC day at run start. */
  usedToday: number;
}

export interface RunBudgetInput {
  usage: RunUsage;
  stepBudget: number;
  tokenBudget: RunTokenBudget;
  daily?: DailyBudgetSnapshot;
}

const WITHIN_BUDGET: BudgetVerdict = { withinBudget: true };

function breach(
  budget: BudgetKind,
  used: number,
  limit: number,
  message: string,
): BudgetVerdict {
  return { withinBudget: false, breach: { budget, used, limit, message } };
}

function runTokens(usage: RunUsage): number {
  return usage.inputTokens + usage.outputTokens;
}

/**
 * Whether the run may take another step.
 *
 * Order is deliberate: the most specific ceiling is reported first, so a run
 * that is over several at once names the one the operator can act on.
 *
 * "Exceed" and "reach" are different, and the spec uses both: a run halts when
 * its tokens *exceed* the token budget, and when its step count *reaches* the
 * step budget.
 */
export function checkRunBudget(input: RunBudgetInput): BudgetVerdict {
  const tokens = runTokens(input.usage);

  if (
    input.tokenBudget.limit === "limited" &&
    tokens > input.tokenBudget.tokens
  ) {
    return breach(
      "run-tokens",
      tokens,
      input.tokenBudget.tokens,
      `This run stopped because it exceeded its token budget: ${tokens} tokens used of a ${input.tokenBudget.tokens} token ceiling.`,
    );
  }

  if (input.daily && input.daily.limit.limit === "limited") {
    const orgTokens = input.daily.usedToday + tokens;
    const dailyLimit = input.daily.limit.dailyTokens;
    if (orgTokens > dailyLimit) {
      return breach(
        "org-daily-tokens",
        orgTokens,
        dailyLimit,
        `This run stopped because the organization crossed its daily token budget: ${orgTokens} tokens used today of a ${dailyLimit} token ceiling. ${UTC_DAY_BOUNDARY_NOTICE}`,
      );
    }
  }

  if (input.usage.stepCount >= input.stepBudget) {
    return breach(
      "run-steps",
      input.usage.stepCount,
      input.stepBudget,
      `This run stopped because it reached its step budget: ${input.usage.stepCount} steps of a ${input.stepBudget} step ceiling.`,
    );
  }

  return WITHIN_BUDGET;
}
