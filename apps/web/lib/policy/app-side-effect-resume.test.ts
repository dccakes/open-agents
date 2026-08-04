import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { WebAgentUIMessage } from "@/app/types";

/**
 * Pause → hibernate → restart → grant → execute, with the real modules.
 *
 * This is the scenario the spec calls out: an approval granted two hours after
 * it was requested, by which time the session's sandbox is gone. Nothing here
 * is new machinery — the workflow *ends* when it pauses rather than parking, so
 * resuming has always meant going back through provisioning — and the test
 * exists to prove that the application-side-effect path really lands on that
 * same path rather than on a shortcut of its own.
 *
 * Faked: the database, the sandbox process, the GitHub side effects, and the
 * caller's identity. Real: approval creation, the decision, the single-use
 * compare-and-set, the plan recovery, `getReadySessionSandbox`, and the
 * execution's ordering.
 */

type Row = Record<string, unknown>;

const NOW = new Date("2026-08-03T12:00:00Z");
const TWO_HOURS = 2 * 60 * 60 * 1000;

/** Outlives the simulated restart, exactly as a database would. */
const approvalStore: { rows: Row[] } = { rows: [] };

let sessionSandboxState: Row | null = null;
let provisioningKicks = 0;
const commitCalls: Row[] = [];
const prCalls: Row[] = [];
const connectedStates: unknown[] = [];
let storedMessage: WebAgentUIMessage | null = null;
const persistedMessages: WebAgentUIMessage[] = [];

function isSpendable(row: Row, now: Date): boolean {
  return (
    row.decision === "approved" &&
    row.consumedAt === null &&
    (row.expiresAt as Date).getTime() > now.getTime()
  );
}

function isDecidable(row: Row, now: Date): boolean {
  return (
    row.decision === "pending" &&
    row.consumedAt === null &&
    (row.expiresAt as Date).getTime() > now.getTime()
  );
}

