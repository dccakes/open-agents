import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { ExecResult } from "../../interface";
import { DaytonaSandbox } from "./sandbox";

const daytonaConstructorMock = mock(
  (_config: { apiKey: string; serverUrl?: string }) => mockDaytonaClient,
);
const createMock = mock(async () => mockWorkspace());
const getMock = mock(async () => mockWorkspace());
const startMock = mock(async () => {});

const mockDaytonaClient = {
  create: createMock,
  get: getMock,
  start: startMock,
};

function mockWorkspace() {
  return {
    id: "ws-daytona",
    process: {
      executeCommand: mock(async () => ({
        code: 0,
        result: "",
      })),
    },
    getPreviewLink: mock(async () => ({
      url: "https://3000.ws-daytona.daytona.example.com",
    })),
    stop: mock(async () => {}),
  };
}

mock.module("@daytonaio/sdk", () => ({
  Daytona: function Daytona(config: { apiKey: string; serverUrl?: string }) {
    return daytonaConstructorMock(config);
  },
}));

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

    const sandbox = new DaytonaSandbox(mockWorkspace, {
      workspaceId: "ws-123",
    });

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

    const sandbox = new DaytonaSandbox(mockWorkspace, {
      workspaceId: "ws-123",
    });

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

describe("DaytonaSandbox credential precedence", () => {
  const originalApiKey = process.env.DAYTONA_API_KEY;
  const originalServerUrl = process.env.DAYTONA_SERVER_URL;

  beforeEach(() => {
    daytonaConstructorMock.mockClear();
    createMock.mockClear();
    getMock.mockClear();
    startMock.mockClear();
    delete process.env.DAYTONA_API_KEY;
    delete process.env.DAYTONA_SERVER_URL;
  });

  afterEach(() => {
    if (originalApiKey === undefined) {
      delete process.env.DAYTONA_API_KEY;
    } else {
      process.env.DAYTONA_API_KEY = originalApiKey;
    }

    if (originalServerUrl === undefined) {
      delete process.env.DAYTONA_SERVER_URL;
    } else {
      process.env.DAYTONA_SERVER_URL = originalServerUrl;
    }
  });

  test("creates sandbox using DAYTONA_* values from options.env when process env is unset", async () => {
    await DaytonaSandbox.create(
      {
        workspaceId: "ws-daytona",
      },
      {
        env: {
          DAYTONA_API_KEY: "options-api-key",
          DAYTONA_SERVER_URL: "https://daytona.from-options.example.com",
        },
      },
    );

    expect(daytonaConstructorMock).toHaveBeenCalledWith({
      apiKey: "options-api-key",
      serverUrl: "https://daytona.from-options.example.com",
    });
  });

  test("does not pass DAYTONA_* provider credentials into workspace runtime env", async () => {
    const sandbox = await DaytonaSandbox.create(
      {
        workspaceId: "ws-daytona",
      },
      {
        env: {
          DAYTONA_API_KEY: "options-api-key",
          DAYTONA_SERVER_URL: "https://daytona.from-options.example.com",
          APP_REGION: "eu-west-1",
        },
      },
    );

    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        env: {
          APP_REGION: "eu-west-1",
        },
      }),
    );
    expect(sandbox.env).toEqual({
      APP_REGION: "eu-west-1",
    });
  });

  test("connect prefers options.env DAYTONA_* values over process env", async () => {
    process.env.DAYTONA_API_KEY = "process-api-key";
    process.env.DAYTONA_SERVER_URL = "https://daytona.from-process.example.com";

    await DaytonaSandbox.connect(
      {
        workspaceId: "ws-daytona",
      },
      {
        env: {
          DAYTONA_API_KEY: "options-api-key",
          DAYTONA_SERVER_URL: "https://daytona.from-options.example.com",
        },
      },
    );

    expect(daytonaConstructorMock).toHaveBeenCalledWith({
      apiKey: "options-api-key",
      serverUrl: "https://daytona.from-options.example.com",
    });
  });

  test("throws clear error when DAYTONA_API_KEY is missing from options.env and process env", async () => {
    await expect(
      DaytonaSandbox.create(
        {
          workspaceId: "ws-daytona",
        },
        {
          env: {
            DAYTONA_SERVER_URL: "https://daytona.from-options.example.com",
          },
        },
      ),
    ).rejects.toThrow("DAYTONA_API_KEY environment variable is not set");
  });

  test("throws clear error when DAYTONA_SERVER_URL is missing from options.env and process env", async () => {
    await expect(
      DaytonaSandbox.create(
        {
          workspaceId: "ws-daytona",
        },
        {
          env: {
            DAYTONA_API_KEY: "options-api-key",
          },
        },
      ),
    ).rejects.toThrow("DAYTONA_SERVER_URL environment variable is not set");
  });
});
