import { describe, expect, mock, test } from "bun:test";
import Docker from "dockerode";
import type { ExecResult } from "../../interface";
import { DockerSandbox } from "./sandbox";

const FAKE_CONTAINER_ID = "docker-123";
const MAPPED_PORT = 54321;

function encodeDockerStdout(payload: string): Buffer {
  const data = Buffer.from(payload, "utf-8");
  const header = Buffer.alloc(8);
  header[0] = 1;
  header.writeUInt32BE(data.length, 4);
  return Buffer.concat([header, data]);
}

function makeMockContainer() {
  const execInspect = mock(async () => ({ ExitCode: 0 }));
  const execStart = mock(
    (
      _options: { hijack: boolean; stdin: boolean },
      callback: (
        error: Error | null,
        stream: {
          on(event: "data", handler: (chunk: Buffer) => void): unknown;
          on(event: "end", handler: () => void): unknown;
          on(event: "error", handler: (error: Error) => void): unknown;
          resume(): void;
        },
      ) => void,
    ) => {
      let onData: ((chunk: Buffer) => void) | undefined;
      let onEnd: (() => void) | undefined;
      let onError: ((error: Error) => void) | undefined;

      const stream = {
        on(event: "data" | "end" | "error", handler: unknown) {
          if (event === "data") {
            onData = handler as (chunk: Buffer) => void;
          } else if (event === "end") {
            onEnd = handler as () => void;
          } else {
            onError = handler as (error: Error) => void;
          }
          return stream;
        },
        resume() {
          try {
            onData?.(encodeDockerStdout("hello from docker\n"));
            onEnd?.();
          } catch (error) {
            const err =
              error instanceof Error
                ? error
                : new Error("Unknown stream error");
            onError?.(err);
          }
        },
      };

      callback(null, stream);
    },
  );

  const containerExec = mock(async () => ({
    start: execStart,
    inspect: execInspect,
  }));

  return {
    id: FAKE_CONTAINER_ID,
    start: mock(async () => {}),
    stop: mock(async () => {}),
    remove: mock(async (_options?: { force?: boolean }) => {}),
    inspect: mock(async () => ({
      NetworkSettings: {
        Ports: { "3000/tcp": [{ HostPort: String(MAPPED_PORT) }] },
      },
    })),
    exec: containerExec,
    mocks: {
      containerExec,
      execStart,
      execInspect,
    },
  };
}

function mockDockerUnavailable() {
  const dockerPrototype = Docker.prototype as unknown as {
    ping: unknown;
    createContainer: unknown;
    getContainer: unknown;
  };

  const originalPing = dockerPrototype.ping;
  const originalCreateContainer = dockerPrototype.createContainer;
  const originalGetContainer = dockerPrototype.getContainer;

  const pingMock = mock(async () => {
    throw new Error("docker unavailable");
  });
  const createContainerMock = mock(async () => {
    throw new Error("createContainer should not be called");
  });
  const getContainerMock = mock(() => {
    throw new Error("getContainer should not be called");
  });

  dockerPrototype.ping = pingMock;
  dockerPrototype.createContainer = createContainerMock;
  dockerPrototype.getContainer = getContainerMock;

  return {
    pingMock,
    createContainerMock,
    getContainerMock,
    restore() {
      dockerPrototype.ping = originalPing;
      dockerPrototype.createContainer = originalCreateContainer;
      dockerPrototype.getContainer = originalGetContainer;
    },
  };
}

describe("DockerSandbox", () => {
  test("create() returns actionable Docker Engine/Desktop guidance when daemon is unavailable", async () => {
    const unavailable = mockDockerUnavailable();

    try {
      await expect(DockerSandbox.create({})).rejects.toThrow(
        /Docker Engine is not reachable.*Docker Desktop/,
      );
      expect(unavailable.pingMock).toHaveBeenCalledTimes(1);
      expect(unavailable.createContainerMock).not.toHaveBeenCalled();
    } finally {
      unavailable.restore();
    }
  });

  test("connect() returns actionable Docker Engine/Desktop guidance when daemon is unavailable", async () => {
    const unavailable = mockDockerUnavailable();

    try {
      await expect(
        DockerSandbox.connect({ containerId: FAKE_CONTAINER_ID }),
      ).rejects.toThrow(/Docker Engine is not reachable.*Docker Desktop/);
      expect(unavailable.pingMock).toHaveBeenCalledTimes(1);
      expect(unavailable.getContainerMock).not.toHaveBeenCalled();
    } finally {
      unavailable.restore();
    }
  });

  test("exec runs command and returns stdout", async () => {
    const mockContainer = makeMockContainer();
    const sandbox = new DockerSandbox(mockContainer as never, {
      containerId: FAKE_CONTAINER_ID,
      portBindings: { 3000: MAPPED_PORT },
    });

    const result: ExecResult = await sandbox.exec("echo hello", "/", 5_000);

    expect(mockContainer.mocks.containerExec).toHaveBeenCalledWith(
      expect.objectContaining({
        Cmd: ["sh", "-c", "echo hello"],
        WorkingDir: "/",
      }),
    );
    expect(result.exitCode).toBe(0);
    expect(result.success).toBe(true);
    expect(result.stdout).toContain("hello from docker");
  });

  test("domain() returns localhost with mapped host port", () => {
    const mockContainer = makeMockContainer();
    const sandbox = new DockerSandbox(mockContainer as never, {
      containerId: FAKE_CONTAINER_ID,
      portBindings: { 3000: MAPPED_PORT },
    });

    expect(sandbox.domain(3000)).toBe(`localhost:${MAPPED_PORT}`);
    expect(sandbox.domain(5173)).toBe("localhost:5173");
  });
});
