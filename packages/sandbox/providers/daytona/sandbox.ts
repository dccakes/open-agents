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

const REDACTED_VALUE = "[REDACTED]";
const CONNECTION_URL_ENV_KEYS = new Set(["POSTGRES_URL", "DATABASE_URL"]);
const SENSITIVE_ENV_KEY_PATTERN =
  /(^|_)(TOKEN|PASSWORD|SECRET|API_KEY|PRIVATE_KEY)(_|$)/;
const DAYTONA_PROVIDER_AUTH_ENV_KEYS = new Set([
  "DAYTONA_API_KEY",
  "DAYTONA_SERVER_URL",
]);

function quoteForShell(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function getRequiredEnv(
  name: "DAYTONA_API_KEY" | "DAYTONA_SERVER_URL",
  env?: Record<string, string>,
): string {
  const value = env?.[name] ?? process.env[name];
  if (!value) {
    throw new Error(`${name} environment variable is not set`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isSensitiveEnvKey(key: string): boolean {
  const upperKey = key.toUpperCase();
  return (
    CONNECTION_URL_ENV_KEYS.has(upperKey) ||
    SENSITIVE_ENV_KEY_PATTERN.test(upperKey)
  );
}

function extractConnectionUrlPassword(value: string): string[] {
  const passwords: string[] = [];
  const directMatch = value.match(
    /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^:/?#\s]+:([^@/?#\s]+)@/,
  );

  if (directMatch?.[1]) {
    passwords.push(directMatch[1]);
    try {
      const decoded = decodeURIComponent(directMatch[1]);
      if (decoded !== directMatch[1]) {
        passwords.push(decoded);
      }
    } catch {
      // Keep deterministic behavior; ignore malformed escapes.
    }
  }

  return passwords;
}

function getSensitiveValues(options?: ConnectOptions): string[] {
  const values = new Set<string>();

  if (options?.githubToken) {
    values.add(options.githubToken);
  }

  if (!options?.env) {
    return [...values];
  }

  for (const [key, value] of Object.entries(options.env)) {
    if (!value || !isSensitiveEnvKey(key)) {
      continue;
    }

    values.add(value);

    if (CONNECTION_URL_ENV_KEYS.has(key.toUpperCase())) {
      for (const password of extractConnectionUrlPassword(value)) {
        values.add(password);
      }
    }
  }

  return [...values]
    .filter((value) => value.length > 0)
    .sort(
      (left, right) => right.length - left.length || left.localeCompare(right),
    );
}

function redactSensitiveValues(
  value: string,
  sensitiveValues: string[],
): string {
  if (!value || sensitiveValues.length === 0) {
    return value;
  }

  let redacted = value;
  for (const sensitiveValue of sensitiveValues) {
    redacted = redacted.split(sensitiveValue).join(REDACTED_VALUE);
  }

  return redacted;
}

function getWorkspaceEnv(
  env: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!env) {
    return undefined;
  }

  const runtimeEnv = Object.fromEntries(
    Object.entries(env).filter(
      ([key]) => !DAYTONA_PROVIDER_AUTH_ENV_KEYS.has(key),
    ),
  );

  return Object.keys(runtimeEnv).length > 0 ? runtimeEnv : undefined;
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
    getPreviewLink: getPreviewLink.bind(
      value,
    ) as DaytonaWorkspace["getPreviewLink"],
    stop: stop.bind(value) as DaytonaWorkspace["stop"],
  };
}

/**
 * Held indirectly so bundlers and `tsc` do not resolve the specifier.
 *
 * The Daytona provider is a stub and `@daytonaio/sdk` is intentionally not
 * installed, but `providers/daytona` is registered eagerly from
 * `packages/sandbox/index.ts`. A literal specifier therefore fails every
 * consumer's build and typecheck, even though the import only runs when a
 * Daytona sandbox is actually created.
 */
const DAYTONA_SDK_SPECIFIER = "@daytonaio/sdk";

async function importDaytonaSdk(): Promise<unknown> {
  try {
    return await import(DAYTONA_SDK_SPECIFIER);
  } catch (error) {
    throw new Error(
      "@daytonaio/sdk is not installed. Add it to use Daytona sandboxes.",
      { cause: error },
    );
  }
}

async function loadDaytonaClient(
  options?: ConnectOptions,
): Promise<DaytonaClient> {
  const daytonaModule: unknown = await importDaytonaSdk();

  const ctorCandidate =
    isRecord(daytonaModule) && "Daytona" in daytonaModule
      ? daytonaModule.Daytona
      : isRecord(daytonaModule) && "default" in daytonaModule
        ? daytonaModule.default
        : undefined;

  if (typeof ctorCandidate !== "function") {
    throw new Error(
      "@daytonaio/sdk does not export a Daytona client constructor",
    );
  }

  const DaytonaClientConstructor = ctorCandidate as DaytonaConstructor;

  return new DaytonaClientConstructor({
    apiKey: getRequiredEnv("DAYTONA_API_KEY", options?.env),
    serverUrl: getRequiredEnv("DAYTONA_SERVER_URL", options?.env),
  });
}

export class DaytonaSandbox implements Sandbox {
  readonly type = "daytona" as const;
  readonly workingDirectory = "/home/daytona/workspace";
  readonly env?: Record<string, string>;
  readonly hooks?: SandboxHooks;

  private readonly state: DaytonaState;
  private readonly sensitiveValues: string[];

  constructor(
    private readonly workspace: DaytonaWorkspace,
    state: DaytonaState,
    options?: ConnectOptions,
  ) {
    this.env = getWorkspaceEnv(options?.env);
    this.hooks = options?.hooks;
    this.state = {
      workspaceId: state.workspaceId ?? workspace.id,
      workspaceName: state.workspaceName,
    };
    this.sensitiveValues = getSensitiveValues(options);
  }

  static async create(
    state: DaytonaState,
    options?: ConnectOptions,
  ): Promise<DaytonaSandbox> {
    const client = await loadDaytonaClient(options);
    const rawWorkspace = await client.create({
      id: state.workspaceId,
      name: state.workspaceName,
      env: getWorkspaceEnv(options?.env),
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

    const client = await loadDaytonaClient(options);
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
    let result: DaytonaCommandResult;
    try {
      result = await this.workspace.process.executeCommand(command, {
        timeout,
        cwd,
      });
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(
          redactSensitiveValues(error.message, this.sensitiveValues),
          { cause: error },
        );
      }

      throw new Error(
        redactSensitiveValues(String(error), this.sensitiveValues),
        { cause: error },
      );
    }

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
    const stderr = typeof result.stderr === "string" ? result.stderr : "";

    return {
      success: exitCode === 0,
      exitCode,
      stdout: redactSensitiveValues(stdout, this.sensitiveValues),
      stderr: redactSensitiveValues(stderr, this.sensitiveValues),
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

  async readFileBuffer(path: string): Promise<Buffer> {
    const result = await this.exec(
      `base64 ${quoteForShell(path)}`,
      this.workingDirectory,
      10_000,
    );

    if (!result.success) {
      throw new Error(`Failed to read file: ${path}`);
    }

    return Buffer.from(result.stdout, "base64");
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
