import { describe, expect, test } from "bun:test";
import { getTableColumns } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { usageEvents } from "./schema";

/**
 * `usage_events` is append-only and, until run attribution landed, had no index
 * at all — so the org daily-budget query was a full table scan. These pin both
 * the attribution columns and the indexes that make per-user and per-run
 * lookups possible, since dropping either is silent at typecheck time.
 */
describe("usage_events run attribution", () => {
  test("carries sessionId and workflowRunId columns", () => {
    const columns = getTableColumns(usageEvents);

    expect(Object.keys(columns)).toContain("sessionId");
    expect(Object.keys(columns)).toContain("workflowRunId");
  });

  test("attribution columns are nullable so historical rows stay valid", () => {
    const columns = getTableColumns(usageEvents);

    expect(columns.sessionId.notNull).toBe(false);
    expect(columns.workflowRunId.notNull).toBe(false);
  });

  test("attribution columns map to snake_case database columns", () => {
    const columns = getTableColumns(usageEvents);

    expect(columns.sessionId.name).toBe("session_id");
    expect(columns.workflowRunId.name).toBe("workflow_run_id");
  });

  test("is indexed by user and time and by workflow run", () => {
    const { indexes } = getTableConfig(usageEvents);

    const indexed = indexes.map((index) => ({
      name: index.config.name,
      columns: index.config.columns.map((column) =>
        "name" in column ? column.name : String(column),
      ),
    }));

    expect(indexed).toContainEqual({
      name: "usage_events_user_id_created_at_idx",
      columns: ["user_id", "created_at"],
    });
    expect(indexed).toContainEqual({
      name: "usage_events_workflow_run_id_idx",
      columns: ["workflow_run_id"],
    });
  });
});
