import { describe, expect, test } from "bun:test";
import { checkRunBudget } from "@/lib/budget/run-budget";

/**
 * The per-run budget check. Pure, so it is tested as arithmetic rather than
 * through the workflow — the workflow test covers that it is *called*.
 */

const unlimitedTokens = { limit: "unlimited" } as const;

function usage(
  overrides: Partial<Parameters<typeof checkRunBudget>[0]["usage"]> = {},
) {
  return { inputTokens: 0, outputTokens: 0, stepCount: 0, ...overrides };
}

describe("token budget", () => {
  test("input and output tokens both count", () => {
    const verdict = checkRunBudget({
      usage: usage({ inputTokens: 60, outputTokens: 60 }),
      stepBudget: 500,
      tokenBudget: { limit: "limited", tokens: 100 },
    });

    expect(verdict.withinBudget).toBe(false);
    if (verdict.withinBudget) {
      throw new Error("expected a breach");
    }
    expect(verdict.breach.budget).toBe("run-tokens");
    expect(verdict.breach.used).toBe(120);
    expect(verdict.breach.limit).toBe(100);
    expect(verdict.breach.message).toContain("120");
    expect(verdict.breach.message).toContain("100");
  });

  test("spending exactly the budget is not a breach", () => {
    expect(
      checkRunBudget({
        usage: usage({ inputTokens: 100 }),
        stepBudget: 500,
        tokenBudget: { limit: "limited", tokens: 100 },
      }).withinBudget,
    ).toBe(true);
  });

  test("an unset token budget never halts a run", () => {
    expect(
      checkRunBudget({
        usage: usage({ inputTokens: 10_000_000, stepCount: 1 }),
        stepBudget: 500,
        tokenBudget: unlimitedTokens,
      }).withinBudget,
    ).toBe(true);
  });
});

describe("step budget", () => {
  test("reaching the step budget halts", () => {
    const verdict = checkRunBudget({
      usage: usage({ stepCount: 3 }),
      stepBudget: 3,
      tokenBudget: unlimitedTokens,
    });

    expect(verdict.withinBudget).toBe(false);
    if (verdict.withinBudget) {
      throw new Error("expected a breach");
    }
    expect(verdict.breach.budget).toBe("run-steps");
    expect(verdict.breach.used).toBe(3);
  });

  test("an unset token budget still leaves the run bounded by steps", () => {
    const verdict = checkRunBudget({
      usage: usage({ inputTokens: 999_999, stepCount: 500 }),
      stepBudget: 500,
      tokenBudget: unlimitedTokens,
    });

    expect(verdict.withinBudget).toBe(false);
    if (verdict.withinBudget) {
      throw new Error("expected a breach");
    }
    expect(verdict.breach.budget).toBe("run-steps");
  });
});

describe("organization daily budget", () => {
  test("a run crossing the daily budget mid-flight breaches", () => {
    const verdict = checkRunBudget({
      usage: usage({ inputTokens: 400, stepCount: 1 }),
      stepBudget: 500,
      tokenBudget: unlimitedTokens,
      daily: { limit: { limit: "limited", dailyTokens: 1000 }, usedToday: 700 },
    });

    expect(verdict.withinBudget).toBe(false);
    if (verdict.withinBudget) {
      throw new Error("expected a breach");
    }
    expect(verdict.breach.budget).toBe("org-daily-tokens");
    // Usage recorded before the run plus what this run has spent.
    expect(verdict.breach.used).toBe(1100);
    expect(verdict.breach.message).toContain("UTC");
  });

  test("an unlimited daily budget applies no limit", () => {
    expect(
      checkRunBudget({
        usage: usage({ inputTokens: 10_000_000 }),
        stepBudget: 500,
        tokenBudget: unlimitedTokens,
        daily: { limit: { limit: "unlimited" }, usedToday: 10_000_000 },
      }).withinBudget,
    ).toBe(true);
  });

  test("no daily snapshot means no daily limit", () => {
    expect(
      checkRunBudget({
        usage: usage({ inputTokens: 10_000_000 }),
        stepBudget: 500,
        tokenBudget: unlimitedTokens,
      }).withinBudget,
    ).toBe(true);
  });
});

describe("precedence", () => {
  test("the run token budget is reported before the step budget", () => {
    const verdict = checkRunBudget({
      usage: usage({ inputTokens: 1000, stepCount: 500 }),
      stepBudget: 500,
      tokenBudget: { limit: "limited", tokens: 100 },
    });

    if (verdict.withinBudget) {
      throw new Error("expected a breach");
    }
    expect(verdict.breach.budget).toBe("run-tokens");
  });
});
