import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { Approval } from "@/lib/db/schema";

type Row = Record<string, unknown>;

let inserted: Row[] = [];
let conflictRows: Row[] = [];
let selectRows: Row[] = [];
let selectCalls = 0;

function pendingRow(overrides: Row = {}): Row {
  return {
    id: "approval-1",
    sessionId: "session-1",
    chatId: "chat-1",
    workflowRunId: "run-1",
    kind: "tool-call",
    toolName: "bash",
    toolCallId: "call-1",
    inputSummary: { command: "git push" },
    decision: "pending",
    decidedBy: null,
    consumedAt: null,
    expiresAt: new Date("2026-08-04T12:00:00Z"),
    createdAt: new Date("2026-08-03T12:00:00Z"),
    decidedAt: null,
    ...overrides,
  };
}

mock.module("@/lib/db/client", () => ({
  db: {
    insert: () => ({
      values: (values: Row) => ({
        onConflictDoNothing: () => ({
          returning: () => {
            // Empty mimics a concurrent request having already inserted the
            // row for this tool call.
            if (conflictRows.length > 0) {
              return Promise.resolve([]);
            }
            inserted.push(values);
            return Promise.resolve([values]);
          },
        }),
      }),
    }),
    select: () => ({
      from: () => ({
        where: () => {
          selectCalls += 1;
          const rows = conflictRows.length > 0 ? conflictRows : selectRows;
          return Object.assign(Promise.resolve(rows), {
            limit: () => Promise.resolve(rows.slice(0, 1)),
            orderBy: () =>
              Object.assign(Promise.resolve(rows), {
                limit: (count: number) => Promise.resolve(rows.slice(0, count)),
              }),
          });
        },
      }),
    }),
  },
}));

const modulePromise = import("@/lib/policy/approvals");

beforeEach(() => {
  inserted = [];
  conflictRows = [];
  selectRows = [];
  selectCalls = 0;
});

describe("createApproval", () => {
  test("writes a pending row identifying the session, tool, and operation", async () => {
    const { createApproval } = await modulePromise;

    await createApproval({
      sessionId: "session-1",
      chatId: "chat-1",
      workflowRunId: "run-1",
      kind: "tool-call",
      toolName: "bash",
      toolCallId: "call-1",
      input: { command: "git push origin main" },
      now: new Date("2026-08-03T12:00:00Z"),
    });

    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      sessionId: "session-1",
      chatId: "chat-1",
      workflowRunId: "run-1",
      kind: "tool-call",
      toolName: "bash",
      toolCallId: "call-1",
      decision: "pending",
      decidedBy: null,
      consumedAt: null,
      decidedAt: null,
      inputSummary: { command: "git push origin main" },
    });
  });

  test("stamps an expiry from configuration, so every row has one", async () => {
    const { createApproval } = await modulePromise;
    const now = new Date("2026-08-03T12:00:00Z");

    await createApproval({
      sessionId: "session-1",
      kind: "tool-call",
      toolName: "bash",
      toolCallId: "call-1",
      input: {},
      now,
    });

    const expiresAt = inserted[0]?.expiresAt as Date;
    expect(expiresAt).toBeInstanceOf(Date);
    // Default timeout is 24 hours.
    expect(expiresAt.getTime()).toBe(now.getTime() + 24 * 60 * 60 * 1000);
  });

  test("redacts the operation summary before it is stored", async () => {
    const { createApproval } = await modulePromise;

    await createApproval({
      sessionId: "session-1",
      kind: "tool-call",
      toolName: "bash",
      toolCallId: "call-1",
      input: {
        command:
          "git push https://ghp_abcdefghijklmnopqrstuvwxyz0123456789@github.com/x/y",
      },
    });

    expect(JSON.stringify(inserted[0]?.inputSummary)).not.toContain(
      "ghp_abcdefghij",
    );
  });

  test("refuses a tool-call approval with no tool call id", async () => {
    const { createApproval } = await modulePromise;

    await expect(
      createApproval({
        sessionId: "session-1",
        kind: "tool-call",
        toolName: "bash",
        input: {},
      }),
    ).rejects.toMatchObject({ name: "ApprovalError", kind: "invalid" });
    expect(inserted).toEqual([]);
  });

  test("allows an application-side-effect approval with no tool call", async () => {
    const { createApproval } = await modulePromise;

    await createApproval({
      sessionId: "session-1",
      kind: "app-side-effect",
      input: { operation: "auto-commit" },
    });

    expect(inserted[0]).toMatchObject({
      kind: "app-side-effect",
      toolName: null,
      toolCallId: null,
    });
  });

  test("returns the existing row when one already gates this tool call", async () => {
    // The unique index on tool_call_id is what makes this possible: two
    // concurrent requests cannot produce two competing approvals.
    conflictRows = [pendingRow()];
    const { createApproval } = await modulePromise;

    const approval = await createApproval({
      sessionId: "session-1",
      kind: "tool-call",
      toolName: "bash",
      toolCallId: "call-1",
      input: {},
    });

    expect(approval.id).toBe("approval-1");
    expect(inserted).toEqual([]);
    expect(selectCalls).toBe(1);
  });
});

