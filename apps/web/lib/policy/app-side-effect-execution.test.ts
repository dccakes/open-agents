import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { WebAgentUIMessage } from "@/app/types";

type Row = Record<string, unknown>;

const NOW = new Date("2026-08-03T12:00:00Z");
const HOUR = 60 * 60 * 1000;

// ── Spy state ──────────────────────────────────────────────────────

let approvalRow: Row | null = null;
let consumeResult: Row = { authorized: true, approvalId: "approval-1" };
let actorThrows: Error | null = null;

const commitCalls: Row[] = [];
const prCalls: Row[] = [];
const readySandboxCalls: Row[] = [];
const connectCalls: unknown[] = [];
const upserts: Row[] = [];

let commitResult: Row = {
  committed: true,
  pushed: true,
  commitMessage: "feat: change",
  commitSha: "abc1234",
};
let prResult: Row = {
  created: true,
  syncedExisting: false,
  skipped: false,
  prNumber: 7,
  prUrl: "https://github.com/acme/repo/pull/7",
};
/** The sandbox this session had when the approval was requested. */
let sandboxIsActive = true;
let storedMessage: WebAgentUIMessage | null = null;

function approval(overrides: Row = {}): Row {
  return {
    id: "approval-1",
    sessionId: "session-1",
    chatId: "chat-1",
    workflowRunId: "run-1",
    kind: "app-side-effect",
    toolName: "app.git-automation",
    toolCallId: null,
    inputSummary: {
      operations: ["auto-commit", "auto-create-pr"],
      repoOwner: "acme",
      repoName: "repo",
      messageId: "assistant-1",
      rule: "app.side-effect.git-push",
      posture: "strict",
      operation: "Commit and push this session's changes to acme/repo.",
    },
    decision: "approved",
    decidedBy: "user-1",
    consumedAt: null,
    expiresAt: new Date(NOW.getTime() + HOUR),
    createdAt: new Date(NOW.getTime() - HOUR),
    decidedAt: new Date(NOW.getTime() - 60_000),
    ...overrides,
  };
}

