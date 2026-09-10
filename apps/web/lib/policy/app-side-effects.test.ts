import { describe, expect, test } from "bun:test";
import {
  APP_SIDE_EFFECT_RULE,
  APP_SIDE_EFFECT_TOOL_NAME,
  APP_SIDE_EFFECT_SKIP_REASON,
  describeAppSideEffects,
  gateAppSideEffects,
  isAppSideEffectOperation,
  parseAppSideEffectOperations,
} from "@/lib/policy/app-side-effects";

describe("gateAppSideEffects", () => {
  test("asks under strict, naming the rule and the posture", () => {
    const gate = gateAppSideEffects("strict");

    expect(gate.decision).toBe("ask");
    expect(gate.posture).toBe("strict");
    expect(gate.rule).toBe(APP_SIDE_EFFECT_RULE);
    expect(gate.reason).toContain("strict");
  });

  test("allows under auto, so today's behaviour is unchanged", () => {
    expect(gateAppSideEffects("auto")).toEqual({
      decision: "allow",
      posture: "auto",
      rule: APP_SIDE_EFFECT_RULE,
      reason: expect.any(String),
    });
  });

  test("allows under dangerous, which collapses ask into allow", () => {
    expect(gateAppSideEffects("dangerous").decision).toBe("allow");
  });
});

describe("describeAppSideEffects", () => {
  test("names the commit and the repository it pushes to", () => {
    const described = describeAppSideEffects({
      operations: ["auto-commit"],
      repoOwner: "acme",
      repoName: "repo",
    });

    expect(described).toContain("acme/repo");
    expect(described.toLowerCase()).toContain("commit");
  });

  test("names both operations when a pull request would follow", () => {
    const described = describeAppSideEffects({
      operations: ["auto-commit", "auto-create-pr"],
      repoOwner: "acme",
      repoName: "repo",
    });

    expect(described.toLowerCase()).toContain("commit");
    expect(described.toLowerCase()).toContain("pull request");
  });

  test("describes a pull request on its own when there is nothing to commit", () => {
    const described = describeAppSideEffects({
      operations: ["auto-create-pr"],
      repoOwner: "acme",
      repoName: "repo",
    });

    expect(described.toLowerCase()).toContain("pull request");
    expect(described.toLowerCase()).not.toContain("commit and push");
  });
});

describe("operation parsing", () => {
  test("recognizes the two application side effects", () => {
    expect(isAppSideEffectOperation("auto-commit")).toBe(true);
    expect(isAppSideEffectOperation("auto-create-pr")).toBe(true);
    expect(isAppSideEffectOperation("rm -rf /")).toBe(false);
  });

  test("parses a stored summary back into operations, dropping junk", () => {
    expect(
      parseAppSideEffectOperations(["auto-commit", "nonsense", 7]),
    ).toEqual(["auto-commit"]);
  });

  test("parses nothing out of a non-array", () => {
    expect(parseAppSideEffectOperations("auto-commit")).toEqual([]);
  });
});

describe("the tool name and skip reason", () => {
  test("the tool name is stable, because it is stored on every record", () => {
    expect(APP_SIDE_EFFECT_TOOL_NAME).toBe("app.git-automation");
  });

  test("the skip reason says policy skipped it", () => {
    expect(APP_SIDE_EFFECT_SKIP_REASON.toLowerCase()).toContain(
      "skipped by policy",
    );
  });
});
