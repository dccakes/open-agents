import { beforeEach, describe, expect, mock, test } from "bun:test";

type Row = Record<string, unknown>;

const NOW = new Date("2026-08-03T12:00:00Z");

let existingRow: Row | null = null;
let created: Row[] = [];
let policyEvents: Row[] = [];

mock.module("@/lib/policy/approvals", () => ({
  getAppSideEffectApproval: () => Promise.resolve(existingRow),
  createApproval: (input: Row) => {
    const row = {
      id: "approval-1",
      decision: "pending",
      consumedAt: null,
      decidedBy: null,
      decidedAt: null,
      expiresAt: new Date(NOW.getTime() + 86_400_000),
      createdAt: NOW,
      toolCallId: null,
      ...input,
      inputSummary: input.input,
    };
    created.push(row);
    return Promise.resolve(row);
  },
}));

mock.module("@/lib/policy/policy-events", () => ({
  recordPolicyEvent: (event: Row) => {
    policyEvents.push(event);
    return Promise.resolve();
  },
}));

const modulePromise = import("@/lib/policy/app-side-effect-approvals");

beforeEach(() => {
  existingRow = null;
  created = [];
  policyEvents = [];
});

function requestInput(overrides: Row = {}) {
  return {
    sessionId: "session-1",
    chatId: "chat-1",
    workflowRunId: "run-1",
    messageId: "assistant-1",
    operations: ["auto-commit", "auto-create-pr"] as const,
    repoOwner: "acme",
    repoName: "repo",
    posture: "strict" as const,
    now: NOW,
    ...overrides,
  };
}

describe("requestAppSideEffectApproval", () => {
  test("records a pending application-side-effect approval on the run", async () => {
    const { requestAppSideEffectApproval } = await modulePromise;

    const result = await requestAppSideEffectApproval(requestInput());

    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      sessionId: "session-1",
      chatId: "chat-1",
      workflowRunId: "run-1",
      kind: "app-side-effect",
      toolName: "app.git-automation",
    });
    expect(result.decision).toBe("pending");
    expect(result.approvalId).toBe("approval-1");
  });

  test("carries what the prompt has to show: operation, rule and posture", async () => {
    const { requestAppSideEffectApproval } = await modulePromise;

    const result = await requestAppSideEffectApproval(requestInput());

    expect(result.operation).toContain("acme/repo");
    expect(result.rule).toBe("app.side-effect.git-push");
    expect(result.posture).toBe("strict");
  });

  test("records the ask as a policy event", async () => {
    const { requestAppSideEffectApproval } = await modulePromise;

    await requestAppSideEffectApproval(requestInput());

    expect(policyEvents).toHaveLength(1);
    expect(policyEvents[0]).toMatchObject({
      sessionId: "session-1",
      workflowRunId: "run-1",
      decision: "ask",
      matchedRule: "app.side-effect.git-push",
      posture: "strict",
    });
  });

  /** A workflow step can be retried; a retry must not ask the user twice. */
  test("reuses the approval this run already requested", async () => {
    existingRow = {
      id: "approval-existing",
      sessionId: "session-1",
      chatId: "chat-1",
      workflowRunId: "run-1",
      kind: "app-side-effect",
      toolName: "app.git-automation",
      toolCallId: null,
      inputSummary: {
        operations: ["auto-commit"],
        repoOwner: "acme",
        repoName: "repo",
        messageId: "assistant-1",
        rule: "app.side-effect.git-push",
        posture: "strict",
        operation: "Commit and push this session's changes to acme/repo.",
      },
      decision: "pending",
      decidedBy: null,
      consumedAt: null,
      expiresAt: new Date(NOW.getTime() + 3600_000),
      createdAt: NOW,
      decidedAt: null,
    };
    const { requestAppSideEffectApproval } = await modulePromise;

    const result = await requestAppSideEffectApproval(requestInput());

    expect(created).toEqual([]);
    expect(policyEvents).toEqual([]);
    expect(result.approvalId).toBe("approval-existing");
  });

  test("reports an already-answered approval with its effective decision", async () => {
    existingRow = {
      id: "approval-existing",
      sessionId: "session-1",
      chatId: "chat-1",
      workflowRunId: "run-1",
      kind: "app-side-effect",
      toolName: "app.git-automation",
      toolCallId: null,
      inputSummary: { operations: ["auto-commit"] },
      decision: "pending",
      decidedBy: null,
      consumedAt: null,
      // Past its expiry, and expiry is a denial on read.
      expiresAt: new Date(NOW.getTime() - 1),
      createdAt: NOW,
      decidedAt: null,
    };
    const { requestAppSideEffectApproval } = await modulePromise;

    const result = await requestAppSideEffectApproval(requestInput());

    expect(result.decision).toBe("expired");
  });
});

describe("readAppSideEffectPlan", () => {
  test("recovers what has to be executed from the stored summary", async () => {
    const { readAppSideEffectPlan } = await modulePromise;

    const plan = readAppSideEffectPlan({
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
      },
      decision: "approved",
      decidedBy: "user-1",
      consumedAt: null,
      expiresAt: NOW,
      createdAt: NOW,
      decidedAt: NOW,
    });

    expect(plan).toEqual({
      approvalId: "approval-1",
      sessionId: "session-1",
      chatId: "chat-1",
      messageId: "assistant-1",
      operations: ["auto-commit", "auto-create-pr"],
      repoOwner: "acme",
      repoName: "repo",
    });
  });

  test("drops anything the summary does not actually contain", async () => {
    const { readAppSideEffectPlan } = await modulePromise;

    const plan = readAppSideEffectPlan({
      id: "approval-1",
      sessionId: "session-1",
      chatId: null,
      workflowRunId: null,
      kind: "app-side-effect",
      toolName: "app.git-automation",
      toolCallId: null,
      inputSummary: { operations: ["nonsense"] },
      decision: "approved",
      decidedBy: "user-1",
      consumedAt: null,
      expiresAt: NOW,
      createdAt: NOW,
      decidedAt: NOW,
    });

    expect(plan.operations).toEqual([]);
    expect(plan.repoOwner).toBeNull();
    expect(plan.messageId).toBeNull();
  });
});
