import { describe, expect, mock, test } from "bun:test";
import { DaytonaSandbox } from "./sandbox";

describe("DaytonaSandbox redaction", () => {
  test("redacts githubToken from thrown exec errors", async () => {
    const githubToken = "ghp_super_secret_token";
    const executeCommand = mock(async () => {
      throw new Error(`Authorization failed for token ${githubToken}`);
    });

    const sandbox = new DaytonaSandbox(
      {
        id: "ws-123",
        process: { executeCommand },
        getPreviewLink: mock(async () => ({ url: "https://example.test" })),
        stop: mock(async () => {}),
      },
      { workspaceId: "ws-123" },
      { githubToken },
    );

    const thrown = await sandbox
      .exec("echo test", "/", 1_000)
      .then(() => undefined)
      .catch((error) => error);

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toContain("[REDACTED]");
    expect((thrown as Error).message).not.toContain(githubToken);
  });

  test("redacts DB password from stdout/stderr using POSTGRES_URL", async () => {
    const password = "db_password_123";
    const executeCommand = mock(async () => ({
      code: 0,
      stdout: `connected with password=${password}`,
      stderr: `warn: password was ${password}`,
    }));

    const sandbox = new DaytonaSandbox(
      {
        id: "ws-123",
        process: { executeCommand },
        getPreviewLink: mock(async () => ({ url: "https://example.test" })),
        stop: mock(async () => {}),
      },
      { workspaceId: "ws-123" },
      {
        env: {
          POSTGRES_URL: `postgresql://postgres:${password}@localhost:5432/app`,
        },
      },
    );

    const result = await sandbox.exec("echo test", "/", 1_000);

    expect(result.stdout).toContain("[REDACTED]");
    expect(result.stderr).toContain("[REDACTED]");
    expect(result.stdout).not.toContain(password);
    expect(result.stderr).not.toContain(password);
  });
});
