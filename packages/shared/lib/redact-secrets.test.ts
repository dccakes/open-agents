import { describe, expect, test } from "bun:test";
import {
  MAX_REDACTED_TEXT_LENGTH,
  REDACTED,
  redactSecrets,
} from "./redact-secrets";

/**
 * The merged suite.
 *
 * Every case that `packages/agent/policy/redact.test.ts` and
 * `apps/web/lib/policy/redaction.test.ts` asserted separately lives here, so a
 * pattern cannot be dropped in a future edit to one side without a failure.
 */

describe("redactSecrets — ordinary text", () => {
  test("leaves ordinary commands untouched", () => {
    expect(redactSecrets("ls -la apps/web")).toBe("ls -la apps/web");
    expect(redactSecrets("git status --short")).toBe("git status --short");
  });

  test("does not redact long ordinary paths", () => {
    const command = "cat packages/agent/policy/command-parser.ts";

    expect(redactSecrets(command)).toBe(command);
  });
});

describe("redactSecrets — named values", () => {
  test("redacts the value of a secret-shaped assignment but keeps the name", () => {
    const redacted = redactSecrets(
      "export AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY",
    );

    expect(redacted).toContain("AWS_SECRET_ACCESS_KEY");
    expect(redacted).not.toContain("wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY");
  });

  test("redacts quoted secret values", () => {
    const redacted = redactSecrets('API_TOKEN="hunter2-super-secret"');

    expect(redacted).toContain("API_TOKEN");
    expect(redacted).not.toContain("hunter2-super-secret");
  });

  test("redacts an inline assignment of a secret-shaped name", () => {
    const redacted = redactSecrets(
      "MY_API_TOKEN=hunter2-super-secret ./deploy.sh",
    );

    expect(redacted).not.toContain("hunter2-super-secret");
    expect(redacted).toContain("MY_API_TOKEN=");
    expect(redacted).toContain("./deploy.sh");
  });

  test("redacts a space-separated secret flag", () => {
    const redacted = redactSecrets("gh auth login --token hunter2supersecret");

    expect(redacted).toContain("--token");
    expect(redacted).not.toContain("hunter2supersecret");
  });

  test("redacts authorization headers", () => {
    const redacted = redactSecrets(
      'curl -H "Authorization: Bearer abcdef123456" https://example.com',
    );

    expect(redacted).not.toContain("abcdef123456");
    expect(redacted).toContain("https://example.com");
  });

  test("redacts a bare scheme-prefixed credential", () => {
    expect(redactSecrets("Bearer abcdef1234567890")).toBe(`Bearer ${REDACTED}`);
    expect(redactSecrets("Token abcdef1234567890")).toBe(`Token ${REDACTED}`);
  });

  test("redacts credentials embedded in a URL's userinfo", () => {
    const redacted = redactSecrets(
      "git clone https://alice:hunter2secret@github.com/x/y.git",
    );

    expect(redacted).not.toContain("hunter2secret");
    expect(redacted).toContain("github.com/x/y.git");
  });
});

