import { describe, expect, test } from "bun:test";
import { getTableColumns } from "drizzle-orm";
import { workflowRuns } from "./schema";

/**
 * `workflow_runs` gained an in-progress lifecycle: the row is written at run
 * start, not only when the run ends. That weakens a real invariant — a row no
 * longer implies a finished run — so the nullability is pinned here rather
 * than left to a migration nobody re-reads.
 */
describe("workflow_runs lifecycle", () => {
  test("finish columns are nullable, because a run in flight has no finish", () => {
    const columns = getTableColumns(workflowRuns);

    expect(columns.finishedAt.notNull).toBe(false);
    expect(columns.totalDurationMs.notNull).toBe(false);
  });

  test("carries running totals that default to zero", () => {
    const columns = getTableColumns(workflowRuns);

    for (const name of ["inputTokens", "outputTokens", "stepCount"] as const) {
      expect(columns[name].notNull).toBe(true);
      expect(columns[name].hasDefault).toBe(true);
    }
  });

  test("carries a nullable halt reason", () => {
    const columns = getTableColumns(workflowRuns);

    expect(Object.keys(columns)).toContain("haltReason");
    expect(columns.haltReason.notNull).toBe(false);
    expect(columns.haltReason.name).toBe("halt_reason");
  });

  test("running and budget-exceeded are distinct statuses", () => {
    const { status } = getTableColumns(workflowRuns);

    expect(status.enumValues).toEqual([
      "running",
      "completed",
      "aborted",
      "failed",
      "budget-exceeded",
    ]);
  });

  test("running totals map to snake_case database columns", () => {
    const columns = getTableColumns(workflowRuns);

    expect(columns.inputTokens.name).toBe("input_tokens");
    expect(columns.outputTokens.name).toBe("output_tokens");
    expect(columns.stepCount.name).toBe("step_count");
  });
});
