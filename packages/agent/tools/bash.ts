import { tool } from "ai";
import { z } from "zod";
import { commandNeedsApproval } from "../policy";
import { resolveBashWorkingDirectory } from "./bash-working-directory";
import {
  enforcePolicyWithApproval,
  type PolicyRefusal,
  refuseWithRule,
  requestPolicyApproval,
} from "./policy-enforcement";
import { getSandbox } from "./utils";

/**
 * `commandNeedsApproval` now lives in the policy module — it is a thin wrapper
 * over `evaluate()` against the absorbed legacy rules. It stays exported from
 * here so existing importers of `./bash` keep working.
 */
export { commandNeedsApproval } from "../policy";

const TIMEOUT_MS = 120_000;

const bashInputSchema = z.object({
  command: z.string().describe("The bash command to execute"),
  cwd: z
    .string()
    .optional()
    .describe(
      "Workspace-relative working directory for the command (e.g., apps/web)",
    ),
  detached: z
    .boolean()
    .optional()
    .describe(
      "Use this whenever you want to run a persistent server in the background (e.g., npm run dev, next dev). The command starts and returns immediately without waiting for it to finish.",
    ),
});

type BashInput = z.infer<typeof bashInputSchema>;
type ApprovalFn = (args: BashInput) => boolean | Promise<boolean>;

interface ToolOptions {
  needsApproval?: boolean | ApprovalFn;
}

function policyCall(command: string) {
  return { toolName: "bash", command };
}

/** A refusal in the bash result shape, so the model reads it like any failure. */
function refusalResult(refusal: PolicyRefusal) {
  return {
    ...refusal,
    exitCode: null,
    stdout: "",
    stderr: refusal.error,
  };
}

export const bashTool = (options?: ToolOptions) =>
  tool({
    needsApproval: async (args, { experimental_context, toolCallId }) => {
      // `null` means nothing was wired: fall back to the pre-policy answer so a
      // partially-wired caller is never *less* gated than before. `execute`
      // refuses that call outright regardless.
      const requiresApproval =
        (await requestPolicyApproval(
          experimental_context,
          policyCall(args.command),
          toolCallId,
        )) ?? commandNeedsApproval(args.command);

      if (!requiresApproval) {
        return false;
      }

      if (typeof options?.needsApproval === "function") {
        return options.needsApproval(args);
      }
      return options?.needsApproval ?? true;
    },
    description: `Execute a bash command in the user's shell (non-interactive).

WHEN TO USE:
- Running existing project commands (build, test, lint, typecheck)
- Using read-only CLI tools (git status, git diff, ls, etc.)
- Invoking language/package managers (npm, pnpm, yarn, pip, go, etc.) as part of the task

WHEN NOT TO USE:
- Reading files (use readFileTool instead)
- Editing or creating files (use editFileTool or writeFileTool instead)
- Searching code or text (use grepTool and/or globTool instead)
- Interactive commands (shells, editors, REPLs)

USAGE:
- Runs bash -c "<command>" in a non-interactive shell (no TTY/PTY)
- Commands automatically run in the working directory by default — do NOT prepend "cd /path &&" to commands
- NEVER prefix commands with "cd <working-directory> &&" or any path — this is the most common mistake and is always wrong
- Use the cwd parameter ONLY with a workspace-relative subdirectory when you need to run in a different directory
- Commands automatically timeout after ~2 minutes
- Combined stdout/stderr output is truncated after ~50,000 characters

DO NOT USE FOR:
- File reading (cat, head, tail) - use readFileTool
- File editing (sed, awk, editors) - use editFileTool / writeFileTool
- File creation (touch, redirections like >, >>) - use writeFileTool
- Code search (grep, rg, ag) - use grepTool

IMPORTANT:
- Never chain commands with ';' or '&&' - use separate tool calls for each logical step
- Never use interactive commands (vim, nano, top, bash, ssh, etc.)
- Always quote file paths that may contain spaces
- Use detached: true to start dev servers or other long-running processes in the background

EXAMPLES:
- Run the test suite: command: "npm test"
- Check git status: command: "git status --short"
- List files in src: command: "ls -la", cwd: "src"
- Start a dev server: command: "npm run dev", detached: true`,
    inputSchema: bashInputSchema,
    execute: async (
      { command, cwd, detached },
      { experimental_context, abortSignal, toolCallId },
    ) => {
      // Authoritative gate: re-evaluated here rather than trusting that a pause
      // happened, and before the sandbox is touched, so a denied command never
      // reaches a shell. An `ask` additionally has to be backed by a server-side
      // approval, because the pause itself is asserted by the client.
      const refusal = await enforcePolicyWithApproval(
        experimental_context,
        policyCall(command),
        toolCallId,
      );
      if (refusal) {
        return refusalResult(refusal);
      }

      const sandbox = await getSandbox(experimental_context, "bash");
      const workingDirectory = sandbox.workingDirectory;

      const resolvedCwd = resolveBashWorkingDirectory({
        cwd,
        workingDirectory,
      });
      if (!resolvedCwd.ok) {
        return refusalResult(
          refuseWithRule(experimental_context, policyCall(command), {
            id: "bash.deny.cwd-outside-workspace",
            reason: resolvedCwd.reason,
          }),
        );
      }
      const workingDir = resolvedCwd.workingDir;

      // Detached mode: start the command in the background and return immediately
      if (detached) {
        if (!sandbox.execDetached) {
          return {
            success: false,
            exitCode: null,
            stdout: "",
            stderr:
              "Detached mode is not supported in this sandbox environment. Only cloud sandboxes support background processes.",
          };
        }

        try {
          const { commandId } = await sandbox.execDetached(command, workingDir);
          return {
            success: true,
            exitCode: null,
            stdout: `Process started in background (command ID: ${commandId}). The server is now running.`,
            stderr: "",
          };
        } catch (error) {
          return {
            success: false,
            exitCode: null,
            stdout: "",
            stderr: error instanceof Error ? error.message : String(error),
          };
        }
      }

      const result = await sandbox.exec(command, workingDir, TIMEOUT_MS, {
        signal: abortSignal,
      });

      return {
        success: result.success,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        ...(result.truncated && { truncated: true }),
      };
    },
  });