function pendingMessage(): WebAgentUIMessage {
  return {
    id: "assistant-1",
    role: "assistant",
    parts: [
      { type: "text", text: "All done." },
      {
        type: "data-approval-request",
        id: "assistant-1:approval",
        data: {
          approvalId: "approval-1",
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

// ── Module mocks ───────────────────────────────────────────────────

mock.module("@/lib/policy/session-access", () => ({
  requireSessionActor: async () => {
    if (actorThrows) {
      throw actorThrows;
    }
    return await Promise.resolve({
      userId: "user-1",
      organizationId: "org-1",
      role: "member",
      session: { id: "session-1", userId: "user-1", title: "My session" },
    });
  },
}));

mock.module("@/lib/policy/approvals", () => ({
  getApprovalForSession: () => Promise.resolve(approvalRow),
  // Unused here, but `app-side-effect-approvals` imports them and this mock
  // replaces the whole module.
  getAppSideEffectApproval: () => Promise.resolve(null),
  createApproval: () => Promise.reject(new Error("not expected")),
}));

mock.module("@/lib/policy/approval-enforcement", () => ({
  consumeAppSideEffectApproval: () => Promise.resolve(consumeResult),
}));

mock.module("@/lib/sandbox/ready-sandbox", () => ({
  getReadySessionSandbox: (params: Row) => {
    readySandboxCalls.push(params);
    // The real path reprovisions a hibernated sandbox before returning.
    const didSetupWorkspace = !sandboxIsActive;
    sandboxIsActive = true;
    return Promise.resolve({
      session: {
        id: "session-1",
        userId: "user-1",
        title: "My session",
        sandboxState: { type: "vercel", sandboxName: "session_session-1" },
      },
      didSetupWorkspace,
    });
  },
}));

mock.module("@open-agents/sandbox", () => ({
  connectSandbox: (state: unknown) => {
    if (!sandboxIsActive) {
      throw new Error("sandbox is hibernated");
    }
    connectCalls.push(state);
    return Promise.resolve({ workingDirectory: "/vercel/sandbox" });
  },
}));

mock.module("@/lib/chat/auto-commit-direct", () => ({
  performAutoCommit: (params: Row) => {
    commitCalls.push(params);
    return Promise.resolve(commitResult);
  },
}));

mock.module("@/lib/chat/auto-pr-direct", () => ({
  performAutoCreatePr: (params: Row) => {
    prCalls.push(params);
    return Promise.resolve(prResult);
  },
}));

mock.module("@/lib/db/sessions", () => ({
  getChatMessageByIdForChat: () =>
    Promise.resolve(storedMessage ? { parts: storedMessage } : undefined),
  upsertChatMessageScoped: (data: Row) => {
    upserts.push(data);
    return Promise.resolve({ status: "updated", message: data });
  },
}));

const modulePromise = import("@/lib/policy/app-side-effect-execution");

beforeEach(() => {
  approvalRow = approval();
  consumeResult = { authorized: true, approvalId: "approval-1" };
  actorThrows = null;
  commitCalls.length = 0;
  prCalls.length = 0;
  readySandboxCalls.length = 0;
  connectCalls.length = 0;
  upserts.length = 0;
  commitResult = {
    committed: true,
    pushed: true,
    commitMessage: "feat: change",
    commitSha: "abc1234",
  };
  prResult = {
    created: true,
    syncedExisting: false,
    skipped: false,
    prNumber: 7,
    prUrl: "https://github.com/acme/repo/pull/7",
  };
  sandboxIsActive = true;
  storedMessage = pendingMessage();
});

/** The message as it was last written back. */
function lastPersistedMessage(): WebAgentUIMessage {
  const last = upserts.at(-1);
  if (!last) {
    throw new Error("nothing was persisted");
  }
  return last.parts as WebAgentUIMessage;
}

describe("executeAppSideEffect — granted", () => {
  test("performs the commit the run was not allowed to perform", async () => {
    const { executeAppSideEffect } = await modulePromise;

    const result = await executeAppSideEffect({
      sessionId: "session-1",
      approvalId: "approval-1",
      now: NOW,
    });

    expect(commitCalls).toHaveLength(1);
    expect(commitCalls[0]).toMatchObject({
      userId: "user-1",
      sessionId: "session-1",
      repoOwner: "acme",
      repoName: "repo",
    });
    expect(result.status).toBe("executed");
  });

  test("creates the pull request after the commit that pushed", async () => {
    const { executeAppSideEffect } = await modulePromise;

    const result = await executeAppSideEffect({
      sessionId: "session-1",
      approvalId: "approval-1",
      now: NOW,
    });

    expect(prCalls).toHaveLength(1);
    expect(result.status === "executed" && result.pr).toMatchObject({
      status: "success",
      prNumber: 7,
    });
  });

  test("spends the approval before anything reaches GitHub", async () => {
    consumeResult = {
      authorized: false,
      code: "already_consumed",
      message: "already spent",
      approvalId: "approval-1",
    };
    const { executeAppSideEffect } = await modulePromise;

    await expect(
      executeAppSideEffect({
        sessionId: "session-1",
        approvalId: "approval-1",
        now: NOW,
      }),
    ).rejects.toMatchObject({ name: "ApprovalError" });

    expect(commitCalls).toEqual([]);
    expect(prCalls).toEqual([]);
  });

  test("resolves the pending part on the run and records the commit", async () => {
    const { executeAppSideEffect } = await modulePromise;

    await executeAppSideEffect({
      sessionId: "session-1",
      approvalId: "approval-1",
      now: NOW,
    });

    const message = lastPersistedMessage();
    expect(
      message.parts.find((part) => part.type === "data-approval-request"),
    ).toMatchObject({ data: { status: "executed" } });
    expect(
      message.parts.find((part) => part.type === "data-commit"),
    ).toMatchObject({
      data: { status: "success", committed: true, pushed: true },
    });
  });

  test("skips the pull request when the commit failed, saying why", async () => {
    commitResult = { committed: false, pushed: false, error: "push rejected" };
    const { executeAppSideEffect } = await modulePromise;

    const result = await executeAppSideEffect({
      sessionId: "session-1",
      approvalId: "approval-1",
      now: NOW,
    });

    expect(prCalls).toEqual([]);
    expect(result.status === "executed" && result.pr).toMatchObject({
      status: "skipped",
      skipReason: "push rejected",
    });
  });

  test("opens the pull request without committing when there was nothing to commit", async () => {
    approvalRow = approval({
      inputSummary: {
        operations: ["auto-create-pr"],
        repoOwner: "acme",
        repoName: "repo",
        messageId: "assistant-1",
      },
    });
    const { executeAppSideEffect } = await modulePromise;

    const result = await executeAppSideEffect({
      sessionId: "session-1",
      approvalId: "approval-1",
      now: NOW,
    });

    expect(commitCalls).toEqual([]);
    expect(prCalls).toHaveLength(1);
    expect(result.status === "executed" && result.commit).toBeUndefined();
  });
});

describe("executeAppSideEffect — sandbox hibernation", () => {
  /**
   * The workflow ends rather than parks when it pauses, so by the time the
   * approval is answered the sandbox may be long gone. This is the real
   * reprovisioning path, not a stub: `connectSandbox` throws while the sandbox
   * is hibernated, and only succeeds because provisioning ran first.
   */
  test("reprovisions a hibernated sandbox and then executes", async () => {
    sandboxIsActive = false;
    // Two hours later, well inside the 24-hour approval window.
    approvalRow = approval({ expiresAt: new Date(NOW.getTime() + 24 * HOUR) });
    const { executeAppSideEffect } = await modulePromise;

    const result = await executeAppSideEffect({
      sessionId: "session-1",
      approvalId: "approval-1",
      now: new Date(NOW.getTime() + 2 * HOUR),
    });

    expect(readySandboxCalls).toHaveLength(1);
    expect(connectCalls).toHaveLength(1);
    expect(result.status).toBe("executed");
    expect(commitCalls).toHaveLength(1);
  });

  test("asks for the sandbox before connecting to it", async () => {
    sandboxIsActive = false;
    const { executeAppSideEffect } = await modulePromise;

    await executeAppSideEffect({
      sessionId: "session-1",
      approvalId: "approval-1",
      now: NOW,
    });

    expect(readySandboxCalls[0]).toMatchObject({
      sessionId: "session-1",
      userId: "user-1",
    });
  });
});

describe("executeAppSideEffect — refused", () => {
  test("performs nothing when the approval was denied", async () => {
    approvalRow = approval({ decision: "denied", decidedAt: NOW });
    const { executeAppSideEffect } = await modulePromise;

    const result = await executeAppSideEffect({
      sessionId: "session-1",
      approvalId: "approval-1",
      now: NOW,
    });

    expect(result.status).toBe("skipped");
    expect(commitCalls).toEqual([]);
    expect(prCalls).toEqual([]);
    expect(readySandboxCalls).toEqual([]);
  });

  test("reports the refusal on the run as skipped by policy", async () => {
    approvalRow = approval({ decision: "denied", decidedAt: NOW });
    const { executeAppSideEffect } = await modulePromise;

    const result = await executeAppSideEffect({
      sessionId: "session-1",
      approvalId: "approval-1",
      now: NOW,
    });

    expect(result.detail.toLowerCase()).toContain("skipped by policy");
    const message = lastPersistedMessage();
    expect(
      message.parts.find((part) => part.type === "data-approval-request"),
    ).toMatchObject({ data: { status: "skipped" } });
    expect(
      message.parts.find((part) => part.type === "data-commit"),
    ).toMatchObject({ data: { status: "skipped", committed: false } });
  });

  test("treats an expired approval as a refusal without any job having run", async () => {
    approvalRow = approval({
      decision: "pending",
      expiresAt: new Date(NOW.getTime() - 1),
    });
    const { executeAppSideEffect } = await modulePromise;

    const result = await executeAppSideEffect({
      sessionId: "session-1",
      approvalId: "approval-1",
      now: NOW,
    });

    expect(result.status).toBe("skipped");
    expect(commitCalls).toEqual([]);
  });

  test("refuses to execute an approval nobody has answered yet", async () => {
    approvalRow = approval({ decision: "pending" });
    const { executeAppSideEffect } = await modulePromise;

    await expect(
      executeAppSideEffect({
        sessionId: "session-1",
        approvalId: "approval-1",
        now: NOW,
      }),
    ).rejects.toMatchObject({ name: "ApprovalError", kind: "invalid" });

    expect(commitCalls).toEqual([]);
  });
});

describe("executeAppSideEffect — authorization and integrity", () => {
  test("a caller who may not act on the session executes nothing", async () => {
    actorThrows = Object.assign(new Error("You may not act on this session."), {
      name: "AuthorizationError",
    });
    const { executeAppSideEffect } = await modulePromise;

    await expect(
      executeAppSideEffect({
        sessionId: "session-1",
        approvalId: "approval-1",
        now: NOW,
      }),
    ).rejects.toThrow("You may not act on this session.");

    expect(commitCalls).toEqual([]);
  });

  test("refuses an approval that belongs to a tool call, not a side effect", async () => {
    approvalRow = approval({ kind: "tool-call", toolCallId: "call-1" });
    const { executeAppSideEffect } = await modulePromise;

    await expect(
      executeAppSideEffect({
        sessionId: "session-1",
        approvalId: "approval-1",
        now: NOW,
      }),
    ).rejects.toMatchObject({ name: "ApprovalError" });
  });

  test("refuses when the stored plan no longer names a repository", async () => {
    approvalRow = approval({
      inputSummary: { operations: ["auto-commit"], messageId: "assistant-1" },
    });
    const { executeAppSideEffect } = await modulePromise;

    await expect(
      executeAppSideEffect({
        sessionId: "session-1",
        approvalId: "approval-1",
        now: NOW,
      }),
    ).rejects.toMatchObject({ name: "ApprovalError" });

    expect(commitCalls).toEqual([]);
  });

  test("still executes when the run's message can no longer be found", async () => {
    storedMessage = null;
    const { executeAppSideEffect } = await modulePromise;

    const result = await executeAppSideEffect({
      sessionId: "session-1",
      approvalId: "approval-1",
      now: NOW,
    });

    expect(result.status).toBe("executed");
    expect(upserts).toEqual([]);
  });
});
