import type { Dirent } from "fs";
import type { ConnectOptions } from "../../factory";
import type {
  ExecResult,
  Sandbox,
  SandboxHooks,
  SandboxStats,
} from "../../interface";
import type { DaytonaState } from "./state";

interface DaytonaCommandResult {
  code?: number | null;
  exitCode?: number | null;
  result?: string;
  stdout?: string;
  stderr?: string;
}

interface DaytonaWorkspaceProcess {
  executeCommand(
    command: string,
    options?: { timeout?: number; cwd?: string },
  ): Promise<DaytonaCommandResult>;
}

interface DaytonaWorkspace {
  id: string;
  process: DaytonaWorkspaceProcess;
  getPreviewLink(port: number): Promise<{ url: string } | string>;
  stop(): Promise<void>;
}

interface DaytonaClient {
  create(options: {
    id?: string;
    name?: string;
    env?: Record<string, string>;
  }): Promise<unknown>;
  get(workspaceId: string): Promise<unknown>;
  start(workspace: unknown): Promise<void>;
}

type DaytonaConstructor = new (config: {
  apiKey: string;
  serverUrl?: string;
}) => DaytonaClient;

function quoteForShell(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function getRequiredEnv(name: "DAYTONA_API_KEY" | "DAYTONA_SERVER_URL"): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} environment variable is not set`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toDaytonaWorkspace(value: unknown): DaytonaWorkspace {
  if (!isRecord(value)) {
    throw new Error("Daytona SDK returned an invalid workspace payload");
  }

  const id = value.id;
  const process = value.process;
  const getPreviewLink = value.getPreviewLink;
  const stop = value.stop;

  if (typeof id !== "string") {
    throw new Error("Daytona workspace is missing an id");
  }

  if (!isRecord(process) || typeof process.executeCommand !== "function") {
    throw new Error("Daytona workspace is missing process.executeCommand()");
  }

  if (typeof getPreviewLink !== "function") {
    throw new Error("Daytona workspace is missing getPreviewLink()");
  }

  if (typeof stop !== "function") {
    throw new Error("Daytona workspace is missing stop()");
  }

  return {
    id,
    process: {
      executeCommand: process.executeCommand.bind(process),
    },
    getPreviewLink: getPreviewLink.bind(value) as DaytonaWorkspace["getPreviewLink"],
    stop: stop.bind(value) as DaytonaWorkspace["stop"],
  };
}

async function loadDaytonaClient(): Promise<DaytonaClient> {
  const daytonaModule: unknown = await import("@daytonaio/sdk");

  const ctorCandidate =
    isRecord(daytonaModule) && "Daytona" in daytonaModule
      ? daytonaModule.Daytona
      : isRecord(daytonaModule) && "default" in daytonaModule
        ? daytonaModule.default
        : undefined;

  if (typeof ctorCandidate !== "function") {
    throw new Error("@daytonaio/sdk does not export a Daytona client constructor");
  }

  const DaytonaClientConstructor = ctorCandidate as DaytonaConstructor;

  return new DaytonaClientConstructor({
    apiKey: getRequiredEnv("DAYTONA_API_KEY"),
    serverUrl: getRequiredEnv("DAYTONA_SERVER_URL"),
  });
}

export class DaytonaSandbox implements Sandbox {
  readonly type = "daytona" as const;
  readonly workingDirectory = "/home/daytona/workspace";
  readonly env?: Record<string, string>;
  readonly hooks?: SandboxHooks;

  private readonly state: DaytonaState;

  constructor(
    private readonly workspace: DaytonaWorkspace,
    state: DaytonaState,
    options?: ConnectOptions,
  ) {
    this.env = options?.env;
    this.hooks = options?.hooks;
    this.state = {
      workspaceId: state.workspaceId ?? workspace.id,
      workspaceName: state.workspaceName,
    };
  }

  static async create(
    state: DaytonaState,
    options?: ConnectOptions,
  ): Promise<DaytonaSandbox> {
    const client = await loadDaytonaClient();
    const rawWorkspace = await client.create({
      id: state.workspaceId,
      name: state.workspaceName,
      env: options?.env,
    });
    const workspace = toDaytonaWorkspace(rawWorkspace);

    return new DaytonaSandbox(
      workspace,
      {
        workspaceId: workspace.id,
        workspaceName: state.workspaceName,
      },
      options,
    );
  }

  static async connect(
    state: DaytonaState,
    options?: ConnectOptions,
  ): Promise<DaytonaSandbox> {
    if (!state.workspaceId) {
      throw new Error("DaytonaState.workspaceId is required for connect()");
    }

    const client = await loadDaytonaClient();
    const rawWorkspace = await client.get(state.workspaceId);
    await client.start(rawWorkspace);
    const workspace = toDaytonaWorkspace(rawWorkspace);

    return new DaytonaSandbox(
      workspace,
      {
        workspaceId: workspace.id,
        workspaceName: state.workspaceName,
      },
      options,
    );
  }

  async exec(
    command: string,
    cwd: string,
    timeoutMs: number,
  ): Promise<ExecResult> {
    const timeout = Math.max(1, Math.ceil(timeoutMs / 1000));
    const result = await this.workspace.process.executeCommand(command, {
      timeout,
      cwd,
    });

    const exitCode =
      typeof result.code === "number"
        ? result.code
        : typeof result.exitCode === "number"
          ? result.exitCode
          : null;

    const stdout =
      typeof result.result === "string"
        ? result.result
        : typeof result.stdout === "string"
          ? result.stdout
          : "";

    return {
      success: exitCode === 0,
      exitCode,
      stdout,
      stderr: typeof result.stderr === "string" ? result.stderr : "",
      truncated: false,
    };
  }

  async getPreviewUrl(port: number): Promise<string> {
    const link = await this.workspace.getPreviewLink(port);
    if (typeof link === "string") {
      return link;
    }

    if (!isRecord(link) || typeof link.url !== "string") {
      throw new Error(`Daytona preview URL is unavailable for port ${port}`);
    }

    return link.url;
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

  async stop(): Promise<void> {
    if (this.hooks?.beforeStop) {
      await this.hooks.beforeStop(this);
    }

    await this.workspace.stop();
  }

  getState(): DaytonaState {
    return this.state;
  }
}
