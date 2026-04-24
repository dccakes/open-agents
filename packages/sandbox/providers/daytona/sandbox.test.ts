import { describe, expect, mock, test } from "bun:test";
import type { ExecResult } from "../../interface";
import { DaytonaSandbox } from "./sandbox";

describe("DaytonaSandbox", () => {
  test("executes command through Daytona workspace API", async () => {
    const executeCommand = mock(async (_cmd: string) => ({
      code: 0,
      result: "hello world",
    }));

    const mockWorkspace = {
      id: "ws-123",
      process: { executeCommand },
      getPreviewLink: mock(
        async (_port: number) =>
          ({
            url: "https://3000.ws-123.daytona.example.com",
          }) as const,
      ),
      stop: mock(async () => {}),
    };

    const sandbox = new DaytonaSandbox(mockWorkspace, { workspaceId: "ws-123" });

    const result: ExecResult = await sandbox.exec("echo hello", "/", 10_000);

    expect(executeCommand).toHaveBeenCalledWith(
      "echo hello",
      expect.objectContaining({ timeout: 10 }),
    );
    expect(result.stdout).toBe("hello world");
    expect(result.exitCode).toBe(0);
    expect(result.success).toBe(true);
  });

  test("getPreviewUrl returns async preview URL", async () => {
    const mockWorkspace = {
      id: "ws-123",
      process: {
        executeCommand: mock(async () => ({
          code: 0,
          result: "",
        })),
      },
      getPreviewLink: mock(async (_port: number) => ({
        url: "https://3000.ws-123.daytona.example.com",
      })),
      stop: mock(async () => {}),
    };

    const sandbox = new DaytonaSandbox(mockWorkspace, { workspaceId: "ws-123" });

    const url = await sandbox.getPreviewUrl(3000);

    expect(url).toBe("https://3000.ws-123.daytona.example.com");
  });

  test("stop pauses workspace and preserves reconnect state", async () => {
    const stop = mock(async () => {});
    const mockWorkspace = {
      id: "ws-123",
      process: {
        executeCommand: mock(async () => ({
          code: 0,
          result: "",
        })),
      },
      getPreviewLink: mock(async (_port: number) => ({
        url: "https://3000.ws-123.daytona.example.com",
      })),
      stop,
    };

    const sandbox = new DaytonaSandbox(mockWorkspace, {
      workspaceId: "ws-reconnect",
      workspaceName: "daytona-reconnect",
    });

    await sandbox.stop();

    expect(stop).toHaveBeenCalledTimes(1);
    expect(sandbox.getState()).toEqual({
      workspaceId: "ws-reconnect",
      workspaceName: "daytona-reconnect",
    });
  });
});
