import type { SandboxState } from "@open-agents/sandbox";
import type { LanguageModel } from "ai";
import { z } from "zod";
import type { AgentSandboxContext } from "./open-agent";
import type { AgentPolicyContext } from "./policy";
import type { SkillMetadata } from "./skills/types";

export const todoStatusSchema = z.enum(["pending", "in_progress", "completed"]);
export type TodoStatus = z.infer<typeof todoStatusSchema>;

export const todoItemSchema = z.object({
  id: z.string().describe("Unique identifier for the todo item"),
  content: z.string().describe("The task description"),
  status: todoStatusSchema.describe(
    "Current status. Only ONE task should be in_progress at a time.",
  ),
});
export type TodoItem = z.infer<typeof todoItemSchema>;

export interface AgentContext {
  sandbox: AgentSandboxContext;
  skills?: SkillMetadata[];
  model: LanguageModel;
  subagentModel?: LanguageModel;
  /**
   * The command policy and posture this run is evaluated under.
   *
   * Optional on the type so that existing zero-argument tool factories and
   * read-only tools keep compiling — but a side-effecting tool with no policy
   * here refuses (see `tools/policy-enforcement.ts`). Every construction site
   * is expected to set it.
   */
  policy?: AgentPolicyContext;
}

export interface SandboxExecutionContext {
  sandbox: AgentSandboxContext;
}

export function isSandboxState(value: unknown): value is SandboxState {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    value.type === "vercel"
  );
}

export const EVICTION_THRESHOLD_BYTES = 80 * 1024;
