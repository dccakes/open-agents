import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { Approval } from "@/lib/db/schema";

/**
 * Approvals must survive a restart of the serving process. Nothing about that
 * is new machinery — it holds because the approval lives in the database and
 * no module keeps it in memory — but "holds by accident" and "holds" look the
 * same until somebody adds a cache.
 *
 * The store below stands in for the database and outlives the "restart"; the
 * modules are re-imported from a fresh module registry entry, which is as close
 * to a cold process as a single test can get. `selectCount` additionally proves
 * that a read after the restart really goes back to the store rather than being
 * served from anything the previous copy of the module left behind.
 */

type Row = Record<string, unknown>;

const NOW = new Date("2026-08-03T12:00:00Z");

/** Survives the simulated restart, exactly as a database would. */
const store: { rows: Row[] } = { rows: [] };
let selectCount = 0;

mock.module("@/lib/db/client", () => ({
  db: {
    insert: () => ({
      values: (values: Row) => ({
        onConflictDoNothing: () => ({
          returning: () => {
            store.rows.push(values);
            return Promise.resolve([values]);
          },
        }),
      }),
    }),
    select: () => ({
      from: () => ({
        where: () => {
          selectCount += 1;
          const rows = store.rows;
          return Object.assign(Promise.resolve(rows), {
            limit: () => Promise.resolve(rows.slice(0, 1)),
            orderBy: () => Promise.resolve(rows),
          });
        },
      }),
    }),
  },
}));

beforeEach(() => {
  store.rows = [];
  selectCount = 0;
});

/** A cache-busting import, standing in for a cold module registry. */
async function importAfterRestart(restartId: string) {
  return {
    approvals: (await import(
      `./approvals?restart=${restartId}`
    )) as typeof import("./approvals"),
    enforcement: (await import(
      `./approval-enforcement?restart=${restartId}`
    )) as typeof import("./approval-enforcement"),
  };
}

describe("a pending approval survives a process restart", () => {
  test("is still readable, and still pending, after the modules are reloaded", async () => {
    const before = await importAfterRestart("a");
    await before.approvals.createApproval({
      sessionId: "session-1",
      chatId: "chat-1",
      workflowRunId: "run-1",
      kind: "tool-call",
      toolName: "bash",
      toolCallId: "call-1",
      input: { command: "git push origin main" },
      now: NOW,
    });

    const after = await importAfterRestart("b");
    const recovered = await after.approvals.getApprovalByToolCall(
      "session-1",
      "call-1",
    );

    expect(recovered).not.toBeNull();
    expect(recovered?.decision).toBe("pending");
    expect(recovered?.toolCallId).toBe("call-1");
  });

  test("keeps the expiry it was created with, so the clock does not restart", async () => {
    const before = await importAfterRestart("c");
    await before.approvals.createApproval({
      sessionId: "session-1",
      kind: "tool-call",
      toolName: "bash",
      toolCallId: "call-1",
      input: {},
      now: NOW,
    });
    const originalExpiry = (store.rows[0] as { expiresAt: Date }).expiresAt;

    const after = await importAfterRestart("d");
    const recovered = await after.approvals.getApprovalByToolCall(
      "session-1",
      "call-1",
    );

    expect(recovered?.expiresAt).toEqual(originalExpiry);
  });

  test("reads go back to the store, so nothing is served from process memory", async () => {
    const before = await importAfterRestart("e");
    await before.approvals.createApproval({
      sessionId: "session-1",
      kind: "tool-call",
      toolName: "bash",
      toolCallId: "call-1",
      input: {},
      now: NOW,
    });

    const after = await importAfterRestart("f");
    await after.approvals.getApprovalByToolCall("session-1", "call-1");
    await after.approvals.getApprovalByToolCall("session-1", "call-1");

    expect(selectCount).toBe(2);
  });

  test("can still be verified after the restart, and is still not authorized", async () => {
    const before = await importAfterRestart("g");
    await before.approvals.createApproval({
      sessionId: "session-1",
      kind: "tool-call",
      toolName: "bash",
      toolCallId: "call-1",
      input: {},
      now: NOW,
    });

    const after = await importAfterRestart("h");
    const verification = await after.enforcement.verifyToolCallApproval({
      sessionId: "session-1",
      toolCallId: "call-1",
      now: NOW,
    });

    // Still pending: a restart neither loses the approval nor grants it.
    expect(verification.authorized).toBe(false);
    expect(verification.authorized === false && verification.code).toBe(
      "not_approved",
    );
  });

  test("a consumed approval stays consumed across the restart", async () => {
    const before = await importAfterRestart("i");
    await before.approvals.createApproval({
      sessionId: "session-1",
      kind: "tool-call",
      toolName: "bash",
      toolCallId: "call-1",
      input: {},
      now: NOW,
    });
    // Stand in for the approve-then-execute path.
    const stored = store.rows[0] as Row;
    stored.decision = "approved";
    stored.consumedAt = NOW;

    const after = await importAfterRestart("j");
    const recovered: Approval | null =
      await after.approvals.getApprovalByToolCall("session-1", "call-1");

    expect(recovered?.consumedAt).toEqual(NOW);
    const verification = await after.enforcement.verifyToolCallApproval({
      sessionId: "session-1",
      toolCallId: "call-1",
      now: NOW,
    });
    expect(verification.authorized === false && verification.code).toBe(
      "already_consumed",
    );
  });
});
