import { beforeEach, describe, expect, mock, test } from "bun:test";

type Row = Record<string, unknown>;

const HOUR = 60 * 60 * 1000;
const NOW = new Date("2026-08-03T12:00:00Z");

let storedRow: Row | null = null;
let updateSets: Row[] = [];
let updateWheres: unknown[] = [];
/** Simulates the atomic UPDATE matching zero rows (someone else won). */
let updateMatchesNothing = false;

function approvedRow(overrides: Row = {}): Row {
  return {
    id: "approval-1",
    sessionId: "session-1",
    chatId: "chat-1",
    workflowRunId: "run-1",
    kind: "tool-call",
    toolName: "bash",
    toolCallId: "call-1",
    inputSummary: { command: "git push origin main" },
    decision: "approved",
    decidedBy: "user-1",
    consumedAt: null,
    expiresAt: new Date(NOW.getTime() + HOUR),
    createdAt: new Date(NOW.getTime() - HOUR),
    decidedAt: new Date(NOW.getTime() - 60_000),
    ...overrides,
  };
}

mock.module("@/lib/db/client", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(storedRow ? [storedRow] : []),
        }),
      }),
    }),
    update: () => ({
      set: (values: Row) => ({
        where: (condition: unknown) => ({
          returning: () => {
            updateSets.push(values);
            updateWheres.push(condition);
            if (updateMatchesNothing || !storedRow) {
              return Promise.resolve([]);
            }
            storedRow = { ...storedRow, ...values };
            return Promise.resolve([storedRow]);
          },
        }),
      }),
    }),
  },
}));

const modulePromise = import("@/lib/policy/approval-enforcement");

beforeEach(() => {
  storedRow = approvedRow();
  updateSets = [];
  updateWheres = [];
  updateMatchesNothing = false;
});

/** Column names referenced anywhere inside a drizzle condition tree. */
function conditionColumns(condition: unknown): string[] {
  const names: string[] = [];
  const walk = (value: unknown) => {
    if (Array.isArray(value)) {
      for (const entry of value) {
        walk(entry);
      }
      return;
    }
    if (value && typeof value === "object") {
      if (
        "name" in value &&
        "table" in value &&
        typeof (value as { name: unknown }).name === "string"
      ) {
        names.push((value as { name: string }).name);
      }
      if ("queryChunks" in value) {
        walk((value as { queryChunks: unknown }).queryChunks);
      }
    }
  };
  walk(condition);
  return names;
}

