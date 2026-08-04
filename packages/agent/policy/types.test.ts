import { describe, expect, test } from "bun:test";
import {
  commandPolicySchema,
  policyDecisionSchema,
  policyRuleSchema,
  policyToolCallSchema,
  postureSchema,
} from "./types";

describe("policy schemas", () => {
  test("posture accepts exactly the three postures", () => {
    expect(postureSchema.parse("strict")).toBe("strict");
    expect(postureSchema.parse("auto")).toBe("auto");
    expect(postureSchema.parse("dangerous")).toBe("dangerous");
    expect(postureSchema.safeParse("yolo").success).toBe(false);
  });

  test("a rule carries an id, an action, a tool, a capability and a reason", () => {
    const rule = policyRuleSchema.parse({
      id: "bash.deny.example",
      action: "deny",
      tool: "bash",
      pattern: /rm -rf \//,
      capability: "destructive",
      reason: "Destroys the filesystem",
    });

    expect(rule.id).toBe("bash.deny.example");
    expect(rule.pattern?.source).toBe("rm -rf \\/");
    expect(policyRuleSchema.safeParse({ id: "", action: "deny" }).success).toBe(
      false,
    );
  });

  test("a rule rejects an unknown action", () => {
    const result = policyRuleSchema.safeParse({
      id: "x",
      action: "maybe",
      tool: "bash",
      capability: "other",
      reason: "r",
    });
    expect(result.success).toBe(false);
  });

  test("a policy holds ordered rule lists and a default action", () => {
    const policy = commandPolicySchema.parse({
      id: "test",
      description: "test policy",
      deny: [],
      ask: [],
      allow: [],
      defaultAction: "allow",
      defaultReason: "No rule matched",
    });

    expect(policy.deny).toEqual([]);
    expect(policy.defaultAction).toBe("allow");
  });

  test("a decision models the unknown outcome distinctly from its resolved action", () => {
    const decision = policyDecisionSchema.parse({
      action: "ask",
      outcome: "unknown",
      rule: null,
      reason: "The command could not be parsed",
      posture: "auto",
      matchedText: null,
    });

    expect(decision.action).toBe("ask");
    expect(decision.outcome).toBe("unknown");
    expect(
      policyDecisionSchema.safeParse({
        action: "unknown",
        outcome: "unknown",
        rule: null,
        reason: "x",
        posture: "auto",
        matchedText: null,
      }).success,
    ).toBe(false);
  });

  test("a tool call carries the tool name and its policy-relevant input", () => {
    const call = policyToolCallSchema.parse({
      toolName: "bash",
      command: "ls -la",
    });
    expect(call.toolName).toBe("bash");
    expect(call.command).toBe("ls -la");
    expect(policyToolCallSchema.safeParse({ command: "ls" }).success).toBe(
      false,
    );
  });
});
