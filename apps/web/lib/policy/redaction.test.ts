import { describe, expect, test } from "bun:test";
import {
  MAX_REDACTED_TEXT_LENGTH,
  redactSecrets,
} from "@open-agents/shared/lib/redact-secrets";
import {
  MAX_SUMMARY_STRING_LENGTH,
  REDACTED,
  redactInputSummary,
  redactText,
} from "@/lib/policy/redaction";

/**
 * The pattern coverage this file used to duplicate now lives in
 * `packages/shared/lib/redact-secrets.test.ts`, which asserts the union of what
 * this suite and `packages/agent/policy/redact.test.ts` asserted separately.
 * What is left here is what is actually local: that `redactText` is the shared
 * scrubber, and the structural walk into a `jsonb` record.
 */

describe("redactText", () => {
  test("is the shared scrubber, not a second implementation", () => {
    expect(redactText).toBe(redactSecrets);
    expect(MAX_SUMMARY_STRING_LENGTH).toBe(MAX_REDACTED_TEXT_LENGTH);
    expect(REDACTED).toBe("[redacted]");
  });

  test("redacts a credential a summary would otherwise carry into a row", () => {
    const redacted = redactText(
      "git push https://ghp_abcdefghijklmnopqrstuvwxyz0123456789@github.com/x/y",
    );

    expect(redacted).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz0123456789");
    expect(redacted).toContain(REDACTED);
  });
});

describe("redactInputSummary", () => {
  test("returns a jsonb-safe record for a plain object", () => {
    expect(
      redactInputSummary({ command: "ls -la", cwd: "/workspace" }),
    ).toEqual({
      command: "ls -la",
      cwd: "/workspace",
    });
  });

  test("redacts values under secret-shaped keys whatever they look like", () => {
    expect(
      redactInputSummary({ token: "plain", authorization: "also plain" }),
    ).toEqual({ token: REDACTED, authorization: REDACTED });
  });

  test("redacts nested objects and arrays", () => {
    const summary = redactInputSummary({
      env: { GITHUB_TOKEN: "ghp_abcdefghijklmnopqrstuvwxyz0123456789" },
      args: ["--token", "ghp_abcdefghijklmnopqrstuvwxyz0123456789"],
    });

    expect(JSON.stringify(summary)).not.toContain("ghp_abcdefghij");
  });

  test("wraps a non-object input rather than losing it", () => {
    expect(redactInputSummary("rm -rf /")).toEqual({ value: "rm -rf /" });
    expect(redactInputSummary(null)).toEqual({ value: null });
  });

  test("never throws on a circular structure", () => {
    const circular: Record<string, unknown> = { name: "loop" };
    circular.self = circular;

    expect(() => redactInputSummary(circular)).not.toThrow();
    expect(redactInputSummary(circular)).toMatchObject({ name: "loop" });
  });

  test("collapses nesting past the depth bound", () => {
    let deep: Record<string, unknown> = { leaf: "bottom" };
    for (let i = 0; i < 10; i++) {
      deep = { next: deep };
    }

    expect(JSON.stringify(redactInputSummary(deep))).toContain("[truncated]");
  });

  test("produces something JSON can serialize", () => {
    const summary = redactInputSummary({
      when: new Date("2026-01-01T00:00:00Z"),
      count: 3,
      ok: true,
      missing: undefined,
    });

    expect(() => JSON.stringify(summary)).not.toThrow();
    expect(summary.count).toBe(3);
    expect(summary.ok).toBe(true);
  });
});

describe("redactInputSummary — stringsAlreadyRedacted", () => {
  test("a string that has already been redacted is not re-processed", () => {
    const alreadyRedacted = redactSecrets(
      'curl -H "Authorization: Bearer abcdef123456" https://example.com',
    );

    expect(
      redactInputSummary(
        { summary: alreadyRedacted },
        { stringsAlreadyRedacted: true },
      ),
    ).toEqual({ summary: alreadyRedacted });
  });

  test("skips only the string scrub, never the structural work", () => {
    const circular: Record<string, unknown> = { name: "loop" };
    circular.self = circular;

    expect(
      redactInputSummary(
        { token: "plain", when: new Date("2026-01-01T00:00:00Z"), circular },
        { stringsAlreadyRedacted: true },
      ),
    ).toMatchObject({
      token: REDACTED,
      when: "2026-01-01T00:00:00.000Z",
    });
  });

  test("defaults to scrubbing, so a caller that forgets still fails closed", () => {
    expect(
      redactInputSummary({
        summary: "echo ghp_abcdefghijklmnopqrstuvwxyz0123456789",
      }),
    ).toEqual({ summary: `echo ${REDACTED}` });
  });
});