mock.module("@/lib/db/client", () => ({
  db: {
    insert: () => ({
      values: (values: Row) => ({
        onConflictDoNothing: () => ({
          returning: () => {
            approvalStore.rows.push(values);
            return Promise.resolve([values]);
          },
        }),
      }),
    }),
    select: () => ({
      from: () => ({
        where: () => {
          const rows = approvalStore.rows;
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
    // Stands in for the conditional UPDATE. The two writers are told apart by
    // what they set, and each only matches a row in the state its real SQL
    // condition requires — which is the property under test for single use.
    update: () => ({
      set: (values: Row) => ({
        where: () => ({
          returning: () => {
            const row = approvalStore.rows[0];
            if (!row) {
              return Promise.resolve([]);
            }

            const spending = "consumedAt" in values;
            const now = (
              spending ? values.consumedAt : values.decidedAt
            ) as Date;

            const matches = spending
              ? isSpendable(row, now)
              : isDecidable(row, now);
            if (!matches) {
              return Promise.resolve([]);
            }

            Object.assign(row, values);
            return Promise.resolve([row]);
          },
        }),
      }),
    }),
  },
}));

mock.module("@/lib/policy/policy-events", () => ({
  recordPolicyEvent: () => Promise.resolve(),
}));

mock.module("@/lib/policy/session-access", () => ({
  requireSessionActor: () =>
    Promise.resolve({
      userId: "user-1",
      organizationId: "org-1",
      role: "owner",
      session: {
        id: "session-1",
        userId: "user-1",
        title: "My session",
        posture: "strict",
        status: "active",
        sandboxState: sessionSandboxState,
      },
    }),
}));

mock.module("@/lib/db/sessions", () => ({
  getSessionById: () =>
    Promise.resolve({
      id: "session-1",
      userId: "user-1",
      title: "My session",
      status: "active",
      sandboxState: sessionSandboxState,
      lifecycleError: null,
    }),
  getChatMessageByIdForChat: () =>
    Promise.resolve(storedMessage ? { parts: storedMessage } : undefined),
  upsertChatMessageScoped: (data: Row) => {
    storedMessage = data.parts as WebAgentUIMessage;
    persistedMessages.push(storedMessage);
    return Promise.resolve({ status: "updated", message: data });
  },
}));

mock.module("@/lib/sandbox/provisioning-kick", () => ({
  kickSandboxProvisioningWorkflow: () => {
    provisioningKicks += 1;
    return Promise.resolve({ status: "started", runId: "run-provision-1" });
  },
  waitForSandboxProvisioningRun: () => {
    // What provisioning does: the session ends up with a live sandbox again.
    sessionSandboxState = {
      type: "vercel",
      sandboxName: "session_session-1",
    };
    return Promise.resolve(undefined);
  },
}));

mock.module("@/lib/sandbox/utils", () => ({
  isSandboxActive: (state: unknown) =>
    typeof state === "object" && state !== null && "sandboxName" in state,
}));

mock.module("@open-agents/sandbox", () => ({
  connectSandbox: (state: unknown) => {
    if (!state) {
      throw new Error("no sandbox to connect to");
    }
    connectedStates.push(state);
    return Promise.resolve({ workingDirectory: "/vercel/sandbox" });
  },
}));

mock.module("@/lib/chat/auto-commit-direct", () => ({
  performAutoCommit: (params: Row) => {
    commitCalls.push(params);
    return Promise.resolve({
      committed: true,
      pushed: true,
      commitMessage: "feat: change",
      commitSha: "abc1234",
    });
  },
}));

mock.module("@/lib/chat/auto-pr-direct", () => ({
  performAutoCreatePr: (params: Row) => {
    prCalls.push(params);
    return Promise.resolve({
      created: true,
      syncedExisting: false,
      skipped: false,
      prNumber: 7,
      prUrl: "https://github.com/acme/repo/pull/7",
    });
  },
}));

/** A cache-busting import, standing in for a cold module registry. */
async function importAfterRestart(restartId: string) {
  return {
    request: (await import(
      `./app-side-effect-approvals?restart=${restartId}`
    )) as typeof import("./app-side-effect-approvals"),
    decisions: (await import(
      `./approval-decisions?restart=${restartId}`
    )) as typeof import("./approval-decisions"),
    execution: (await import(
      `./app-side-effect-execution?restart=${restartId}`
    )) as typeof import("./app-side-effect-execution"),
  };
}

function pendingMessage(approvalId: string): WebAgentUIMessage {
  return {
    id: "assistant-1",
    role: "assistant",
    parts: [
      { type: "text", text: "All done." },
      {
        type: "data-approval-request",
        id: "assistant-1:approval",
        data: {
          approvalId,
          tool: "app.git-automation",
          operation: "Commit and push this session's changes to acme/repo.",
          rule: "app.side-effect.git-push",
          posture: "strict",
          status: "pending",
        },
      },
    ],
  };
}

beforeEach(() => {
  approvalStore.rows = [];
  sessionSandboxState = { type: "vercel", sandboxName: "session_session-1" };
  provisioningKicks = 0;
  commitCalls.length = 0;
  prCalls.length = 0;
  connectedStates.length = 0;
  storedMessage = null;
  persistedMessages.length = 0;
});

async function pauseUnderStrict(restartId: string) {
  const modules = await importAfterRestart(restartId);
  const paused = await modules.request.requestAppSideEffectApproval({
    sessionId: "session-1",
    chatId: "chat-1",
    workflowRunId: "run-1",
    messageId: "assistant-1",
    operations: ["auto-commit", "auto-create-pr"],
    repoOwner: "acme",
    repoName: "repo",
    posture: "strict",
    now: NOW,
  });
  storedMessage = pendingMessage(paused.approvalId);
  return paused;
}

describe("an approval granted after the sandbox hibernated", () => {
  test("reprovisions the workspace and then performs the operation", async () => {
    const paused = await pauseUnderStrict("a");
    expect(paused.decision).toBe("pending");
    expect(commitCalls).toEqual([]);

    // Two hours pass. The sandbox is torn down and the process restarts.
    sessionSandboxState = null;
    const later = new Date(NOW.getTime() + TWO_HOURS);
    const after = await importAfterRestart("b");

    await after.decisions.decideApproval({
      sessionId: "session-1",
      approvalId: paused.approvalId,
      decision: "approved",
      now: later,
    });

    const executed = await after.execution.executeAppSideEffect({
      sessionId: "session-1",
      approvalId: paused.approvalId,
      now: later,
    });

    expect(provisioningKicks).toBe(1);
    expect(connectedStates).toHaveLength(1);
    expect(executed.status).toBe("executed");
    expect(commitCalls).toHaveLength(1);
    expect(prCalls).toHaveLength(1);
  });

  test("reports the outcome on the run's message, which outlived the run", async () => {
    const paused = await pauseUnderStrict("c");
    sessionSandboxState = null;
    const later = new Date(NOW.getTime() + TWO_HOURS);
    const after = await importAfterRestart("d");

    await after.decisions.decideApproval({
      sessionId: "session-1",
      approvalId: paused.approvalId,
      decision: "approved",
      now: later,
    });
    await after.execution.executeAppSideEffect({
      sessionId: "session-1",
      approvalId: paused.approvalId,
      now: later,
    });

    const message = persistedMessages.at(-1);
    expect(
      message?.parts.find((part) => part.type === "data-approval-request"),
    ).toMatchObject({ data: { status: "executed" } });
    expect(
      message?.parts.find((part) => part.type === "data-commit"),
    ).toMatchObject({ data: { status: "success", pushed: true } });
  });

  /** Single use, across the same restart boundary. */
  test("a replayed execution pushes nothing a second time", async () => {
    const paused = await pauseUnderStrict("e");
    const later = new Date(NOW.getTime() + TWO_HOURS);
    const after = await importAfterRestart("f");

    await after.decisions.decideApproval({
      sessionId: "session-1",
      approvalId: paused.approvalId,
      decision: "approved",
      now: later,
    });
    await after.execution.executeAppSideEffect({
      sessionId: "session-1",
      approvalId: paused.approvalId,
      now: later,
    });

    await expect(
      after.execution.executeAppSideEffect({
        sessionId: "session-1",
        approvalId: paused.approvalId,
        now: later,
      }),
    ).rejects.toMatchObject({ name: "ApprovalError" });

    expect(commitCalls).toHaveLength(1);
    expect(prCalls).toHaveLength(1);
  });

  test("denying it pushes nothing and says the run skipped it by policy", async () => {
    const paused = await pauseUnderStrict("g");
    const later = new Date(NOW.getTime() + TWO_HOURS);
    const after = await importAfterRestart("h");

    await after.decisions.decideApproval({
      sessionId: "session-1",
      approvalId: paused.approvalId,
      decision: "denied",
      now: later,
    });

    const result = await after.execution.executeAppSideEffect({
      sessionId: "session-1",
      approvalId: paused.approvalId,
      now: later,
    });

    expect(result.status).toBe("skipped");
    expect(result.detail.toLowerCase()).toContain("skipped by policy");
    expect(commitCalls).toEqual([]);
    expect(prCalls).toEqual([]);
    expect(provisioningKicks).toBe(0);
    expect(
      persistedMessages
        .at(-1)
        ?.parts.find((part) => part.type === "data-approval-request"),
    ).toMatchObject({ data: { status: "skipped" } });
  });
});
