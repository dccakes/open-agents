import { describe, expect, test } from "bun:test";
import { commandNeedsApproval } from "./legacy-approval";

/**
 * `commandNeedsApproval` is re-exported from `packages/agent/tools/index.ts`
 * as a thin wrapper over the policy. These are the assertions that pinned its
 * behaviour before the policy module existed
 * (`packages/agent/tools/tools.test.ts:403-424`), reproduced here so the
 * wrapper cannot drift from the implementation it replaces.
 */
describe("commandNeedsApproval — behaviour preserved", () => {
  const ungated = [
    "ls -la",
    "git status --short",
    "npm install",
    "bun install",
    "custom-command --help",
    "git reset --hard HEAD~1",
  ];

  const gated = [
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

  for (const command of ungated) {
    test(`does not gate ${JSON.stringify(command)}`, () => {
      expect(commandNeedsApproval(command)).toBe(false);
    });
  }

  for (const command of gated) {
    test(`gates ${JSON.stringify(command)}`, () => {
      expect(commandNeedsApproval(command)).toBe(true);
    });
  }

  test("it is at least as restrictive on input the old check could not parse", () => {
    expect(commandNeedsApproval("echo 'unterminated")).toBe(true);
  });

  test("it does not throw on hostile input", () => {
    expect(() => commandNeedsApproval("$(((((")).not.toThrow();
    expect(() => commandNeedsApproval("")).not.toThrow();
  });
});