describe("verifyToolCallApproval", () => {
  test("authorizes a tool call backed by a live approved record", async () => {
    const { verifyToolCallApproval } = await modulePromise;

    await expect(
      verifyToolCallApproval({
        sessionId: "session-1",
        toolCallId: "call-1",
        now: NOW,
      }),
    ).resolves.toMatchObject({ authorized: true, approvalId: "approval-1" });
  });

  /**
   * The point of the whole table. Today the approval decision arrives inside
   * the client-supplied `messages[].parts`, so anyone who can send the resume
   * request can assert that any tool call was approved.
   */
  test("refuses a tool call with no approval record at all", async () => {
    storedRow = null;
    const { verifyToolCallApproval } = await modulePromise;

    const result = await verifyToolCallApproval({
      sessionId: "session-1",
      toolCallId: "forged-call",
      now: NOW,
    });

    expect(result.authorized).toBe(false);
    expect(result.authorized === false && result.code).toBe(
      "no_approval_record",
    );
  });

  test("refuses while the approval is still pending", async () => {
    storedRow = approvedRow({ decision: "pending", decidedBy: null });
    const { verifyToolCallApproval } = await modulePromise;

    const result = await verifyToolCallApproval({
      sessionId: "session-1",
      toolCallId: "call-1",
      now: NOW,
    });

    expect(result.authorized === false && result.code).toBe("not_approved");
  });

  test("refuses a denied approval", async () => {
    storedRow = approvedRow({ decision: "denied" });
    const { verifyToolCallApproval } = await modulePromise;

    const result = await verifyToolCallApproval({
      sessionId: "session-1",
      toolCallId: "call-1",
      now: NOW,
    });

    expect(result.authorized === false && result.code).toBe("denied");
  });

  /** No sweeper has run in this test, and none needs to. */
  test("refuses an expired approval without any job having run", async () => {
    storedRow = approvedRow({
      decision: "approved",
      expiresAt: new Date(NOW.getTime() - 1),
    });
    const { verifyToolCallApproval } = await modulePromise;

    const result = await verifyToolCallApproval({
      sessionId: "session-1",
      toolCallId: "call-1",
      now: NOW,
    });

    expect(result.authorized === false && result.code).toBe("expired");
    // Verification is a read: it must not write the terminal state itself.
    expect(updateSets).toEqual([]);
  });

  test("refuses an approval that has already been spent", async () => {
    storedRow = approvedRow({ consumedAt: new Date(NOW.getTime() - 60_000) });
    const { verifyToolCallApproval } = await modulePromise;

    const result = await verifyToolCallApproval({
      sessionId: "session-1",
      toolCallId: "call-1",
      now: NOW,
    });

    expect(result.authorized === false && result.code).toBe("already_consumed");
  });

  /**
   * A row can be both denied and past its expiry. Reporting it one way from
   * `verifyToolCallApproval` and another from `consumeToolCallApproval` would
   * mean the refusal a user saw at admission did not match the one the tool
   * reported, for the same row at the same instant.
   */
  test("agrees with the consume path about a denied-and-expired row", async () => {
    storedRow = approvedRow({
      decision: "denied",
      expiresAt: new Date(NOW.getTime() - 1),
    });
    const { verifyToolCallApproval, consumeToolCallApproval } =
      await modulePromise;

    const verified = await verifyToolCallApproval({
      sessionId: "session-1",
      toolCallId: "call-1",
      now: NOW,
    });
    const consumed = await consumeToolCallApproval({
      sessionId: "session-1",
      toolCallId: "call-1",
      now: NOW,
    });

    expect(verified.authorized === false && verified.code).toBe("expired");
    expect(consumed.authorized === false && consumed.code).toBe("expired");
    expect(updateSets).toEqual([]);
  });

  test("does not consume the approval it verifies", async () => {
    const { verifyToolCallApproval } = await modulePromise;

    await verifyToolCallApproval({
      sessionId: "session-1",
      toolCallId: "call-1",
      now: NOW,
    });

    expect(updateSets).toEqual([]);
  });
});

describe("consumeToolCallApproval", () => {
  test("authorizes and stamps the approval consumed", async () => {
    const { consumeToolCallApproval } = await modulePromise;

    const result = await consumeToolCallApproval({
      sessionId: "session-1",
      toolCallId: "call-1",
      now: NOW,
    });

    expect(result.authorized).toBe(true);
    expect(updateSets).toHaveLength(1);
    expect(updateSets[0]?.consumedAt).toEqual(NOW);
  });

  /**
   * Single use. A replayed message body asserting the same approval finds the
   * row already consumed and is refused, so it cannot re-authorize a second
   * execution.
   */
  test("refuses a replay of a message body whose approval was already spent", async () => {
    const { consumeToolCallApproval } = await modulePromise;

    const first = await consumeToolCallApproval({
      sessionId: "session-1",
      toolCallId: "call-1",
      now: NOW,
    });
    const replay = await consumeToolCallApproval({
      sessionId: "session-1",
      toolCallId: "call-1",
      now: new Date(NOW.getTime() + 1000),
    });

    expect(first.authorized).toBe(true);
    expect(replay.authorized).toBe(false);
    expect(replay.authorized === false && replay.code).toBe("already_consumed");
    // One execution, one write.
    expect(updateSets).toHaveLength(1);
  });

  /**
   * Two concurrent executions both read an unconsumed row; the compare-and-set
   * is what decides between them, not the read.
   */
  test("refuses when the compare-and-set matches no row", async () => {
    updateMatchesNothing = true;
    const { consumeToolCallApproval } = await modulePromise;

    const result = await consumeToolCallApproval({
      sessionId: "session-1",
      toolCallId: "call-1",
      now: NOW,
    });

    expect(result.authorized).toBe(false);
    expect(result.authorized === false && result.code).toBe("already_consumed");
  });

  test("spends the approval with a condition that pins decision, consumption, and expiry", async () => {
    const { consumeToolCallApproval } = await modulePromise;

    await consumeToolCallApproval({
      sessionId: "session-1",
      toolCallId: "call-1",
      now: NOW,
    });

    // Single use cannot be enforced by the preceding read: another request can
    // pass the same read. The UPDATE's own WHERE is the enforcement.
    const columns = conditionColumns(updateWheres[0]);
    expect(columns).toContain("consumed_at");
    expect(columns).toContain("decision");
    expect(columns).toContain("expires_at");
    expect(columns).toContain("id");
  });

  test("writes nothing when there is no approval record", async () => {
    storedRow = null;
    const { consumeToolCallApproval } = await modulePromise;

    const result = await consumeToolCallApproval({
      sessionId: "session-1",
      toolCallId: "forged-call",
      now: NOW,
    });

    expect(result.authorized === false && result.code).toBe(
      "no_approval_record",
    );
    expect(updateSets).toEqual([]);
  });

  test("writes nothing for an expired approval", async () => {
    storedRow = approvedRow({ expiresAt: new Date(NOW.getTime() - 1) });
    const { consumeToolCallApproval } = await modulePromise;

    const result = await consumeToolCallApproval({
      sessionId: "session-1",
      toolCallId: "call-1",
      now: NOW,
    });

    expect(result.authorized === false && result.code).toBe("expired");
    expect(updateSets).toEqual([]);
  });

  test("every refusal carries a message the model can act on", async () => {
    storedRow = approvedRow({ decision: "denied" });
    const { consumeToolCallApproval } = await modulePromise;

    const result = await consumeToolCallApproval({
      sessionId: "session-1",
      toolCallId: "call-1",
      now: NOW,
    });

    expect(result.authorized).toBe(false);
    expect(
      result.authorized === false && result.message.length,
    ).toBeGreaterThan(0);
  });
});

