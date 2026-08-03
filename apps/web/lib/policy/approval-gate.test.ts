import { beforeEach, describe, expect, mock, test } from "bun:test";

/**
 * The host half of the agent's approval seam.
 *
 * Everything asserted here is about wiring: that the request writes a
 * `tool-call` approval scoped to the run, that verification *spends* the
 * approval rather than merely reading it, and that a database failure becomes
 * a refusal instead of a grant.
 */

type CreateCall = Record<string, unknown>;
type ConsumeCall = { sessionId: string; toolCallId: string };

const createCalls: CreateCall[] = [];
const consumeCalls: ConsumeCall[] = [];
const verifyCalls: ConsumeCall[] = [];

let createBehaviour: () => unknown = () => ({ id: "approval-1" });
let consumeBehaviour: () => unknown = () => ({
  authorized: true,
  approvalId: "approval-1",
});

mock.module("@/lib/policy/approvals", () => ({
  createApproval: async (input: CreateCall) => {
    createCalls.push(input);
    return createBehaviour();
  },
}));

mock.module("@/lib/policy/approval-enforcement", () => ({
  consumeToolCallApproval: async (input: ConsumeCall) => {
    consumeCalls.push(input);
    return consumeBehaviour();
  },
  verifyToolCallApproval: async (input: ConsumeCall) => {
    verifyCalls.push(input);
    return consumeBehaviour();
  },
}));

const { createApprovalGate } = await import("@/lib/policy/approval-gate");

beforeEach(() => {
  createCalls.length = 0;
  consumeCalls.length = 0;
  verifyCalls.length = 0;
  createBehaviour = () => ({ id: "approval-1" });
  consumeBehaviour = () => ({ authorized: true, approvalId: "approval-1" });
});

function gate() {
  return createApprovalGate({
    sessionId: "session-1",
    chatId: "chat-1",
    workflowRunId: "run-1",
  });
}

describe("requesting", () => {
  test("writes a tool-call approval scoped to the session, chat and run", async () => {
    await gate().request({
      toolName: "bash",
      toolCallId: "call-1",
      inputSummary: "git push",
    });

    expect(createCalls).toEqual([
      expect.objectContaining({
        sessionId: "session-1",
        chatId: "chat-1",
        workflowRunId: "run-1",
        kind: "tool-call",
        toolName: "bash",
        toolCallId: "call-1",
      }),
    ]);
  });

  test("a write failure propagates rather than pretending to have recorded", async () => {
    createBehaviour = () => {
      throw new Error("database unavailable");
    };

    expect(
      gate().request({ toolName: "bash", toolCallId: "call-1" }),
    ).rejects.toThrow("database unavailable");
  });
});

describe("verifying", () => {
  test("spends the approval, so a second execution cannot reuse it", async () => {
    const decision = await gate().verify({
      toolName: "bash",
      toolCallId: "call-1",
    });

    expect(decision).toEqual({ authorized: true });
    expect(consumeCalls).toEqual([
      { sessionId: "session-1", toolCallId: "call-1" },
    ]);
    // A read would leave the approval spendable a second time.
    expect(verifyCalls).toHaveLength(0);
  });

  test("carries the refusal code and message back to the tool", async () => {
    consumeBehaviour = () => ({
      authorized: false,
      code: "already_consumed",
      message: "This approval has already authorized one execution.",
      approvalId: "approval-1",
    });

    expect(
      await gate().verify({ toolName: "bash", toolCallId: "call-1" }),
    ).toEqual({
      authorized: false,
      code: "already_consumed",
      message: "This approval has already authorized one execution.",
    });
  });

  test("a read failure refuses instead of authorizing", async () => {
    consumeBehaviour = () => {
      throw new Error("database unavailable");
    };

    const decision = await gate().verify({
      toolName: "bash",
      toolCallId: "call-1",
    });

    expect(decision.authorized).toBe(false);
    if (!decision.authorized) {
      expect(decision.code).toBe("unavailable");
    }
  });
});
