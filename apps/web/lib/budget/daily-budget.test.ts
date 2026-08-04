import { beforeEach, describe, expect, mock, test } from "bun:test";

/**
 * The organization daily budget as a run-start gate.
 *
 * The property that matters most is the unglamorous one: an unreadable budget
 * refuses the run. A gate that treats "could not tell" as "allowed" stops
 * working exactly when the database is the thing going wrong, which is the
 * same reasoning as the kill switch it sits beside.
 */

let usedToday = 0;
let budget: unknown = { limit: "unlimited" };
let usageError: Error | null = null;
let budgetError: Error | null = null;
const usageQueries: Array<Date | undefined> = [];

mock.module("@/lib/org/settings", () => ({
  // `agent-runs-gate` imports this from the same module; the refusal shape is
  // shared with the kill switch, so the import comes along with it.
  readOrgSettings: async () => ({
    organizationId: "org-1",
    agentRunsPaused: false,
    dailyTokenBudget: null,
  }),
  getDailyTokenBudget: async () => {
    if (budgetError) {
      throw budgetError;
    }
    return budget;
  },
}));

mock.module("@/lib/budget/org-daily-usage", () => ({
  readOrgDailyTokenUsage: async (now?: Date) => {
    usageQueries.push(now);
    if (usageError) {
      throw usageError;
    }
    return usedToday;
  },
}));

const {
  checkOrgDailyBudgetAllowed,
  DAILY_TOKEN_BUDGET_EXHAUSTED_MESSAGE,
  readDailyBudgetSnapshot,
} = await import("@/lib/budget/daily-budget");

beforeEach(() => {
  usedToday = 0;
  budget = { limit: "unlimited" };
  usageError = null;
  budgetError = null;
  usageQueries.length = 0;
});

describe("checkOrgDailyBudgetAllowed", () => {
  test("an unlimited budget allows the run and asks for no usage", async () => {
    expect(await checkOrgDailyBudgetAllowed()).toEqual({ allowed: true });
    expect(usageQueries).toHaveLength(0);
  });

  test("usage below the budget allows the run", async () => {
    budget = { limit: "limited", dailyTokens: 1000 };
    usedToday = 999;

    expect(await checkOrgDailyBudgetAllowed()).toEqual({ allowed: true });
  });

  test("reaching the budget refuses the run", async () => {
    budget = { limit: "limited", dailyTokens: 1000 };
    usedToday = 1000;

    const decision = await checkOrgDailyBudgetAllowed();

    expect(decision.allowed).toBe(false);
    if (decision.allowed) {
      throw new Error("expected a refusal");
    }
    expect(decision.code).toBe("daily_token_budget_exhausted");
    expect(decision.message).toBe(DAILY_TOKEN_BUDGET_EXHAUSTED_MESSAGE);
    // The boundary is stated wherever the budget is, including the refusal.
    expect(decision.message).toContain("UTC");
  });

  test("an unreadable budget refuses rather than defaulting to permitted", async () => {
    budgetError = new Error("connection reset");

    const decision = await checkOrgDailyBudgetAllowed();

    expect(decision.allowed).toBe(false);
    if (decision.allowed) {
      throw new Error("expected a refusal");
    }
    expect(decision.code).toBe("org_settings_unavailable");
  });

  test("an unreadable usage total refuses too", async () => {
    budget = { limit: "limited", dailyTokens: 1000 };
    usageError = new Error("connection reset");

    const decision = await checkOrgDailyBudgetAllowed();

    expect(decision.allowed).toBe(false);
  });
});

describe("readDailyBudgetSnapshot", () => {
  test("reads usage only when there is a limit to compare it to", async () => {
    expect(await readDailyBudgetSnapshot()).toEqual({
      limit: { limit: "unlimited" },
      usedToday: 0,
    });
    expect(usageQueries).toHaveLength(0);
  });

  test("carries the organization's spend so far this UTC day", async () => {
    budget = { limit: "limited", dailyTokens: 1000 };
    usedToday = 250;

    expect(await readDailyBudgetSnapshot()).toEqual({
      limit: { limit: "limited", dailyTokens: 1000 },
      usedToday: 250,
    });
  });

  test("a read failure becomes an unlimited snapshot, never a false breach", async () => {
    budgetError = new Error("connection reset");

    expect(await readDailyBudgetSnapshot()).toEqual({
      limit: { limit: "unlimited" },
      usedToday: 0,
    });
  });
});
