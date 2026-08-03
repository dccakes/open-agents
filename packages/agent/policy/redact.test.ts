import { describe, expect, test } from "bun:test";
import { redactPolicyInput } from "./redact";

describe("redactPolicyInput", () => {
  test("leaves ordinary commands untouched", () => {
    expect(redactPolicyInput("ls -la apps/web")).toBe("ls -la apps/web");
    expect(redactPolicyInput("git status --short")).toBe("git status --short");
  });

  test("redacts the value of a secret-shaped assignment but keeps the name", () => {
    const redacted = redactPolicyInput(
      "export AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY",
    );

    expect(redacted).toContain("AWS_SECRET_ACCESS_KEY");
    expect(redacted).not.toContain("wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY");
  });

  test("redacts quoted secret values", () => {
    const redacted = redactPolicyInput('API_TOKEN="hunter2-super-secret"');

    expect(redacted).toContain("API_TOKEN");
    expect(redacted).not.toContain("hunter2-super-secret");
  });

  test("redacts authorization headers", () => {
    const redacted = redactPolicyInput(
      'curl -H "Authorization: Bearer abcdef123456" https://example.com',
    );

    expect(redacted).not.toContain("abcdef123456");
    expect(redacted).toContain("https://example.com");
  });

  test("redacts well-known credential shapes", () => {
    const samples = [
      "ghp_0123456789abcdefghijklmnopqrstuvwxyz",
      "github_pat_0123456789abcdefghijklmnop",
      "sk-0123456789abcdefghijklmnop",
      "xoxb-0123456789-abcdefghij",
      "AKIAIOSFODNN7EXAMPLE",
    ];

    for (const sample of samples) {
      expect(redactPolicyInput(`echo ${sample}`)).not.toContain(sample);
    }
  });

  test("redacts a private key block", () => {
    const key = [
      "-----BEGIN OPENSSH PRIVATE KEY-----",
      "b3BlbnNzaC1rZXktdjEAAAAA",
      "-----END OPENSSH PRIVATE KEY-----",
    ].join("\n");

    expect(redactPolicyInput(`echo '${key}'`)).not.toContain(
      "b3BlbnNzaC1rZXktdjEAAAAA",
    );
  });

  test("redacts long opaque tokens", () => {
    const token = "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f6";

    expect(redactPolicyInput(`curl -d ${token}`)).not.toContain(token);
  });

  test("does not redact long ordinary paths", () => {
    const command = "cat packages/agent/policy/command-parser.ts";

    expect(redactPolicyInput(command)).toBe(command);
  });

  test("truncates an overlong summary", () => {
    const summary = redactPolicyInput(`ls ${"src/a/b/c.ts ".repeat(200)}`);

    expect(summary.length).toBeLessThanOrEqual(520);
    expect(summary.endsWith("...")).toBe(true);
  });

  test("returns an empty string for empty input", () => {
    expect(redactPolicyInput("")).toBe("");
    expect(redactPolicyInput(undefined)).toBe("");
  });
});
