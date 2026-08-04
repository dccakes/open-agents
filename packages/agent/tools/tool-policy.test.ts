import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { AgentPolicyContext, CommandPolicy } from "../policy";
import { defaultCommandPolicy, readOnlyPolicy } from "../policy";

/**
 * Policy enforcement as observed through the real tools.
 *
 * The sandbox is faked so that "a denied call never reaches the sandbox" is an
 * assertion about recorded calls rather than a hope.
 */

const execCalls: { command: string; cwd: string }[] = [];
const writeCalls: string[] = [];

const fakeSandbox = {
  workingDirectory: "/repo",
  exec: async (command: string, cwd: string) => {
    execCalls.push({ command, cwd });
    return {
      success: true,
      exitCode: 0,
      stdout: "ok",
      stderr: "",
      truncated: false,
    };
  },
  execDetached: async (command: string, cwd: string) => {
    execCalls.push({ command, cwd });
    return { commandId: "cmd-1" };
  },
  writeFile: async (filePath: string) => {
    writeCalls.push(filePath);
  },
  readFile: async () => "existing content",
  mkdir: async () => undefined,
  stat: async () => ({ size: 4, isDirectory: () => false }),
};

mock.module("@open-agents/sandbox", () => ({
  connectSandbox: async () => fakeSandbox,
}));

const { bashTool } = await import("./bash");
const { editFileTool, writeFileTool } = await import("./write");
const { webFetchTool } = await import("./fetch");
const { readFileTool } = await import("./read");

function contextWith(
  policy: AgentPolicyContext | undefined,
): Record<string, unknown> {
  return {
    sandbox: {
      state: { type: "vercel", sandboxId: "sbx-1" },
      workingDirectory: "/repo",
    },
    model: "test-model",
    ...(policy ? { policy } : {}),
  };
}

function policyContext(
  overrides: Partial<AgentPolicyContext> = {},
): AgentPolicyContext {
  return {
    policy: defaultCommandPolicy,
    posture: "auto",
    ...overrides,
  };
}

function options(experimental_context: unknown) {
  return { toolCallId: "call-1", messages: [], experimental_context };
}

async function needsApproval<TArgs>(
  tool: { needsApproval?: unknown },
  args: TArgs,
  experimental_context: unknown,
): Promise<boolean> {
  const hook = tool.needsApproval;
  if (typeof hook === "function") {
    return await Promise.resolve(
      (hook as (a: TArgs, o: unknown) => boolean | Promise<boolean>)(
        args,
        options(experimental_context),
      ),
    );
  }
  return hook === true;
}

function isRefusal(value: unknown): value is {
  success: false;
  refusedByPolicy: true;
  error: string;
  policy: { decision: string; rule: string | null; reason: string };
} {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { refusedByPolicy?: unknown }).refusedByPolicy === true
  );
}

beforeEach(() => {
  execCalls.length = 0;
  writeCalls.length = 0;
});

