import { describe, expect, test } from "bun:test";
import { describeBudgetHalt } from "./budget-halt-card";

/**
 * The copy shown when a run stops on a budget. Tested as text, since the
 * requirement is about what the user is told: which budget, what the totals
 * were, and — for the daily budget — when the day rolls over.
 */
describe("describeBudgetHalt", () => {
  test("names the run token budget and the totals", () => {
    const description = describeBudgetHalt({
      budget: "run-tokens",
      used: 120_000,
      limit: 100_000,
      message: "ignored here; the card composes its own copy",
    });

    expect(description.title).toContain("token budget");
    expect(description.detail).toContain("120,000");
    expect(description.detail).toContain("100,000");
    expect(description.boundaryNote).toBeUndefined();
  });

  test("counts steps in steps, not tokens", () => {
    const description = describeBudgetHalt({
      budget: "run-steps",
      used: 500,
      limit: 500,
      message: "",
    });

    expect(description.title).toContain("step budget");
    expect(description.detail).toContain("steps");
    expect(description.detail).not.toContain("tokens");
  });

  test("states the UTC day boundary wherever the daily budget is shown", () => {
    const description = describeBudgetHalt({
      budget: "org-daily-tokens",
      used: 1200,
      limit: 1000,
      message: "",
    });

    expect(description.title).toContain("daily token budget");
    expect(description.boundaryNote).toContain("UTC midnight");
  });

  test("prefers the boundary note the run reported", () => {
    expect(
      describeBudgetHalt({
        budget: "org-daily-tokens",
        used: 1,
        limit: 1,
        message: "",
        dayBoundary: "Resets at UTC midnight, per the organization settings.",
      }).boundaryNote,
    ).toBe("Resets at UTC midnight, per the organization settings.");
  });

  test("a run halt says nothing about a day boundary it does not have", () => {
    expect(
      describeBudgetHalt({
        budget: "run-steps",
        used: 1,
        limit: 1,
        message: "",
      }).boundaryNote,
    ).toBeUndefined();
  });
});