describe("getApprovalForSession", () => {
  test("returns the row when it belongs to the session", async () => {
    selectRows = [pendingRow()];
    const { getApprovalForSession } = await modulePromise;

    const approval = await getApprovalForSession("session-1", "approval-1");

    expect(approval?.id).toBe("approval-1");
  });

  test("returns null when there is no such row", async () => {
    selectRows = [];
    const { getApprovalForSession } = await modulePromise;

    await expect(
      getApprovalForSession("session-1", "nope"),
    ).resolves.toBeNull();
  });
});

describe("getApprovalByToolCall", () => {
  test("looks the approval up by the tool call it gates", async () => {
    selectRows = [pendingRow()];
    const { getApprovalByToolCall } = await modulePromise;

    const approval = await getApprovalByToolCall("session-1", "call-1");

    expect(approval?.toolCallId).toBe("call-1");
  });

  test("returns null for a tool call nobody ever requested approval for", async () => {
    selectRows = [];
    const { getApprovalByToolCall } = await modulePromise;

    await expect(
      getApprovalByToolCall("session-1", "forged-call"),
    ).resolves.toBeNull();
  });
});

describe("listSessionApprovals", () => {
  test("reports each approval with the decision a reader must act on", async () => {
    selectRows = [
      pendingRow({ id: "live", expiresAt: new Date(Date.now() + 60_000) }),
      pendingRow({
        id: "stale",
        toolCallId: "call-2",
        expiresAt: new Date(Date.now() - 60_000),
      }),
    ];
    const { listSessionApprovals } = await modulePromise;

    const views = await listSessionApprovals("session-1");

    expect(views.find((view) => view.id === "live")?.decision).toBe("pending");
    // Expiry is computed on read: no job has run in this test.
    expect(views.find((view) => view.id === "stale")?.decision).toBe("expired");
  });

  test("reports the stored decision alongside the effective one", async () => {
    selectRows = [pendingRow({ expiresAt: new Date(Date.now() - 60_000) })];
    const { listSessionApprovals } = await modulePromise;

    const [view] = await listSessionApprovals("session-1");

    expect(view?.storedDecision).toBe("pending");
    expect(view?.decision).toBe("expired");
  });
});

describe("approval row typing", () => {
  test("the persisted shape is the schema's row type", async () => {
    selectRows = [pendingRow()];
    const { getApprovalForSession } = await modulePromise;

    const approval = await getApprovalForSession("session-1", "approval-1");
    const typed: Approval | null = approval;

    expect(typed?.kind).toBe("tool-call");
  });
});

describe("getAppSideEffectApproval", () => {
  test("finds the approval already gating this run's git automation", async () => {
    selectRows = [
      pendingRow({
        id: "app-1",
        kind: "app-side-effect",
        toolName: "app.git-automation",
        toolCallId: null,
      }),
    ];
    const { getAppSideEffectApproval } = await modulePromise;

    const found = await getAppSideEffectApproval("session-1", "run-1");

    expect(found?.id).toBe("app-1");
  });

  test("returns null when this run has never requested one", async () => {
    selectRows = [];
    const { getAppSideEffectApproval } = await modulePromise;

    await expect(
      getAppSideEffectApproval("session-1", "run-1"),
    ).resolves.toBeNull();
  });
});