describe("bash policy enforcement", () => {
  test("returns a structured refusal for a denied command and never reaches the sandbox", async () => {
    const result = await bashTool().execute?.(
      { command: "rm -rf /" },
      options(contextWith(policyContext())),
    );

    expect(isRefusal(result)).toBe(true);
    if (isRefusal(result)) {
      expect(result.policy.decision).toBe("deny");
      expect(result.policy.rule).toBe("bash.deny.filesystem-destruction");
      expect(result.error).toContain("Reason:");
    }
    expect(execCalls).toHaveLength(0);
  });

  test("a denial is a tool result, not a thrown error", async () => {
    const run = bashTool().execute?.(
      { command: "rm -rf /" },
      options(contextWith(policyContext())),
    );

    await expect(run).resolves.toBeDefined();
  });

  test("refuses when no policy is wired", async () => {
    const result = await bashTool().execute?.(
      { command: "ls -la" },
      options(contextWith(undefined)),
    );

    expect(isRefusal(result)).toBe(true);
    if (isRefusal(result)) {
      expect(result.policy.decision).toBe("missing-policy");
    }
    expect(execCalls).toHaveLength(0);
  });

  test("does not pause when no policy is wired, since execute refuses anyway", async () => {
    // Pausing here would ask a human to authorise a call that is refused
    // either way, which is the same reason the policed path does not pause a
    // non-interactive `ask`.
    for (const command of ["ls -la", "rm -rf tmp", "cat .env.local"]) {
      expect(
        await needsApproval(bashTool(), { command }, contextWith(undefined)),
      ).toBe(false);
    }
  });

  test("refuses a detached denied command before starting a background process", async () => {
    const result = await bashTool().execute?.(
      { command: "rm -rf /", detached: true },
      options(contextWith(policyContext())),
    );

    expect(isRefusal(result)).toBe(true);
    expect(execCalls).toHaveLength(0);
  });

  test("runs an allowed command with exactly one sandbox round trip", async () => {
    const result = await bashTool().execute?.(
      { command: "ls -la" },
      options(contextWith(policyContext())),
    );

    expect(execCalls).toEqual([{ command: "ls -la", cwd: "/repo" }]);
    expect(result).toMatchObject({ success: true, stdout: "ok" });
  });

  test("refuses a cwd that escapes the workspace", async () => {
    const result = await bashTool().execute?.(
      { command: "ls -la", cwd: "/etc" },
      options(contextWith(policyContext())),
    );

    expect(isRefusal(result)).toBe(true);
    expect(execCalls).toHaveLength(0);
  });

  test("refuses a relative cwd that traverses out of the workspace", async () => {
    const result = await bashTool().execute?.(
      { command: "ls -la", cwd: "../../etc" },
      options(contextWith(policyContext())),
    );

    expect(isRefusal(result)).toBe(true);
    expect(execCalls).toHaveLength(0);
  });

  test("accepts a workspace-relative cwd", async () => {
    await bashTool().execute?.(
      { command: "ls -la", cwd: "apps/web" },
      options(contextWith(policyContext())),
    );

    expect(execCalls).toEqual([{ command: "ls -la", cwd: "/repo/apps/web" }]);
  });

  test("re-evaluates policy at execute time, so a rule added after approval is honoured", async () => {
    const tightened: CommandPolicy = {
      ...defaultCommandPolicy,
      deny: [
        ...defaultCommandPolicy.deny,
        {
          id: "bash.deny.git-push",
          action: "deny",
          tool: "bash",
          pattern: /^git\b[^|;&\n]*\bpush\b/,
          capability: "network",
          reason: "Pushing was denied after this call was approved.",
        },
      ],
    };

    // The call was approved while the policy still asked about it...
    expect(
      await needsApproval(
        bashTool(),
        { command: "git push origin feature" },
        contextWith(policyContext()),
      ),
    ).toBe(true);

    // ...and the rule changed before the resumed run executed it.
    const result = await bashTool().execute?.(
      { command: "git push origin feature" },
      options(contextWith(policyContext({ policy: tightened }))),
    );

    expect(isRefusal(result)).toBe(true);
    if (isRefusal(result)) {
      expect(result.policy.rule).toBe("bash.deny.git-push");
    }
    expect(execCalls).toHaveLength(0);
  });

  test("needsApproval pauses on ask, and not on allow or deny", async () => {
    const context = contextWith(policyContext());

    expect(
      await needsApproval(bashTool(), { command: "git push" }, context),
    ).toBe(true);
    expect(
      await needsApproval(bashTool(), { command: "ls -la" }, context),
    ).toBe(false);
    expect(
      await needsApproval(bashTool(), { command: "rm -rf /" }, context),
    ).toBe(false);
  });

  test("needsApproval never pauses a non-interactive context", async () => {
    const context = contextWith(policyContext({ interactive: false }));

    expect(
      await needsApproval(bashTool(), { command: "git push" }, context),
    ).toBe(false);
  });

  test("a non-interactive ask is refused at execute as an unavailable approval", async () => {
    const result = await bashTool().execute?.(
      { command: "git push origin main" },
      options(contextWith(policyContext({ interactive: false }))),
    );

    expect(isRefusal(result)).toBe(true);
    if (isRefusal(result)) {
      expect(result.policy.decision).toBe("approval-unavailable");
      expect(result.error).toContain("approval");
    }
    expect(execCalls).toHaveLength(0);
  });

  test("a read-only policy denies write-class shell commands", async () => {
    const context = contextWith(
      policyContext({ policy: readOnlyPolicy, interactive: false }),
    );

    for (const command of [
      "echo hi > notes.txt",
      "sed -i 's/a/b/' src/index.ts",
      "npm install left-pad",
      "git commit -m 'x'",
      "curl https://example.com",
    ]) {
      const result = await bashTool().execute?.({ command }, options(context));
      expect(isRefusal(result)).toBe(true);
    }

    expect(execCalls).toHaveLength(0);
  });

  test("a read-only policy still runs read-only commands", async () => {
    const context = contextWith(
      policyContext({ policy: readOnlyPolicy, interactive: false }),
    );

    for (const command of [
      "ls -la",
      "git status --short",
      "git log --oneline -5",
      "git diff HEAD~1",
    ]) {
      const result = await bashTool().execute?.({ command }, options(context));
      expect(isRefusal(result)).toBe(false);
    }

    expect(execCalls).toHaveLength(4);
  });
});

