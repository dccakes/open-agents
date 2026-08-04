import { beforeEach, describe, expect, mock, test } from "bun:test";

interface InsertCall {
  table: unknown;
  values: Record<string, unknown> | Record<string, unknown>[];
}

let insertCalls: InsertCall[] = [];
let insertError: Error | null = null;
const forbidden: string[] = [];

mock.module("@/lib/db/client", () => ({
  db: {
    insert: (table: unknown) => ({
      values: async (
        values: Record<string, unknown> | Record<string, unknown>[],
      ) => {
        if (insertError) {
          throw insertError;
        }
        insertCalls.push({ table, values });
        return await Promise.resolve(undefined);
      },
    }),
    // Any use of these against `policy_event` is the bug this table exists to
    // prevent, so they record the attempt instead of working.
    update: () => {
      forbidden.push("update");
      throw new Error("policy_event is append-only");
    },
    delete: () => {
      forbidden.push("delete");
      throw new Error("policy_event is append-only");
    },
  },
}));

const modulePromise = import("@/lib/policy/policy-events");

beforeEach(() => {
  insertCalls = [];
  insertError = null;
  forbidden.length = 0;
});

describe("recordPolicyEvent", () => {
  test("inserts one row carrying session, run, tool, decision, rule, and posture", async () => {
    const { recordPolicyEvent } = await modulePromise;

    await recordPolicyEvent({
      sessionId: "session-1",
      workflowRunId: "run-1",
      toolName: "bash",
      input: { command: "git push origin main" },
      decision: "ask",
      matchedRule: "bash.ask.git-push",
      posture: "auto",
    });

    expect(insertCalls).toHaveLength(1);
    expect(insertCalls[0]?.values).toMatchObject({
      sessionId: "session-1",
      workflowRunId: "run-1",
      toolName: "bash",
      decision: "ask",
      matchedRule: "bash.ask.git-push",
      posture: "auto",
      inputSummary: { command: "git push origin main" },
    });
  });

  test("mints an id so the caller never has to", async () => {
    const { recordPolicyEvent } = await modulePromise;

    await recordPolicyEvent({
      sessionId: "session-1",
      decision: "deny",
      posture: "auto",
      input: {},
    });

    const values = insertCalls[0]?.values as Record<string, unknown>;
    expect(typeof values.id).toBe("string");
    expect((values.id as string).length).toBeGreaterThan(0);
  });

  test("redacts the input summary before it reaches the column", async () => {
    const { recordPolicyEvent } = await modulePromise;

    await recordPolicyEvent({
      sessionId: "session-1",
      toolName: "bash",
      input: {
        command:
          "git push https://ghp_abcdefghijklmnopqrstuvwxyz0123456789@github.com/x/y",
      },
      decision: "deny",
      posture: "strict",
      matchedRule: "bash.deny.credential-exfiltration",
    });

    const values = insertCalls[0]?.values as Record<string, unknown>;
    expect(JSON.stringify(values.inputSummary)).not.toContain("ghp_abcdefghij");
  });

  test("normalizes absent optional fields to null rather than undefined", async () => {
    const { recordPolicyEvent } = await modulePromise;

    await recordPolicyEvent({
      sessionId: "session-1",
      decision: "allow",
      posture: "auto",
      input: {},
    });

    expect(insertCalls[0]?.values).toMatchObject({
      workflowRunId: null,
      toolName: null,
      matchedRule: null,
    });
  });

  test("never uses update or delete — the table is append-only", async () => {
    const { recordPolicyEvent } = await modulePromise;

    await recordPolicyEvent({
      sessionId: "session-1",
      decision: "deny",
      posture: "auto",
      input: {},
    });

    expect(forbidden).toEqual([]);
  });

  test("a failed write does not fail the decision it describes", async () => {
    insertError = new Error("connection reset");
    const { recordPolicyEvent } = await modulePromise;

    await expect(
      recordPolicyEvent({
        sessionId: "session-1",
        decision: "deny",
        posture: "auto",
        input: {},
      }),
    ).resolves.toBeUndefined();
  });
});

describe("recordPolicyEvents", () => {
  test("writes a batch in one insert", async () => {
    const { recordPolicyEvents } = await modulePromise;

    await recordPolicyEvents([
      { sessionId: "s1", decision: "expired", posture: "auto", input: {} },
      { sessionId: "s2", decision: "expired", posture: "strict", input: {} },
    ]);

    expect(insertCalls).toHaveLength(1);
    expect(insertCalls[0]?.values).toBeArrayOfSize(2);
  });

  test("writes nothing for an empty batch", async () => {
    const { recordPolicyEvents } = await modulePromise;

    await recordPolicyEvents([]);

    expect(insertCalls).toEqual([]);
  });
});
