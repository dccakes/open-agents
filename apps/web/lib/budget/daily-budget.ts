/**
 * The organization daily token budget, enforced.
 *
 * WS-1.0 landed `orgSettings.dailyTokenBudget` and `getDailyTokenBudget()` with
 * an explicit "enforcement is WS-1.1's" note and no consumers. This is the
 * consumer.
 *
 * It fails closed, deliberately and for the same reason the kill switch does:
 * a gate that reads "could not tell" as "allowed" stops working precisely when
 * the database is the thing going wrong. The two are checked side by side at
 * run start and answer with the same structured refusal shape.
 */

import type { DailyBudgetSnapshot } from "@/lib/budget/run-budget";
import { readOrgDailyTokenUsage } from "@/lib/budget/org-daily-usage";
import { UTC_DAY_BOUNDARY_NOTICE } from "@/lib/budget/utc-day";
import type { AgentRunStartDecision } from "@/lib/org/agent-runs-gate";
import { AGENT_RUNS_UNVERIFIABLE_MESSAGE } from "@/lib/org/agent-runs-gate";
import { getDailyTokenBudget } from "@/lib/org/settings";

export const DAILY_TOKEN_BUDGET_EXHAUSTED_MESSAGE = `This organization has used its daily token budget, so no new agent run can start. Runs already in progress are unaffected. ${UTC_DAY_BOUNDARY_NOTICE}`;

const UNLIMITED_SNAPSHOT: DailyBudgetSnapshot = {
  limit: { limit: "unlimited" },
  usedToday: 0,
};

/** Whether a new agent run may start under the organization's daily budget. */
export async function checkOrgDailyBudgetAllowed(
  now: Date = new Date(),
): Promise<AgentRunStartDecision> {
  try {
    const budget = await getDailyTokenBudget();
    if (budget.limit === "unlimited") {
      return { allowed: true };
    }

    const usedToday = await readOrgDailyTokenUsage(now);
    if (usedToday >= budget.dailyTokens) {
      return {
        allowed: false,
        code: "daily_token_budget_exhausted",
        message: DAILY_TOKEN_BUDGET_EXHAUSTED_MESSAGE,
      };
    }

    return { allowed: true };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(
      `[budget] Refusing a run start: the daily token budget could not be read (${detail}).`,
    );
    return {
      allowed: false,
      code: "org_settings_unavailable",
      message: AGENT_RUNS_UNVERIFIABLE_MESSAGE,
    };
  }
}

/**
 * The organization's position at run start, for the in-flight check.
 *
 * A read failure here resolves to "unlimited" rather than to a breach: the
 * run-start gate has already refused if the budget was unreadable, so a failure
 * at this point must not halt a run that was admitted. Refusing to start and
 * killing work in progress are different decisions with different costs.
 */
export async function readDailyBudgetSnapshot(
  now: Date = new Date(),
): Promise<DailyBudgetSnapshot> {
  try {
    const limit = await getDailyTokenBudget();
    if (limit.limit === "unlimited") {
      return UNLIMITED_SNAPSHOT;
    }

    return { limit, usedToday: await readOrgDailyTokenUsage(now) };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(
      `[budget] Running without a daily budget snapshot (${detail}).`,
    );
    return UNLIMITED_SNAPSHOT;
  }
}