describe("write and edit policy enforcement", () => {
  test("write refuses under a read-only policy without touching the sandbox", async () => {
    const result = await writeFileTool().execute?.(
      { filePath: "src/index.ts", content: "x" },
      options(contextWith(policyContext({ policy: readOnlyPolicy }))),
    );

    expect(isRefusal(result)).toBe(true);
    expect(writeCalls).toHaveLength(0);
  });

  test("edit refuses under a read-only policy without touching the sandbox", async () => {
    const result = await editFileTool().execute?.(
      { filePath: "src/index.ts", oldString: "existing", newString: "new" },
      options(contextWith(policyContext({ policy: readOnlyPolicy }))),
    );

    expect(isRefusal(result)).toBe(true);
    expect(writeCalls).toHaveLength(0);
  });

  test("write refuses when no policy is wired", async () => {
    const result = await writeFileTool().execute?.(
      { filePath: "src/index.ts", content: "x" },
      options(contextWith(undefined)),
    );

    expect(isRefusal(result)).toBe(true);
    expect(writeCalls).toHaveLength(0);
  });

  test("edit refuses when no policy is wired", async () => {
    const result = await editFileTool().execute?.(
      { filePath: "src/index.ts", oldString: "existing", newString: "new" },
      options(contextWith(undefined)),
    );

    expect(isRefusal(result)).toBe(true);
    expect(writeCalls).toHaveLength(0);
  });

  test("write inside the workspace is allowed under strict", async () => {
    const result = await writeFileTool().execute?.(
      { filePath: "src/index.ts", content: "x" },
      options(contextWith(policyContext({ posture: "strict" }))),
    );

    expect(isRefusal(result)).toBe(false);
    expect(result).toMatchObject({ success: true });
    expect(writeCalls).toEqual(["/repo/src/index.ts"]);
  });

  test("write pauses when a policy rule asks about the path", async () => {
    const gated: CommandPolicy = {
      ...defaultCommandPolicy,
      ask: [
        {
          id: "write.ask.migrations",
          action: "ask",
          tool: "write",
          pattern: /migrations\//,
          capability: "write",
          reason: "Migrations are applied on every deploy.",
        },
        ...defaultCommandPolicy.ask,
      ],
    };

    expect(
      await needsApproval(
        writeFileTool(),
        { filePath: "lib/db/migrations/0001.sql", content: "x" },
        contextWith(policyContext({ policy: gated })),
      ),
    ).toBe(true);

    expect(
      await needsApproval(
        writeFileTool(),
        { filePath: "src/index.ts", content: "x" },
        contextWith(policyContext({ posture: "strict" })),
      ),
    ).toBe(false);
  });

  test("write still asks for a dotenv path", async () => {
    expect(
      await needsApproval(
        writeFileTool(),
        { filePath: ".env.local", content: "x" },
        contextWith(policyContext()),
      ),
    ).toBe(true);
  });
});

describe("web_fetch policy enforcement", () => {
  test("refuses under a read-only policy without reaching the sandbox", async () => {
    const result = await webFetchTool.execute?.(
      { url: "https://example.com" },
      options(contextWith(policyContext({ policy: readOnlyPolicy }))),
    );

    expect(isRefusal(result)).toBe(true);
    expect(execCalls).toHaveLength(0);
  });

  test("refuses when no policy is wired", async () => {
    const result = await webFetchTool.execute?.(
      { url: "https://example.com" },
      options(contextWith(undefined)),
    );

    expect(isRefusal(result)).toBe(true);
    expect(execCalls).toHaveLength(0);
  });
});

describe("read-only tools are exempt", () => {
  test("read executes without a policy in context", async () => {
    const result = await readFileTool().execute?.(
      { filePath: "src/index.ts" },
      options(contextWith(undefined)),
    );

    expect(isRefusal(result)).toBe(false);
    expect(result).toMatchObject({ success: true });
  });
});
