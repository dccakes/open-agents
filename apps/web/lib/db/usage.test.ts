import { beforeEach, describe, expect, mock, test } from "bun:test";

interface InsertedUsageRow {
  userId: string;
  sessionId?: string | null;
  workflowRunId?: string | null;
  [key: string]: unknown;
}

const insertedRows: InsertedUsageRow[] = [];

const fakeDb = {
  insert: () => ({
    values: async (row: InsertedUsageRow) => {
      insertedRows.push(row);
    },
  }),
};

mock.module("./client", () => ({
  db: fakeDb,
}));

const usageModulePromise = import("./usage");

beforeEach(() => {
  insertedRows.length = 0;
});

describe("recordUsage attribution", () => {
  const usage = {
    inputTokens: 100,
    cachedInputTokens: 10,
    outputTokens: 50,
  };

  test("persists sessionId and workflowRunId when provided", async () => {
    const { recordUsage } = await usageModulePromise;

    await recordUsage("user-1", {
      source: "web",
      agentType: "main",
      model: "openai/gpt-5",
      messages: [],
      usage,
      sessionId: "session-1",
      workflowRunId: "wrun-1",
    });

    expect(insertedRows).toHaveLength(1);
    expect(insertedRows[0]).toMatchObject({
      userId: "user-1",
      sessionId: "session-1",
      workflowRunId: "wrun-1",
    });
  });

  test("inserts with null attribution when the ids are omitted", async () => {
    const { recordUsage } = await usageModulePromise;

    await recordUsage("user-1", {
      source: "web",
      model: "openai/gpt-5",
      messages: [],
      usage,
    });

    expect(insertedRows).toHaveLength(1);
    expect(insertedRows[0]?.sessionId).toBeNull();
    expect(insertedRows[0]?.workflowRunId).toBeNull();
  });
});
