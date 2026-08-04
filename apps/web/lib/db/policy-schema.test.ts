import { describe, expect, test } from "bun:test";
import { getTableColumns } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { approvals, policyEvents, sessions } from "./schema";

/**
 * The posture column and the two policy tables are load-bearing for
 * authorization, and every property pinned here is silent at typecheck time:
 * dropping the `auto` default, widening the decision enum, or losing an index
 * all compile fine and all change what the system enforces.
 */

function indexShapes(table: Parameters<typeof getTableConfig>[0]) {
  const { indexes } = getTableConfig(table);
  return indexes.map((index) => ({
    name: index.config.name,
    unique: index.config.unique,
    columns: index.config.columns.map((column) =>
      "name" in column ? column.name : String(column),
    ),
  }));
}

describe("sessions.posture", () => {
  test("exists as a non-null column named posture", () => {
    const columns = getTableColumns(sessions);

    expect(Object.keys(columns)).toContain("posture");
    expect(columns.posture.name).toBe("posture");
    expect(columns.posture.notNull).toBe(true);
  });

  test("defaults to auto, so existing sessions keep today's behaviour", () => {
    expect(getTableColumns(sessions).posture.default).toBe("auto");
  });

  test("accepts exactly the three postures", () => {
    expect(getTableColumns(sessions).posture.enumValues).toEqual([
      "strict",
      "auto",
      "dangerous",
    ]);
  });
});

describe("approval table", () => {
  test("is named approval", () => {
    expect(getTableConfig(approvals).name).toBe("approval");
  });

  test("identifies the session, chat, and workflow run", () => {
    const columns = getTableColumns(approvals);

    expect(columns.sessionId.notNull).toBe(true);
    // A chat exists only for tool-call approvals, and the workflow run row is
    // not written until the run finishes today — both must stay nullable.
    expect(columns.chatId.notNull).toBe(false);
    expect(columns.workflowRunId.notNull).toBe(false);
  });

  test("records the kind, tool, and tool call it gates", () => {
    const columns = getTableColumns(approvals);

    expect(columns.kind.enumValues).toEqual(["tool-call", "app-side-effect"]);
    expect(columns.kind.notNull).toBe(true);
    expect(columns.toolName.notNull).toBe(false);
    expect(columns.toolCallId.notNull).toBe(false);
  });

  test("stores a redacted input summary rather than the raw input", () => {
    const columns = getTableColumns(approvals);

    expect(columns.inputSummary.name).toBe("input_summary");
    expect(columns.inputSummary.columnType).toBe("PgJsonb");
    expect(columns.inputSummary.notNull).toBe(true);
  });

  test("starts pending and can reach approved, denied, or expired", () => {
    const columns = getTableColumns(approvals);

    expect(columns.decision.enumValues).toEqual([
      "pending",
      "approved",
      "denied",
      "expired",
    ]);
    expect(columns.decision.notNull).toBe(true);
    expect(columns.decision.default).toBe("pending");
  });

  test("records who decided and when, and when the approval was consumed", () => {
    const columns = getTableColumns(approvals);

    expect(columns.decidedBy.notNull).toBe(false);
    expect(columns.decidedAt.notNull).toBe(false);
    // Single-use: set the first time an execution spends the approval.
    expect(columns.consumedAt.name).toBe("consumed_at");
    expect(columns.consumedAt.notNull).toBe(false);
  });

  test("always carries an expiry, so every row has something to time out", () => {
    const columns = getTableColumns(approvals);

    expect(columns.expiresAt.notNull).toBe(true);
    expect(columns.createdAt.notNull).toBe(true);
  });

  test("indexes the read paths: by session, by tool call, and by expiry", () => {
    const shapes = indexShapes(approvals);

    expect(shapes).toContainEqual({
      name: "approval_session_decision_idx",
      unique: false,
      columns: ["session_id", "decision"],
    });
    // Unique: one tool call may never be gated by two competing approvals.
    expect(shapes).toContainEqual({
      name: "approval_tool_call_id_idx",
      unique: true,
      columns: ["tool_call_id"],
    });
    expect(shapes).toContainEqual({
      name: "approval_decision_expires_at_idx",
      unique: false,
      columns: ["decision", "expires_at"],
    });
  });
});

describe("policy_event table", () => {
  test("is named policy_event", () => {
    expect(getTableConfig(policyEvents).name).toBe("policy_event");
  });

  test("records the session, run, tool, decision, rule, and posture", () => {
    const columns = getTableColumns(policyEvents);

    expect(columns.sessionId.notNull).toBe(true);
    expect(columns.workflowRunId.notNull).toBe(false);
    expect(columns.toolName.notNull).toBe(false);
    expect(columns.decision.enumValues).toEqual([
      "allow",
      "ask",
      "deny",
      "expired",
      "downgraded",
    ]);
    expect(columns.matchedRule.name).toBe("matched_rule");
    expect(columns.posture.enumValues).toEqual(["strict", "auto", "dangerous"]);
    expect(columns.posture.notNull).toBe(true);
  });

  test("stores a redacted input summary", () => {
    const columns = getTableColumns(policyEvents);

    expect(columns.inputSummary.columnType).toBe("PgJsonb");
    expect(columns.inputSummary.notNull).toBe(true);
  });

  test("has no mutable state: append-only means createdAt and nothing else", () => {
    const columns = getTableColumns(policyEvents);

    expect(columns.createdAt.notNull).toBe(true);
    expect(Object.keys(columns)).not.toContain("updatedAt");
    expect(Object.keys(columns)).not.toContain("deletedAt");
  });

  test("indexes the session and run read paths", () => {
    const shapes = indexShapes(policyEvents);

    expect(shapes).toContainEqual({
      name: "policy_event_session_created_at_idx",
      unique: false,
      columns: ["session_id", "created_at"],
    });
    expect(shapes).toContainEqual({
      name: "policy_event_workflow_run_id_idx",
      unique: false,
      columns: ["workflow_run_id"],
    });
  });
});
