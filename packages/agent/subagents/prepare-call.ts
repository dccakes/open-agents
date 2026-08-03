import type { LanguageModel } from "ai";
import { z } from "zod";
import type { AgentPolicyContext } from "../policy";
import type { AgentContext, SandboxExecutionContext } from "../types";
import { SUBAGENT_WORKING_DIR } from "./constants";
import { toSubagentPolicyContext } from "./policy-context";

/**
 * Subagent call preparation, shared by every subagent.
 *
 * Each subagent's `prepareCall` builds a **fresh** `experimental_context`:
 * nothing propagates implicitly from the parent, so a subagent whose
 * `prepareCall` forgets the policy runs unpoliced. Building them all from one
 * factory is what makes that impossible to forget, and
 * `registry.test.ts` asserts it for every registered subagent.
 */

export const subagentCallOptionsSchema = z.object({
  task: z.string().describe("Short description of the task"),
  instructions: z.string().describe("Detailed instructions for the task"),
  sandbox: z
    .custom<SandboxExecutionContext["sandbox"]>()
    .describe("Sandbox for file system and shell operations"),
  model: z.custom<LanguageModel>().describe("Language model for this subagent"),
  policy: z
    .custom<AgentPolicyContext>()
    .optional()
    .describe("The session's policy context, inherited from the parent agent"),
});

export type SubagentCallOptions = z.infer<typeof subagentCallOptionsSchema>;

export interface SubagentPrepareCallConfig {
  /** Used in the "requires call options" error. */
  name: string;
  systemPrompt: string;
  /** Appended after the task, restating the rules the subagent must not break. */
  reminder: string;
  /** Run this subagent's tools under a read-only profile. */
  readOnly?: boolean;
}

export interface SubagentPrepareCallInput {
  model: LanguageModel;
  options?: SubagentCallOptions;
}

export interface SubagentPrepareCallResult {
  model: LanguageModel;
  instructions: string;
  experimental_context: AgentContext;
}

/** The shape the registry conformance test exercises. */
export type SubagentPrepareCall = (
  input: SubagentPrepareCallInput,
) => SubagentPrepareCallResult;

export function createSubagentPrepareCall(config: SubagentPrepareCallConfig) {
  return function prepareSubagentCall<
    TSettings extends SubagentPrepareCallInput,
  >(input: TSettings) {
    const { options, ...settings } = input;
    if (!options) {
      throw new Error(`${config.name} subagent requires task call options.`);
    }

    const model = options.model ?? settings.model;

    return {
      ...settings,
      model,
      instructions: `${config.systemPrompt}

${SUBAGENT_WORKING_DIR}

## Your Task
${options.task}

## Detailed Instructions
${options.instructions}

${config.reminder}`,
      experimental_context: {
        sandbox: options.sandbox,
        model,
        policy: toSubagentPolicyContext(options.policy, {
          readOnly: config.readOnly,
        }),
      } satisfies AgentContext,
    };
  };
}
