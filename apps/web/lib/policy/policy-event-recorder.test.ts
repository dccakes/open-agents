import type { PolicyEvent } from "@open-agents/agent";
import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { PolicyEventInput } from "@/lib/policy/policy-events";

let recorded: PolicyEventInput[] = [];
let recordShouldThrow = false;

mock.module("@/lib/policy/policy-events", () => ({
  recordPolicyEvent: async (input: PolicyEventInput) => {
    if (recordShouldThrow) {
      throw new Error("connection reset");
    }
    recorded.push(input);
    return await Promise.resolve();
  },
}));

const modulePromise = import("@/lib/policy/policy-event-recorder");

function agentEvent(overrides: Partial<PolicyEvent> = {}): PolicyEvent {
  return {
    toolName: "bash",
    phase: "execute",
    action: "deny",
    outcome: "deny",
    ruleId: "bash.deny.filesystem-destruction",
    reason: "Recursive, forced deletion of a root directory.",
    posture: "auto",
    interactive: true,
    inputSummary: "rm -rf /",
    matchedText: "rm -rf /",
    occurredAt: new Date("2026-08-03T12:00:00Z"),
    ...overrides,
  };
}

beforeEach(() => {
  recorded = [];
  recordShouldThrow = false;
});

describe("createPolicyEventRecorder", () => {
  test("attributes every event to the session and run it was created for", async () => {
    const { createPolicyEventRecorder } = await modulePromise;
    const recorder = createPolicyEventRecorder({
      sessionId: "session-1",
      workflowRunId: "run-1",
    });

    await recorder.record(agentEvent());

    expect(recorded[0]).toMatchObject({
      sessionId: "session-1",
      workflowRunId: "run-1",
      toolName: "bash",
      decision: "deny",
      matchedRule: "bash.deny.filesystem-destruction",
      posture: "auto",
    });
  });

  test("records an ask as an ask", async () => {
    const { createPolicyEventRecorder } = await modulePromise;
    const recorder = createPolicyEventRecorder({ sessionId: "session-1" });

    await recorder.record(
      agentEvent({
        action: "ask",
        outcome: "ask",
        ruleId: "bash.ask.git-push",
      }),
    );

    expect(recorded[0]?.decision).toBe("ask");
  });

  test("carries the reason, outcome, phase, and interactivity into the summary", async () => {
    const { createPolicyEventRecorder } = await modulePromise;
    const recorder = createPolicyEventRecorder({ sessionId: "session-1" });

    await recorder.record(
      agentEvent({ interactive: false, phase: "approval" }),
    );
    const summary = recorded[0]?.input as Record<string, unknown>;

    expect(summary).toMatchObject({
      outcome: "deny",
      phase: "approval",
      interactive: false,
      summary: "rm -rf /",
      matchedText: "rm -rf /",
    });
    expect(summary.reason).toContain("Recursive");
  });

  test("keeps a policy default's null rule id rather than inventing one", async () => {
    const { createPolicyEventRecorder } = await modulePromise;
    const recorder = createPolicyEventRecorder({ sessionId: "session-1" });

    await recorder.record(agentEvent({ ruleId: null, matchedText: null }));

    expect(recorded[0]?.matchedRule).toBeNull();
  });

  test("uses a null run id when the event was not raised inside a run", async () => {
    const { createPolicyEventRecorder } = await modulePromise;
    const recorder = createPolicyEventRecorder({ sessionId: "session-1" });

    await recorder.record(agentEvent());

    expect(recorded[0]?.workflowRunId).toBeNull();
  });

  /**
   * The agent package's contract: a recorder must not throw, because failing
   * to write an audit line must never change what a tool does.
   */
  test("swallows a write failure rather than changing what the tool does", async () => {
    recordShouldThrow = true;
    const { createPolicyEventRecorder } = await modulePromise;
    const recorder = createPolicyEventRecorder({ sessionId: "session-1" });

    await expect(recorder.record(agentEvent())).resolves.toBeUndefined();
  });
});
