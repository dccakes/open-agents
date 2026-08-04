import { describe, expect, test } from "bun:test";
import {
  MAX_REDACTED_TEXT_LENGTH,
  redactSecrets,
} from "@open-agents/shared/lib/redact-secrets";
import { MAX_POLICY_INPUT_LENGTH, redactPolicyInput } from "./redact";

/**
 * The pattern coverage this file used to duplicate now lives in
 * `packages/shared/lib/redact-secrets.test.ts`, which asserts the union of what
 * this suite and `apps/web/lib/policy/redaction.test.ts` asserted separately.
 * What is left here is the boundary itself: `redactPolicyInput` must be the
 * shared scrubber and nothing else, so it cannot drift back into a second
 * implementation.
 */

const SAMPLES = [
  "ls -la apps/web",
  "export AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY",
  'API_TOKEN="hunter2-super-secret"',
  'curl -H "Authorization: Bearer abcdef123456" https://example.com',
  "echo ghp_0123456789abcdefghijklmnopqrstuvwxyz",
  "git clone https://alice:hunter2secret@github.com/x/y.git",
  "curl -d a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f6",
  `ls ${"src/a/b/c.ts ".repeat(400)}`,
];

describe("redactPolicyInput", () => {
  for (const sample of SAMPLES) {
    test(`delegates to the shared scrubber: ${sample.slice(0, 32)}…`, () => {
      expect(redactPolicyInput(sample)).toBe(redactSecrets(sample));
    });
  }

  test("uses the shared length bound", () => {
    expect(MAX_POLICY_INPUT_LENGTH).toBe(MAX_REDACTED_TEXT_LENGTH);

    const summary = redactPolicyInput(`ls ${"src/a/b/c.ts ".repeat(400)}`);

    expect(summary.length).toBeLessThanOrEqual(MAX_POLICY_INPUT_LENGTH);
    expect(summary).toContain("truncated");
  });

  test("returns an empty string for empty input", () => {
    expect(redactPolicyInput("")).toBe("");
    expect(redactPolicyInput(undefined)).toBe("");
  });
});
