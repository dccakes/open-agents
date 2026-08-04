import { beforeEach, describe, expect, mock, test } from "bun:test";
import type {
  AgentPolicyContext,
  ApprovalGate,
  ApprovalGateRequest,
} from "../policy";
import { defaultCommandPolicy } from "../policy";

/**
 * Execute-time approval verification, observed through the real tools.
 *
 * The agent package cannot reach a database, so the record itself lives in the
 * host. What is asserted here is the seam: a policy `ask` requests a record
 * before pausing, `execute` spends one before doing anything, and a refusal
 * comes back as a tool result rather than as an execution.
 */

const execCalls: string[] = [];

const fakeSandbox = {
  workingDirectory: "/repo",
  exec: async (command: string) => {
    execCalls.push(command);
    return {
      success: true,
      exitCode: 0,
      stdout: "ok",
      stderr: "",
      truncated: false,
    };
  },
  execDetached: async (command: string) => {
    execCalls.push(command);
    return { commandId: "cmd-1" };
  },
  writeFile: async () => undefined,
  readFile: async () => "existing content",
  mkdir: async () => undefined,
  stat: async () => ({ size: 4, isDirectory: () => false }),
};

mock.module("@open-agents/sandbox", () => ({
  connectSandbox: async () => fakeSandbox,
}));

const { bashTool } = await import("./bash");

const requested: ApprovalGateRequest[] = [];
const verified: ApprovalGateRequest[] = [];

function gate(overrides: Partial<ApprovalGate> = {}): ApprovalGate {
  return {
    request: async (request) => {
      requested.push(request);
    },
    verify: async (request) => {
      verified.push(request);
      return { authorized: true };
    },
    ...overrides,
  };
}

function contextWith(policy: AgentPolicyContext): Record<string, unknown> {
  return {
    sandbox: {
      state: { type: "vercel", sandboxId: "sbx-1" },
      workingDirectory: "/repo",
    },
    model: "test-model",
    policy,
  };
}

function policyContext(
  overrides: Partial<AgentPolicyContext> = {},
): AgentPolicyContext {
  return {
    policy: defaultCommandPolicy,
    posture: "auto",
    approvalGate: gate(),
    ...overrides,
  };
}

function options(experimental_context: unknown, toolCallId = "call-1") {
  return { toolCallId, messages: [], experimental_context };
}

async function needsApproval(
  tool: { needsApproval?: unknown },
  args: { command: string },
  experimental_context: unknown,
  toolCallId = "call-1",
): Promise<boolean> {
  const hook = tool.needsApproval;
  if (typeof hook === "function") {
    return await Promise.resolve(
      (hook as (a: unknown, o: unknown) => boolean | Promise<boolean>)(
        args,
        options(experimental_context, toolCallId),
      ),
    );
  }
  return hook === true;
}

function isRefusal(value: unknown): value is {
  refusedByPolicy: true;
  error: string;
  policy: { decision: string; reason: string };
} {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { refusedByPolicy?: unknown }).refusedByPolicy === true
  );
}

beforeEach(() => {
  execCalls.length = 0;
  requested.length = 0;
  verified.length = 0;
});

describe("approval requests", () => {
  test("a policy ask requests a record for its own tool call id", async () => {
    const paused = await needsApproval(
      bashTool(),
      { command: "git push" },
      contextWith(policyContext()),
      "call-push",
    );

    expect(paused).toBe(true);
    expect(requested).toEqual([
      expect.objectContaining({ toolName: "bash", toolCallId: "call-push" }),
    ]);
  });

  test("an allowed call requests nothing", async () => {
    const paused = await needsApproval(
      bashTool(),
      { command: "ls -la" },
      contextWith(policyContext()),
    );

    expect(paused).toBe(false);
    expect(requested).toHaveLength(0);
  });

  test("a failed request still pauses, so nothing runs unrecorded", async () => {
    const paused = await needsApproval(
      bashTool(),
      { command: "git push" },
      contextWith(
        policyContext({
          approvalGate: gate({
            request: async () => {
              throw new Error("database unavailable");
            },
          }),
        }),
      ),
    );

    expect(paused).toBe(true);
  });
});