describe("redactSecrets — vendor token shapes", () => {
  const samples = [
    "ghp_0123456789abcdefghijklmnopqrstuvwxyz",
    "github_pat_0123456789abcdefghijklmnop",
    "sk-0123456789abcdefghijklmnop",
    "sk-ant-api03-0123456789abcdefghijklmnop",
    "xoxb-0123456789-abcdefghij",
    "xoxo-0123456789-abcdefghij",
    "AKIAIOSFODNN7EXAMPLE",
    "ASIAIOSFODNN7EXAMPLE",
    "AIDAIOSFODNN7EXAMPLE",
    "AROAIOSFODNN7EXAMPLE",
    "AIzaSyA0123456789abcdefghijklmnopqrstu",
    "vercel_0123456789abcdefghij",
    "neon_0123456789abcdefghij",
    "dtn_0123456789abcdefghij",
    "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk",
  ];

  for (const sample of samples) {
    test(`redacts ${sample.slice(0, 12)}…`, () => {
      const redacted = redactSecrets(`echo ${sample}`);

      expect(redacted).not.toContain(sample);
      expect(redacted).toContain(REDACTED);
    });
  }

  test("redacts a GitHub token inside a push URL", () => {
    const redacted = redactSecrets(
      "git push https://ghp_abcdefghijklmnopqrstuvwxyz0123456789@github.com/x/y",
    );

    expect(redacted).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz0123456789");
    expect(redacted).toContain(REDACTED);
  });

  test("redacts a fine-grained GitHub PAT", () => {
    const redacted = redactSecrets(
      "export T=github_pat_11ABCDEFG0abcdefghij_KLMNOPQRSTUVWXYZ0123456789abcdefghijKLMNOP",
    );

    expect(redacted).not.toContain("github_pat_11ABCDEFG0");
    expect(redacted).toContain(REDACTED);
  });

  test("redacts a private key block", () => {
    const key = [
      "-----BEGIN OPENSSH PRIVATE KEY-----",
      "b3BlbnNzaC1rZXktdjEAAAAA",
      "-----END OPENSSH PRIVATE KEY-----",
    ].join("\n");

    expect(redactSecrets(`echo '${key}'`)).not.toContain(
      "b3BlbnNzaC1rZXktdjEAAAAA",
    );
    expect(
      redactSecrets(
        "-----BEGIN RSA PRIVATE KEY-----\nMIIEow==\n-----END RSA PRIVATE KEY-----",
      ),
    ).toBe(REDACTED);
  });

  test("redacts long opaque tokens with no separator", () => {
    const token = "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f6";

    expect(redactSecrets(`curl -d ${token}`)).not.toContain(token);
  });
});

describe("redactSecrets — length bound", () => {
  test("truncates a very long value so the summary stays a summary", () => {
    const redacted = redactSecrets("ab/".repeat(MAX_REDACTED_TEXT_LENGTH));

    expect(redacted.length).toBeLessThanOrEqual(MAX_REDACTED_TEXT_LENGTH);
    expect(redacted).toContain("truncated");
  });

  test("keeps a value at exactly the bound verbatim", () => {
    const value = "b/".repeat(MAX_REDACTED_TEXT_LENGTH / 2);

    expect(redactSecrets(value)).toBe(value);
  });

  test("redacts before truncating, so no credential survives as a fragment", () => {
    const token = `ghp_${"a".repeat(40)}`;
    const redacted = redactSecrets(
      `${token} ${"src/a/b/c.ts ".repeat(MAX_REDACTED_TEXT_LENGTH)}`,
    );

    expect(redacted).not.toContain("ghp_aaaa");
    expect(redacted).toContain(REDACTED);
  });
});

describe("redactSecrets — idempotence", () => {
  const cases = [
    "ls -la apps/web",
    "export AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY",
    'curl -H "Authorization: Bearer abcdef123456" https://example.com',
    "git clone https://alice:hunter2secret@github.com/x/y.git",
    "gh auth login --token hunter2supersecret",
    "echo ghp_0123456789abcdefghijklmnopqrstuvwxyz",
    "ls " + "src/a/b/c.ts ".repeat(400),
  ];

  for (const value of cases) {
    test(`a string that has already been redacted is not re-processed: ${value.slice(0, 24)}…`, () => {
      const once = redactSecrets(value);

      expect(redactSecrets(once)).toBe(once);
    });
  }

  test("the truncation marker is not truncated a second time", () => {
    const once = redactSecrets("ab/".repeat(MAX_REDACTED_TEXT_LENGTH));

    expect(redactSecrets(once)).toBe(once);
    expect(once.length).toBeLessThanOrEqual(MAX_REDACTED_TEXT_LENGTH);
  });

  test("the placeholder itself survives another pass unchanged", () => {
    expect(redactSecrets(REDACTED)).toBe(REDACTED);
    expect(redactSecrets(`API_TOKEN=${REDACTED}`)).toBe(
      `API_TOKEN=${REDACTED}`,
    );
  });
});
