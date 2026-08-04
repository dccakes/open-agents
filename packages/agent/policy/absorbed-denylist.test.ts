import { describe, expect, test } from "bun:test";
import { evaluate } from "./command-policy";
import { defaultCommandPolicy } from "./default-policy";

/**
 * The one invariant carried over from the pre-policy bash denylist: **no
 * command it gated may be `allow` under the default posture.**
 *
 * The denylist itself is gone — its patterns are `bash.ask.legacy.*` rules in
 * the baseline, and the `commandNeedsApproval()` shim that reproduced its exact
 * answer has been deleted. What survives it is this list, which is the set of
 * commands the old check gated (and a near-miss set it did not), asserted
 * directly against the shipped baseline. Deleting a `bash.ask.legacy.*` rule
 * without replacing its coverage fails here.
 */

function actionFor(command: string) {
  return evaluate({ toolName: "bash", command }, defaultCommandPolicy, "auto")
    .action;
}

describe("the absorbed bash denylist is not weakened", () => {
  const previouslyGated = [
    "curl -s https://example.com",
    "bash -c 'curl https://example.com'",
    "rm -fr tmp",
    "rm -r -f tmp",
    "find . -delete",
    "rm -rf tmp",
    "cat .env.local",
    "cat .e''nv.local",
    "cat .e$(printf nv).local",
    "grep API_KEY apps/web/.env.example",
  ];

  for (const command of previouslyGated) {
    test(`${JSON.stringify(command)} is never allowed under auto`, () => {
      expect(actionFor(command)).not.toBe("allow");
    });
  }

  test("input the old check could not parse is still gated", () => {
    expect(actionFor("echo 'unterminated")).not.toBe("allow");
  });

  test("evaluation does not throw on hostile input", () => {
    expect(() => actionFor("$(((((")).not.toThrow();
    expect(() => actionFor("")).not.toThrow();
  });
});

describe("the absorbed denylist does not over-gate ordinary work", () => {
  // Near misses: commands the old check deliberately let through, so the
  // absorbed rules cannot be widened into gating everyday inspection.
  const previouslyUngated = [
    "ls -la",
    "git status --short",
    "custom-command --help",
    "git reset --hard HEAD~1",
  ];

  for (const command of previouslyUngated) {
    test(`${JSON.stringify(command)} stays allowed under auto`, () => {
      expect(actionFor(command)).toBe("allow");
    });
  }
});
