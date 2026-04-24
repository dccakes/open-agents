import Docker from "dockerode";
import type { Dirent } from "fs";
import type { ConnectOptions } from "../../factory";
import type {
  ExecResult,
  Sandbox,
  SandboxHooks,
  SandboxStats,
} from "../../interface";
import type { DockerState } from "./state";

const SANDBOX_IMAGE =
  process.env.DOCKER_SANDBOX_IMAGE ?? "ghcr.io/open-agents/sandbox:latest";
const WORKING_DIRECTORY = "/workspace";
const DEFAULT_PORTS = [3000, 5173, 4321, 8000] as const;

interface DockerExecInspectResult {
  ExitCode?: number | null;
}

interface DockerExecStream {
  on(event: "data", listener: (chunk: Buffer) => void): DockerExecStream;
  on(event: "end", listener: () => void): DockerExecStream;
  on(event: "error", listener: (error: Error) => void): DockerExecStream;
  resume(): void;
}

interface DockerExecLike {
  inspect(): Promise<DockerExecInspectResult>;
  start(
    options: { hijack: boolean; stdin: boolean },
    callback: (error: Error | null, stream: DockerExecStream | null) => void,
  ): void;
}

interface DockerContainerLike {
  id?: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  remove(options?: { force?: boolean }): Promise<void>;
  inspect(): Promise<unknown>;
  exec(options: {
    Cmd: string[];
    WorkingDir: string;
    AttachStdout: true;
    AttachStderr: true;
  }): Promise<DockerExecLike>;
}