describe("consumeAppSideEffectApproval", () => {
  test("spends an approved application side effect once", async () => {
    storedRow = approvedRow({
      kind: "app-side-effect",
      toolName: "app.git-automation",
      toolCallId: null,
    });
    const { consumeAppSideEffectApproval } = await modulePromise;

    const result = await consumeAppSideEffectApproval({
      sessionId: "session-1",
      approvalId: "approval-1",
      now: NOW,
    });

    expect(result).toMatchObject({
      authorized: true,
      approvalId: "approval-1",
    });
    expect(updateSets).toEqual([{ consumedAt: NOW }]);
  });

  test("refuses a second spend of the same approval", async () => {
    storedRow = approvedRow({
      kind: "app-side-effect",
      toolCallId: null,
      consumedAt: new Date(NOW.getTime() - 1000),
    });
    const { consumeAppSideEffectApproval } = await modulePromise;

    const result = await consumeAppSideEffectApproval({
      sessionId: "session-1",
      approvalId: "approval-1",
      now: NOW,
    });

    expect(result.authorized === false && result.code).toBe("already_consumed");
    expect(updateSets).toEqual([]);
  });

  test("treats a denied application side effect as a denial", async () => {
    storedRow = approvedRow({
      kind: "app-side-effect",
      toolCallId: null,
      decision: "denied",
    });
    const { consumeAppSideEffectApproval } = await modulePromise;

    const result = await consumeAppSideEffectApproval({
      sessionId: "session-1",
      approvalId: "approval-1",
      now: NOW,
    });

    expect(result.authorized === false && result.code).toBe("denied");
  });

  /**
   * A tool-call approval and an application side effect are different
   * authorizations. Letting one be spent as the other would mean approving a
   * `git push` also authorized the run's auto-commit, and vice versa.
   */
  test("refuses to spend a tool-call approval as an application side effect", async () => {
    storedRow = approvedRow({ kind: "tool-call" });
    const { consumeAppSideEffectApproval } = await modulePromise;

    const result = await consumeAppSideEffectApproval({
      sessionId: "session-1",
      approvalId: "approval-1",
      now: NOW,
    });

    expect(result.authorized === false && result.code).toBe(
      "no_approval_record",
    );
    expect(updateSets).toEqual([]);
  });

  test("refuses to spend an application side effect as a tool call", async () => {
    storedRow = approvedRow({ kind: "app-side-effect", toolCallId: "call-1" });
    const { consumeToolCallApproval } = await modulePromise;

    const result = await consumeToolCallApproval({
      sessionId: "session-1",
      toolCallId: "call-1",
      now: NOW,
    });

    expect(result.authorized === false && result.code).toBe(
      "no_approval_record",
    );
    expect(updateSets).toEqual([]);
  });
});
