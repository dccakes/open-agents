import { beforeEach, describe, expect, mock, test } from "bun:test";

/**
 * The run row's lifecycle: inserted at start, updated per step, finished once.
 *
 * The database is faked down to the call shapes because what matters here is
 * *which* statement each entry point issues — an insert that is not idempotent
 * or a finish that does not overwrite the start row are both silent bugs that
 * only show up as a lost run.
 */

type Recorded = {
  op: string;
  table: string;
  values?: unknown;
  set?: unknown;
  conflict?: unknown;
};

const recorded: Recorded[] = [];

function tableName(table: unknown): string {
  const symbols = Object.getOwnPropertySymbols(table);
  for (const symbol of symbols) {
    if (symbol.toString().includes("Name")) {
      return String((table as Record<symbol, unknown>)[symbol]);
    }
  }
  return "unknown";
}

/**
 * Drizzle builders are awaited, so the fake has to be a real promise with the
 * builder methods hung off it — an object literal with a `then` would be a
 * thenable, which is its own category of bug.
 */
function builderPromise<T extends object>(methods: (self: T) => T): T {
  const promise = Promise.resolve([]) as unknown as T;
  return Object.assign(promise, methods(promise));
}

type InsertBuilder = {
  values: (values: unknown) => InsertBuilder;
  onConflictDoNothing: (conflict: unknown) => InsertBuilder;
  onConflictDoUpdate: (conflict: { set?: unknown }) => InsertBuilder;
};

function insertBuilder(table: unknown): InsertBuilder {
  const entry: Recorded = { op: "insert", table: tableName(table) };
  return builderPromise<InsertBuilder>((self) => ({
    values: (values: unknown) => {
      entry.values = values;
      recorded.push(entry);
      return self;
    },
    onConflictDoNothing: (conflict: unknown) => {
      entry.op = "insert:ignore";
      entry.conflict = conflict;
      return self;
    },
    onConflictDoUpdate: (conflict: { set?: unknown }) => {
      entry.op = "insert:upsert";
      entry.conflict = conflict;
      entry.set = conflict.set;
      return self;
    },
  }));
}

type UpdateBuilder = {
  set: (set: unknown) => UpdateBuilder;
  where: () => UpdateBuilder;
};

function updateBuilder(table: unknown): UpdateBuilder {
  const entry: Recorded = { op: "update", table: tableName(table) };
  return builderPromise<UpdateBuilder>((self) => ({
    set: (set: unknown) => {
      entry.set = set;
      recorded.push(entry);
      return self;
    },
    where: () => self,
  }));
}

const fakeClient = {
  insert: insertBuilder,
  update: updateBuilder,
  transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
    await fn(fakeClient),
};

mock.module("./client", () => ({ db: fakeClient }));

const {
  finishWorkflowRun,
  recordWorkflowRun,
  startWorkflowRun,
  updateWorkflowRunProgress,
} = await import("./workflow-runs");

function runRows(): Recorded[] {
  return recorded.filter((entry) => entry.table === "workflow_runs");
}

beforeEach(() => {
  recorded.length = 0;
});

describe("startWorkflowRun", () => {
  test("writes a running row with no finish time", async () => {
    await startWorkflowRun({
      id: "run-1",
      chatId: "chat-1",
      sessionId: "session-1",
      userId: "user-1",
      modelId: "gpt-4",
      startedAt: "2026-01-01T00:00:00.000Z",
    });

    const [row] = runRows();
    expect(row?.op).toBe("insert:ignore");
    expect(row?.values).toMatchObject({
      id: "run-1",
      status: "running",
      finishedAt: null,
      totalDurationMs: null,
      inputTokens: 0,
      outputTokens: 0,
      stepCount: 0,
    });
  });

  test("is idempotent, so a retried start does not duplicate the run", async () => {
    await startWorkflowRun({
      id: "run-1",
      chatId: "chat-1",
      sessionId: "session-1",
      userId: "user-1",
      startedAt: "2026-01-01T00:00:00.000Z",
    });

    expect(runRows()[0]?.op).toBe("insert:ignore");
  });
});

describe("updateWorkflowRunProgress", () => {
  test("persists the running totals so a resumed run keeps its budget", async () => {
    await updateWorkflowRunProgress({
      id: "run-1",
      inputTokens: 120,
      outputTokens: 45,
      stepCount: 3,
    });

    const [row] = runRows();
    expect(row?.op).toBe("update");
    expect(row?.set).toEqual({
      inputTokens: 120,
      outputTokens: 45,
      stepCount: 3,
    });
  });
});

describe("finishWorkflowRun", () => {
  test("upserts, so a run whose start row was lost is still recorded", async () => {
    await finishWorkflowRun({
      id: "run-1",
      chatId: "chat-1",
      sessionId: "session-1",
      userId: "user-1",
      status: "budget-exceeded",
      startedAt: "2026-01-01T00:00:00.000Z",
      finishedAt: "2026-01-01T00:00:05.000Z",
      totalDurationMs: 5000,
      inputTokens: 10,
      outputTokens: 5,
      stepCount: 2,
      haltReason: "Token budget exceeded: 15 of 10 tokens.",
    });

    const [row] = runRows();
    expect(row?.op).toBe("insert:upsert");
    expect(row?.set).toMatchObject({
      status: "budget-exceeded",
      totalDurationMs: 5000,
      haltReason: "Token budget exceeded: 15 of 10 tokens.",
    });
    const finishedAt = (row?.set as { finishedAt?: Date } | undefined)
      ?.finishedAt;
    expect(finishedAt?.toISOString()).toBe("2026-01-01T00:00:05.000Z");
  });
});

describe("recordWorkflowRun", () => {
  test("still writes both the run and its step timings", async () => {
    await recordWorkflowRun({
      id: "run-1",
      chatId: "chat-1",
      sessionId: "session-1",
      userId: "user-1",
      status: "completed",
      startedAt: "2026-01-01T00:00:00.000Z",
      finishedAt: "2026-01-01T00:00:05.000Z",
      totalDurationMs: 5000,
      stepTimings: [
        {
          stepNumber: 1,
          startedAt: "2026-01-01T00:00:00.000Z",
          finishedAt: "2026-01-01T00:00:05.000Z",
          durationMs: 5000,
        },
      ],
    });

    expect(recorded.map((entry) => entry.table)).toEqual([
      "workflow_runs",
      "workflow_run_steps",
    ]);
  });
});