function quoteForShell(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function buildActionableDockerUnavailableError(
  mode: "create" | "connect",
): Error {
  const action =
    mode === "create"
      ? "creating a Docker-backed session"
      : "connecting to a Docker-backed session";
  return new Error(
    `Docker Engine is not reachable. Ensure Docker Desktop (or Docker daemon) is running before ${action}.`,
  );
}

function extractPortMapFromInspectResult(
  inspectResult: unknown,
): Record<number, number> {
  if (!isRecord(inspectResult)) {
    return {};
  }

  const networkSettings = inspectResult.NetworkSettings;
  if (!isRecord(networkSettings)) {
    return {};
  }

  const ports = networkSettings.Ports;
  if (!isRecord(ports)) {
    return {};
  }

  const bindings: Record<number, number> = {};
  for (const [portSpec, bindingValue] of Object.entries(ports)) {
    const containerPort = Number(portSpec.split("/")[0]);
    if (!Number.isFinite(containerPort)) {
      continue;
    }

    if (!Array.isArray(bindingValue) || bindingValue.length === 0) {
      continue;
    }

    const firstBinding = bindingValue[0];
    if (!isRecord(firstBinding)) {
      continue;
    }

    const hostPortValue = firstBinding.HostPort;
    if (typeof hostPortValue !== "string") {
      continue;
    }

    const hostPort = Number(hostPortValue);
    if (!Number.isFinite(hostPort)) {
      continue;
    }

    bindings[containerPort] = hostPort;
  }

  return bindings;
}

function parseDockerMuxBuffer(buffer: Buffer): {
  stdout: string;
  stderr: string;
  remainder: Buffer;
} {
  let offset = 0;
  let stdout = "";
  let stderr = "";

  while (offset + 8 <= buffer.length) {
    const streamType = buffer[offset];
    const payloadSize = buffer.readUInt32BE(offset + 4);
    const frameEnd = offset + 8 + payloadSize;

    if (frameEnd > buffer.length) {
      break;
    }

    const payload = buffer.subarray(offset + 8, frameEnd).toString("utf-8");
    if (streamType === 2) {
      stderr += payload;
    } else {
      stdout += payload;
    }

    offset = frameEnd;
  }

  if (offset === 0) {
    const looksLikeMuxHeader =
      buffer.length >= 8 &&
      (buffer[0] === 0 || buffer[0] === 1 || buffer[0] === 2) &&
      buffer[1] === 0 &&
      buffer[2] === 0 &&
      buffer[3] === 0;

    if (!looksLikeMuxHeader) {
      return {
        stdout: buffer.toString("utf-8"),
        stderr: "",
        remainder: Buffer.alloc(0),
      };
    }
  }

  return { stdout, stderr, remainder: buffer.subarray(offset) };
}

const DEFAULT_DOCKER_EXPIRES_MS = 24 * 60 * 60 * 1000; // 24 hours

export class DockerSandbox implements Sandbox {
  readonly type = "docker" as const;
  readonly workingDirectory = WORKING_DIRECTORY;
  readonly env?: Record<string, string>;
  readonly hooks?: SandboxHooks;

  private readonly state: DockerState;

  get expiresAt(): number | undefined {
    return this.state.expiresAt;
  }

  constructor(
    private readonly container: DockerContainerLike,
    state: DockerState,
    options?: ConnectOptions,
  ) {
    this.env = options?.env;
    this.hooks = options?.hooks;
    this.state = {
      containerId: state.containerId,
      sandboxId: state.sandboxId ?? state.containerId,
      portBindings: state.portBindings ?? {},
      expiresAt: state.expiresAt,
    };
  }

  static async create(
    state: DockerState,
    options?: ConnectOptions,
  ): Promise<DockerSandbox> {
    const docker = new Docker();
    try {
      await docker.ping();
    } catch {
      throw buildActionableDockerUnavailableError("create");
    }

    const requestedPorts =
      options?.ports && options.ports.length > 0
        ? options.ports
        : [...DEFAULT_PORTS];

    const exposedPorts: Record<string, Record<string, never>> = {};
    const portBindings: Record<string, Array<{ HostPort: string }>> = {};

    for (const port of requestedPorts) {
      const portKey = `${port}/tcp`;
      exposedPorts[portKey] = {};
      portBindings[portKey] = [{ HostPort: "" }];
    }

    let container: DockerContainerLike;
    try {
      container = (await docker.createContainer({
        Image: SANDBOX_IMAGE,
        WorkingDir: WORKING_DIRECTORY,
        Env: Object.entries(options?.env ?? {}).map(([key, value]) => {
          return `${key}=${value}`;
        }),
        ExposedPorts: exposedPorts,
        HostConfig: {
          PortBindings: portBindings,
        },
      })) as unknown as DockerContainerLike;

      await container.start();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown Docker error";
      throw new Error(
        `Failed to start Docker sandbox container using image "${SANDBOX_IMAGE}": ${message}`,
        { cause: error },
      );
    }

    const inspectResult = await container.inspect();
    const resolvedPortMap = extractPortMapFromInspectResult(inspectResult);
    const containerId = container.id ?? state.containerId;
    const expiresAt =
      Date.now() + (options?.timeout ?? DEFAULT_DOCKER_EXPIRES_MS);

    return new DockerSandbox(
      container,
      {
        containerId,
        sandboxId: containerId,
        portBindings: resolvedPortMap,
        expiresAt,
      },
      options,
    );
  }

  static async connect(
    state: DockerState,
    options?: ConnectOptions,
  ): Promise<DockerSandbox> {
    if (!state.containerId) {
      throw new Error("DockerState.containerId is required for connect()");
    }

    const docker = new Docker();
    try {
      await docker.ping();
    } catch {
      throw buildActionableDockerUnavailableError("connect");
    }

    const container = docker.getContainer(
      state.containerId,
    ) as unknown as DockerContainerLike;
    const inspectResult = await container.inspect();
    const resolvedPortMap = extractPortMapFromInspectResult(inspectResult);

    const expiresAt =
      Date.now() + (options?.timeout ?? DEFAULT_DOCKER_EXPIRES_MS);

    return new DockerSandbox(
      container,
      {
        containerId: state.containerId,
        sandboxId: state.containerId,
        portBindings:
          Object.keys(resolvedPortMap).length > 0
            ? resolvedPortMap
            : (state.portBindings ?? {}),
        expiresAt,
      },
      options,
    );
  }

  async exec(
    command: string,
    cwd: string,
    timeoutMs: number,
    options?: { signal?: AbortSignal },
  ): Promise<ExecResult> {
    const exec = await this.container.exec({
      Cmd: ["sh", "-c", command],
      WorkingDir: cwd || WORKING_DIRECTORY,
      AttachStdout: true,
      AttachStderr: true,
    });

    return await new Promise((resolve, reject) => {
      let completed = false;
      let stdout = "";
      let stderr = "";
      let remainder = Buffer.alloc(0);

      const timeoutId = setTimeout(() => {
        finish({
          success: false,
          exitCode: null,
          stdout,
          stderr: "Command timed out",
          truncated: true,
        });
      }, timeoutMs);

      const onAbort = () => {
        finish({
          success: false,
          exitCode: null,
          stdout,
          stderr: "Command aborted",
          truncated: false,
        });
      };

      const cleanup = () => {
        clearTimeout(timeoutId);
        if (options?.signal) {
          options.signal.removeEventListener("abort", onAbort);
        }
      };

      const finish = (result: ExecResult) => {
        if (completed) {
          return;
        }
        completed = true;
        cleanup();
        resolve(result);
      };

      const fail = (error: Error) => {
        if (completed) {
          return;
        }
        completed = true;
        cleanup();
        reject(error);
      };

      if (options?.signal?.aborted) {
        onAbort();
        return;
      }

      options?.signal?.addEventListener("abort", onAbort, { once: true });

      exec.start({ hijack: true, stdin: false }, (error, stream) => {
        if (error) {
          fail(error);
          return;
        }
        if (!stream) {
          fail(new Error("Docker exec stream was not provided"));
          return;
        }

        stream.on("data", (chunk: Buffer) => {
          remainder = Buffer.concat([remainder, chunk]);
          const parsed = parseDockerMuxBuffer(remainder);
          stdout += parsed.stdout;
          stderr += parsed.stderr;
          remainder = Buffer.from(parsed.remainder);
        });

        stream.on("error", (streamError: Error) => {
          fail(streamError);
        });

        stream.on("end", async () => {
          if (completed) {
            return;
          }

          if (remainder.length > 0) {
            stdout += remainder.toString("utf-8");
          }

          try {
            const inspectResult = await exec.inspect();
            const exitCode =
              typeof inspectResult.ExitCode === "number"
                ? inspectResult.ExitCode
                : null;

            finish({
              success: exitCode === 0,
              exitCode,
              stdout,
              stderr,
              truncated: false,
            });
          } catch (inspectError) {
            fail(
              inspectError instanceof Error
                ? inspectError
                : new Error("Failed to inspect Docker exec result"),
            );
          }
        });

        stream.resume();
      });
    });
  }

  async readFile(path: string, _encoding: "utf-8"): Promise<string> {
    const result = await this.exec(
      `cat ${quoteForShell(path)}`,
      this.workingDirectory,
      10_000,
    );

    if (!result.success) {
      throw new Error(`Failed to read file: ${path}`);
    }

    return result.stdout;
  }

  async writeFile(
    path: string,
    content: string,
    _encoding: "utf-8",
  ): Promise<void> {
    const encoded = Buffer.from(content, "utf-8").toString("base64");
    const result = await this.exec(
      `printf %s ${quoteForShell(encoded)} | base64 -d > ${quoteForShell(path)}`,
      this.workingDirectory,
      10_000,
    );

    if (!result.success) {
      throw new Error(`Failed to write file: ${path}`);
    }
  }

  async stat(path: string): Promise<SandboxStats> {
    const result = await this.exec(
      `stat -c '%F|%s|%Y' ${quoteForShell(path)}`,
      this.workingDirectory,
      5_000,
    );

    if (!result.success) {
      throw new Error(`Path not found: ${path}`);
    }

    const [kind, sizeValue, modifiedValue] = result.stdout.trim().split("|");
    if (!kind || !sizeValue || !modifiedValue) {
      throw new Error(`Unexpected stat output for path: ${path}`);
    }

    return {
      isDirectory: () => kind === "directory",
      isFile: () => kind === "regular file",
      size: Number(sizeValue),
      mtimeMs: Number(modifiedValue) * 1000,
    };
  }

  async access(path: string): Promise<void> {
    const result = await this.exec(
      `test -e ${quoteForShell(path)}`,
      this.workingDirectory,
      5_000,
    );

    if (!result.success) {
      throw new Error(`Path not accessible: ${path}`);
    }
  }

  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    const flag = options?.recursive ? "-p " : "";
    const result = await this.exec(
      `mkdir ${flag}${quoteForShell(path)}`,
      this.workingDirectory,
      5_000,
    );

    if (!result.success) {
      throw new Error(`Failed to create directory: ${path}`);
    }
  }

  async readdir(
    path: string,
    _options: { withFileTypes: true },
  ): Promise<Dirent[]> {
    const result = await this.exec(
      `find ${quoteForShell(path)} -maxdepth 1 -mindepth 1 -printf '%y %f\\n'`,
      this.workingDirectory,
      5_000,
    );

    if (!result.success) {
      throw new Error(`ENOENT: no such file or directory, scandir '${path}'`);
    }

    const output = result.stdout.trim();
    if (!output) {
      return [];
    }

    return output.split("\n").map((line) => {
      const [type, ...nameParts] = line.split(" ");
      const name = nameParts.join(" ");
      const isDir = type === "d";
      const isFile = type === "f";
      const isSymlink = type === "l";

      return {
        name,
        parentPath: path,
        path,
        isDirectory: () => isDir,
        isFile: () => isFile,
        isSymbolicLink: () => isSymlink,
        isBlockDevice: () => false,
        isCharacterDevice: () => false,
        isFIFO: () => false,
        isSocket: () => false,
      } as Dirent;
    });
  }

  domain(port: number): string {
    const mappedPort = this.state.portBindings?.[port];
    if (typeof mappedPort === "number" && Number.isFinite(mappedPort)) {
      return `localhost:${mappedPort}`;
    }
    return `localhost:${port}`;
  }

  async execDetached(
    command: string,
    cwd: string,
  ): Promise<{ commandId: string }> {
    const result = await this.exec(
      `nohup sh -c ${quoteForShell(command)} > /dev/null 2>&1 & echo $!`,
      cwd,
      10_000,
    );
    if (!result.success) {
      throw new Error(`Failed to launch background command: ${result.stderr}`);
    }
    return { commandId: result.stdout.trim() };
  }

  async stop(): Promise<void> {
    if (this.hooks?.beforeStop) {
      await this.hooks.beforeStop(this);
    }

    try {
      await this.container.stop();
    } catch {
      // Container may already be stopped/removed; proceed with removal.
    }

    try {
      await this.container.remove({ force: true });
    } catch {
      // Container may already be removed.
    }
  }

  getState(): { type: "docker" } & DockerState {
    return { type: "docker", ...this.state };
  }
}