describe("execute-time verification", () => {
  test("an approved record lets the command run", async () => {
    const result = await bashTool().execute?.(
      { command: "git push" },
      options(contextWith(policyContext()), "call-push"),
    );

    expect(isRefusal(result)).toBe(false);
    expect(execCalls).toEqual(["git push"]);
    expect(verified).toEqual([
      expect.objectContaining({ toolName: "bash", toolCallId: "call-push" }),
    ]);
  });

  test("a missing record refuses and never reaches the sandbox", async () => {
    const result = await bashTool().execute?.(
      { command: "git push" },
      options(
        contextWith(
          policyContext({
            approvalGate: gate({
              verify: async () => ({
                authorized: false,
                code: "no_approval_record",
                message: "No approval was ever requested for this call.",
              }),
            }),
          }),
        ),
        "call-push",
      ),
    );

    expect(isRefusal(result)).toBe(true);
    if (isRefusal(result)) {
      expect(result.policy.decision).toBe("approval-not-verified");
      expect(result.error).toContain("No approval was ever requested");
    }
    expect(execCalls).toHaveLength(0);
  });

  test("a gate that throws fails closed", async () => {
    const result = await bashTool().execute?.(
      { command: "git push" },
      options(
        contextWith(
          policyContext({
            approvalGate: gate({
              verify: async () => {
                throw new Error("database unavailable");
              },
            }),
          }),
        ),
      ),
    );

    expect(isRefusal(result)).toBe(true);
    expect(execCalls).toHaveLength(0);
  });

  test("an allowed command is never verified", async () => {
    await bashTool().execute?.(
      { command: "ls -la" },
      options(contextWith(policyContext())),
    );

    expect(verified).toHaveLength(0);
    expect(execCalls).toEqual(["ls -la"]);
  });

  /**
   * A missing gate used to authorize. That made "an `ask` is backed by a
   * server-side record" a property of one call site rather than of the
   * enforcement point: an entry point that supplied `policy` but forgot
   * `approvalGate` degraded every `ask` back to the client-asserted flow with
   * nothing failing. It now fails the same way a missing policy does.
   */
  test("an interactive ask with no gate wired refuses rather than proceeding", async () => {
    const result = await bashTool().execute?.(
      { command: "git push" },
      options(
        contextWith(policyContext({ approvalGate: undefined })),
        "call-push",
      ),
    );

    expect(isRefusal(result)).toBe(true);
    if (isRefusal(result)) {
      expect(result.policy.decision).toBe("approval-not-verified");
      expect(result.error).toContain("wiring error");
    }
    expect(execCalls).toEqual([]);
  });

  test("a call the policy allows still runs with no gate wired", async () => {
    // The refusal is scoped to `ask`: an unwired gate must not brick an agent
    // whose commands are allowed outright.
    const result = await bashTool().execute?.(
      { command: "ls -la" },
      options(contextWith(policyContext({ approvalGate: undefined }))),
    );

    expect(isRefusal(result)).toBe(false);
    expect(execCalls).toEqual(["ls -la"]);
  });

  test("legacy pauses that are not policy asks need no record", async () => {
    const { enforcePolicyWithApproval, requestPolicyApproval } =
      await import("./policy-enforcement");
    const context = contextWith(policyContext());

    // `web_fetch` pauses unconditionally via `needsApproval: true`, and the
    // dotenv write pause is a tool-local rule. Neither is a policy `ask`, so
    // neither may start requiring an approval row.
    for (const call of [
      { toolName: "web_fetch", target: "https://example.com" },
      { toolName: "write", target: ".env" },
      { toolName: "ask_user_question", target: "" },
    ]) {
      expect(await requestPolicyApproval(context, call, "call-legacy")).toBe(
        false,
      );
      expect(
        await enforcePolicyWithApproval(context, call, "call-legacy"),
      ).toBeNull();
    }

    expect(requested).toHaveLength(0);
    expect(verified).toHaveLength(0);
  });

  test("a denied command is refused before any approval is verified", async () => {
    const result = await bashTool().execute?.(
      { command: "rm -rf /" },
      options(contextWith(policyContext())),
    );

    expect(isRefusal(result)).toBe(true);
    if (isRefusal(result)) {
      expect(result.policy.decision).toBe("deny");
    }
    expect(verified).toHaveLength(0);
  });
});
