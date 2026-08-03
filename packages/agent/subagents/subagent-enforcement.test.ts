import { beforeEach, describe, expect, mock, test } from "bun:test";
import {
  type AgentPolicyContext,
  defaultCommandPolicy,
  resolvePolicyContext,
} from "../policy";

/**
 * Enforcement as a subagent actually experiences it: the policy context comes
 * out of the subagent's own `prepareCall`, and the bash tool it runs is the
 * same factory the main agent uses.
 */

const execCalls: string[] = [];

mock.module("@open-agents/sandbox", () => ({
  connectSandbox: async () => ({
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
  }),
}));

const { bashTool } = await import("../tools/bash");
const { SUBAGENT_REGISTRY } = await import("./registry");

const sessionPolicy: AgentPolicyContext = resolvePolicyContext({
  policy: defaultCommandPolicy,
  posture: "auto",
});

function subagentContext(type: "explorer" | "executor" | "design") {
  return SUBAGENT_REGISTRY[type].prepareCall({
    model: "parent-model" as never,
    options: {
      task: "task",
      instructions: "instructions",
      sandbox: { state: { type: "vercel" }, workingDirectory: "/repo" },
      model: "subagent-model" as never,
      policy: sessionPolicy,
    },
  }).experimental_context;
}

function mainAgentContext() {
  return {
    sandbox: { state: { type: "vercel" }, workingDirectory: "/repo" },
    model: "main-model",
    policy: sessionPolicy,
  };
}

function options(experimental_context: unknown) {
  return { toolCallId: "call-1", messages: [], experimental_context };
}

async function runBash(command: string, experimental_context: unknown) {
  return await bashTool().execute?.({ command }, options(experimental_context));
}

async function needsApproval(command: string, experimental_context: unknown) {
  const hook = bashTool().needsApproval;
  if (typeof hook !== "function") {
    throw new Error("bash tool must compute needsApproval");
  }
  return await Promise.resolve(
    hook({ command }, options(experimental_context)),
  );
}

function isRefusal(value: unknown): value is {
  error: string;
  policy: { decision: string; rule: string | null };
} {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { refusedByPolicy?: unknown }).refusedByPolicy === true
  );
}

beforeEach(() => {
  execCalls.length = 0;
});

describe("executor subagent", () => {
  test("is denied exactly what the main agent is denied", async () => {
    const command = "rm -rf /";

    const fromMain = await runBash(command, mainAgentContext());
    const fromExecutor = await runBash(command, subagentContext("executor"));

    expect(isRefusal(fromMain)).toBe(true);
    expect(isRefusal(fromExecutor)).toBe(true);
    if (isRefusal(fromMain) && isRefusal(fromExecutor)) {
      expect(fromExecutor.policy.rule).toBe(fromMain.policy.rule);
      expect(fromExecutor.policy.decision).toBe("deny");
    }
    expect(execCalls).toHaveLength(0);
  });

  test("turns an ask into a denial instead of pausing the parent", async () => {
    const command = "git push origin feature";

    // The parent would pause on this command...
    expect(await needsApproval(command, mainAgentContext())).toBe(true);

    // ...but the subagent has no approver, so it must not pause.
    expect(await needsApproval(command, subagentContext("executor"))).toBe(
      false,
    );

    const result = await runBash(command, subagentContext("executor"));
    expect(isRefusal(result)).toBe(true);
    if (isRefusal(result)) {
      expect(result.policy.decision).toBe("approval-unavailable");
      expect(result.error).toContain("approval");
    }
    expect(execCalls).toHaveLength(0);
  });

  test("the parent can retry the same command under a real approval", async () => {
    const command = "git push origin feature";

    // The parent's decision is unchanged by the subagent's denial.
    expect(await needsApproval(command, mainAgentContext())).toBe(true);

    // And once approved, the parent executes it: no deny rule matched.
    const result = await runBash(command, mainAgentContext());
    expect(isRefusal(result)).toBe(false);
    expect(execCalls).toEqual([command]);
  });

  test("still does ordinary work", async () => {
    const result = await runBash("bun run ci", subagentContext("executor"));

    expect(isRefusal(result)).toBe(false);
    expect(execCalls).toEqual(["bun run ci"]);
  });
});

describe("explorer subagent", () => {
  test("cannot write a file through a shell redirect", async () => {
    const result = await runBash(
      "echo 'x' > notes.txt",
      subagentContext("explorer"),
    );

    expect(isRefusal(result)).toBe(true);
    expect(execCalls).toHaveLength(0);
  });

  test("cannot edit a file in place", async () => {
    const result = await runBash(
      "sed -i 's/a/b/' src/index.ts",
      subagentContext("explorer"),
    );

    expect(isRefusal(result)).toBe(true);
    expect(execCalls).toHaveLength(0);
  });

  test("cannot install packages", async () => {
    for (const command of [
      "npm install left-pad",
      "bun add left-pad",
      "pip install requests",
    ]) {
      expect(
        isRefusal(await runBash(command, subagentContext("explorer"))),
      ).toBe(true);
    }

    expect(execCalls).toHaveLength(0);
  });

  test("cannot mutate the repository or reach the network", async () => {
    for (const command of [
      "git add .",
      "git commit -m 'x'",
      "git checkout -b feature",
      "mkdir new-dir",
      "touch new-file",
      "rm notes.txt",
      "mv a b",
      "curl https://example.com",
    ]) {
      expect(
        isRefusal(await runBash(command, subagentContext("explorer"))),
      ).toBe(true);
    }

    expect(execCalls).toHaveLength(0);
  });

  test("still runs its read-only commands", async () => {
    const commands = [
      "ls -la",
      "git status --short",
      "git log --oneline -5",
      "git diff HEAD~1",
      "cat package.json",
    ];

    for (const command of commands) {
      expect(
        isRefusal(await runBash(command, subagentContext("explorer"))),
      ).toBe(false);
    }

    expect(execCalls).toEqual(commands);
  });

  test("is denied even when the session posture is dangerous", async () => {
    const dangerous = SUBAGENT_REGISTRY.explorer.prepareCall({
      model: "parent-model" as never,
      options: {
        task: "task",
        instructions: "instructions",
        sandbox: { state: { type: "vercel" }, workingDirectory: "/repo" },
        model: "subagent-model" as never,
        policy: resolvePolicyContext({ posture: "dangerous" }),
      },
    }).experimental_context;

    expect(isRefusal(await runBash("echo 'x' > notes.txt", dangerous))).toBe(
      true,
    );
    expect(execCalls).toHaveLength(0);
  });
});
