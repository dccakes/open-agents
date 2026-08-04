import { describe, expect, test } from "bun:test";
import {
  type AgentPolicyContext,
  defaultCommandPolicy,
  evaluate,
  isAgentPolicyContext,
  type PolicyEvent,
} from "../policy";
import type { AgentContext } from "../types";
import { SUBAGENT_REGISTRY, SUBAGENT_TYPES } from "./registry";

/**
 * Conformance over the registry, not over a hand-written list: a fourth
 * subagent that forgets to thread policy fails here rather than running
 * unpoliced in production.
 */

const recorded: PolicyEvent[] = [];

const sessionPolicy: AgentPolicyContext = {
  policy: defaultCommandPolicy,
  posture: "strict",
  interactive: true,
  recorder: {
    record: (event) => {
      recorded.push(event);
    },
  },
};

function prepare(
  type: (typeof SUBAGENT_TYPES)[number],
  policy: AgentPolicyContext | undefined = sessionPolicy,
  omitPolicy = false,
) {
  if (omitPolicy) {
    return SUBAGENT_REGISTRY[type].prepareCall({
      model: "parent-model" as unknown as AgentContext["model"],
      options: {
        task: "task",
        instructions: "instructions",
        sandbox: { state: { type: "vercel" }, workingDirectory: "/repo" },
        model: "subagent-model" as unknown as AgentContext["model"],
      },
    });
  }

  return SUBAGENT_REGISTRY[type].prepareCall({
    model: "parent-model" as unknown as AgentContext["model"],
    options: {
      task: "task",
      instructions: "instructions",
      sandbox: { state: { type: "vercel" }, workingDirectory: "/repo" },
      model: "subagent-model" as unknown as AgentContext["model"],
      policy,
    },
  });
}

function policyOf(type: (typeof SUBAGENT_TYPES)[number]): AgentPolicyContext {
  const context = prepare(type).experimental_context;
  if (!isAgentPolicyContext(context.policy)) {
    throw new Error(`Subagent "${type}" did not thread a policy context.`);
  }
  return context.policy;
}

describe("subagent registry conformance", () => {
  test("every registered subagent threads the session policy", () => {
    for (const type of SUBAGENT_TYPES) {
      const context = prepare(type).experimental_context;

      expect(isAgentPolicyContext(context.policy)).toBe(true);
      expect(context.policy?.posture).toBe("strict");
      expect(context.policy?.recorder).toBe(sessionPolicy.recorder);
    }
  });

  test("every registered subagent is non-interactive", () => {
    for (const type of SUBAGENT_TYPES) {
      expect(policyOf(type).interactive).toBe(false);
    }
  });

  test("every registered subagent still receives the sandbox and model", () => {
    for (const type of SUBAGENT_TYPES) {
      const context = prepare(type).experimental_context;

      expect(context.sandbox.workingDirectory).toBe("/repo");
      expect(context.model).toBe(
        "subagent-model" as unknown as AgentContext["model"],
      );
    }
  });

  test("a subagent launched without a parent policy fails closed", () => {
    for (const type of SUBAGENT_TYPES) {
      expect(
        prepare(type, undefined, true).experimental_context.policy,
      ).toBeUndefined();
    }
  });

  test("every registered subagent denies what the session policy denies", () => {
    for (const type of SUBAGENT_TYPES) {
      const policy = policyOf(type);

      expect(
        evaluate(
          { toolName: "bash", command: "rm -rf /" },
          policy.policy,
          policy.posture,
        ).action,
      ).toBe("deny");
    }
  });

  test("a read-only subagent's profile is at least as restrictive as the session's", () => {
    for (const type of SUBAGENT_TYPES) {
      const entry = SUBAGENT_REGISTRY[type];
      const policy = policyOf(type);

      if (entry.readOnly) {
        expect(policy.policy.id).toBe(`${defaultCommandPolicy.id}.read-only`);
        expect(policy.policy.defaultAction).toBe("deny");
      } else {
        expect(policy.policy.id).toBe(defaultCommandPolicy.id);
      }
    }
  });

  test("the explorer is the read-only subagent and has no write tools", () => {
    expect(SUBAGENT_REGISTRY.explorer.readOnly).toBe(true);

    const tools = Object.keys(SUBAGENT_REGISTRY.explorer.agent.tools);
    expect(tools).not.toContain("write");
    expect(tools).not.toContain("edit");
  });

  test("the explorer's prompt states the restriction is enforced", () => {
    const { instructions } = prepare("explorer");

    expect(instructions).toContain("ENFORCED");
  });
});
