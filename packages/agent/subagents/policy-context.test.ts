import { describe, expect, test } from "bun:test";
import {
  type AgentPolicyContext,
  defaultCommandPolicy,
  evaluate,
} from "../policy";
import { toSubagentPolicyContext } from "./policy-context";

const sessionPolicy: AgentPolicyContext = {
  policy: defaultCommandPolicy,
  posture: "dangerous",
  interactive: true,
  recorder: { record: () => undefined },
};

describe("toSubagentPolicyContext", () => {
  test("returns undefined when the parent has no policy, so the subagent fails closed", () => {
    expect(toSubagentPolicyContext(undefined)).toBeUndefined();
  });

  test("marks the context non-interactive", () => {
    expect(toSubagentPolicyContext(sessionPolicy)?.interactive).toBe(false);
  });

  test("inherits the session posture and recorder", () => {
    const context = toSubagentPolicyContext(sessionPolicy);

    expect(context?.posture).toBe("dangerous");
    expect(context?.recorder).toBe(sessionPolicy.recorder);
  });

  test("keeps the session policy when not read-only", () => {
    expect(toSubagentPolicyContext(sessionPolicy)?.policy.id).toBe(
      defaultCommandPolicy.id,
    );
  });

  test("derives a read-only profile from the session policy", () => {
    const context = toSubagentPolicyContext(sessionPolicy, { readOnly: true });

    expect(context?.policy.id).toBe(`${defaultCommandPolicy.id}.read-only`);
  });

  test("a read-only profile denies writes even under the dangerous posture", () => {
    const context = toSubagentPolicyContext(sessionPolicy, { readOnly: true });
    if (!context) {
      throw new Error("expected a policy context");
    }

    for (const command of [
      "echo hi > notes.txt",
      "sed -i 's/a/b/' src/index.ts",
      "npm install left-pad",
    ]) {
      expect(
        evaluate({ toolName: "bash", command }, context.policy, context.posture)
          .action,
      ).toBe("deny");
    }
  });

  test("a read-only profile still allows inspection commands", () => {
    const context = toSubagentPolicyContext(sessionPolicy, { readOnly: true });
    if (!context) {
      throw new Error("expected a policy context");
    }

    for (const command of [
      "ls -la",
      "git status --short",
      "git log --oneline -5",
      "git diff HEAD~1",
    ]) {
      expect(
        evaluate({ toolName: "bash", command }, context.policy, context.posture)
          .action,
      ).toBe("allow");
    }
  });
});
