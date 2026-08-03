import { describe, expect, test } from "bun:test";
import {
  MAX_SUMMARY_STRING_LENGTH,
  REDACTED,
  redactInputSummary,
  redactText,
} from "@/lib/policy/redaction";

describe("redactText", () => {
  test("leaves an ordinary command alone", () => {
    expect(redactText("git status --short")).toBe("git status --short");
  });

  test("redacts a GitHub token", () => {
    const redacted = redactText(
      "git push https://ghp_abcdefghijklmnopqrstuvwxyz0123456789@github.com/x/y",
    );

    expect(redacted).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz0123456789");
    expect(redacted).toContain(REDACTED);
  });

  test("redacts a fine-grained GitHub PAT", () => {
    const redacted = redactText(
      "export T=github_pat_11ABCDEFG0abcdefghij_KLMNOPQRSTUVWXYZ0123456789abcdefghijKLMNOP",
    );

    expect(redacted).not.toContain("github_pat_11ABCDEFG0");
    expect(redacted).toContain(REDACTED);
  });

  test("redacts an OpenAI-style key and a Slack token", () => {
    expect(
      redactText(
        "curl -H 'Authorization: Bearer sk-abcdefghij0123456789ABCDEF'",
      ),
    ).toContain(REDACTED);
    expect(
      redactText("xoxb-1234567890-1234567890123-abcdefghijklmnopqrstuvwx"),
    ).toContain(REDACTED);
  });

  test("redacts an AWS access key id and a JWT", () => {
    expect(redactText("AKIAIOSFODNN7EXAMPLE")).toContain(REDACTED);
    expect(
      redactText(
        "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk",
      ),
    ).toContain(REDACTED);
  });

  test("redacts an inline assignment of a secret-shaped name", () => {
    const redacted = redactText(
      "MY_API_TOKEN=hunter2-super-secret ./deploy.sh",
    );

    expect(redacted).not.toContain("hunter2-super-secret");
    expect(redacted).toContain("MY_API_TOKEN=");
    expect(redacted).toContain("./deploy.sh");
  });

  test("redacts a private key block", () => {
    const redacted = redactText(
      "-----BEGIN RSA PRIVATE KEY-----\nMIIEow==\n-----END RSA PRIVATE KEY-----",
    );

    expect(redacted).not.toContain("MIIEow==");
    expect(redacted).toContain(REDACTED);
  });

  test("truncates a very long value so the summary stays a summary", () => {
    const redacted = redactText("a".repeat(MAX_SUMMARY_STRING_LENGTH * 3));

    expect(redacted.length).toBeLessThanOrEqual(MAX_SUMMARY_STRING_LENGTH + 32);
    expect(redacted).toContain("truncated");
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
