import { beforeEach, describe, expect, mock, test } from "bun:test";

/**
 * The two halves of run-policy assembly.
 *
 * The constraint being pinned here is the one that is easy to regress: nothing
 * that crosses a workflow step boundary may be a `RegExp`, a function, or an
 * import of the agent package. `resolveRunPolicy` returns two strings;
 * `buildRunPolicyOptions` is what turns them into objects, and it runs inside a
 * step.
 */

let resolution: unknown = {
  sessionId: "session-1",
  posture: "strict",
  requestedPosture: "strict",
  postureDowngraded: false,
  profile: "default",
};
let resolveError: Error | null = null;

mock.module("@/lib/policy/session-policy", () => ({
  resolveSessionPolicy: async () => {
    if (resolveError) {
      throw resolveError;
    }
    return resolution;
  },
}));

mock.module("@/lib/policy/policy-event-recorder", () => ({
  createPolicyEventRecorder: (scope: unknown) => ({
    scope,
    record: () => undefined,
  }),
}));

mock.module("@/lib/policy/approval-gate", () => ({
  createApprovalGate: (scope: unknown) => ({
    scope,
    request: async () => undefined,
    verify: async () => ({ authorized: true }),
  }),
}));

const { buildRunPolicyOptions, resolveRunPolicy } =
  await import("./chat-run-policy");

beforeEach(() => {
  resolveError = null;
  resolution = {
    sessionId: "session-1",
    posture: "strict",
    requestedPosture: "strict",
    postureDowngraded: false,
    profile: "default",
  };
});

describe("resolveRunPolicy", () => {
  test("returns only step-serializable values", async () => {
    const selection = await resolveRunPolicy({
      sessionId: "session-1",
      workflowRunId: "run-1",
    });

    expect(selection).toEqual({ posture: "strict", profile: "default" });
    // Nothing here may be a RegExp, a function, or an agent-package import:
    // the value crosses a workflow step boundary.
    expect(JSON.stringify(selection)).toBe(
      '{"posture":"strict","profile":"default"}',
    );
  });

  test("falls back to the baseline under auto when the session cannot be read", async () => {
    resolveError = new Error("no such session");

    expect(
      await resolveRunPolicy({ sessionId: "gone", workflowRunId: "run-1" }),
    ).toEqual({ posture: "auto", profile: "default" });
  });
});

describe("buildRunPolicyOptions", () => {
  test("materializes the posture, the policy, the recorder and the gate", async () => {
    const options = await buildRunPolicyOptions({
      selection: { posture: "strict", profile: "default" },
      sessionId: "session-1",
      chatId: "chat-1",
      workflowRunId: "run-1",
    });

    expect(options.posture).toBe("strict");
    expect(options.policy?.id).toBe("default");
    expect(typeof options.policyEventRecorder?.record).toBe("function");
    expect(typeof options.approvalGate?.verify).toBe("function");
  });

  test("the read-only profile resolves to the read-only policy", async () => {
    const options = await buildRunPolicyOptions({
      selection: { posture: "auto", profile: "read-only" },
      sessionId: "session-1",
      chatId: "chat-1",
      workflowRunId: "run-1",
    });

    expect(options.policy?.id).toBe("default.read-only");
  });

  test("the recorder and the gate are scoped to the session and run", async () => {
    const options = await buildRunPolicyOptions({
      selection: { posture: "auto", profile: "default" },
      sessionId: "session-1",
      chatId: "chat-1",
      workflowRunId: "run-1",
    });

    expect(
      (options.policyEventRecorder as unknown as { scope: unknown }).scope,
    ).toEqual({ sessionId: "session-1", workflowRunId: "run-1" });
    expect(
      (options.approvalGate as unknown as { scope: unknown }).scope,
    ).toEqual({
      sessionId: "session-1",
      chatId: "chat-1",
      workflowRunId: "run-1",
    });
  });
});
