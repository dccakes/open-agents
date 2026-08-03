import type {
  DbProvisioner,
  DbProvisionResult,
  DbTeardownMetadata,
} from "../db-provisioner";
import { randomBytes } from "node:crypto";
import { getSandboxDbProvisionerConfig } from "@/lib/config/sandbox";

const POSTGRES_IMAGE =
  getSandboxDbProvisionerConfig().dockerPostgresImage ?? "postgres:16-alpine";
const POSTGRES_USER =
  getSandboxDbProvisionerConfig().dockerPostgresUser ?? "postgres";

interface DockerInspectPortBinding {
  HostPort?: string;
}

interface DockerContainerInspectResult {
  Id?: string;
  NetworkSettings?: {
    Ports?: Record<string, DockerInspectPortBinding[] | null>;
  };
}

interface DockerContainerLike {
  id?: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  remove(options?: { force?: boolean; v?: boolean }): Promise<void>;
  inspect(): Promise<unknown>;
}

interface DockerContainerCreateOptions {
  Image: string;
  name: string;
  Env: string[];
  ExposedPorts: Record<string, Record<string, never>>;
  HostConfig: {
    PortBindings: Record<string, Array<{ HostPort: string }>>;
  };
}

interface DockerLike {
  ping(): Promise<unknown>;
  createContainer(
    options: DockerContainerCreateOptions,
  ): Promise<DockerContainerLike>;
  getContainer(containerId: string): DockerContainerLike;
}

interface DockerPostgresProvisionerDeps {
  dockerFactory?: () => Promise<DockerLike>;
  randomPassword?: () => string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseInspectResult(
  value: unknown,
): DockerContainerInspectResult | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = typeof value.Id === "string" ? value.Id : undefined;
  const networkSettings = isRecord(value.NetworkSettings)
    ? value.NetworkSettings
    : undefined;
  const ports = isRecord(networkSettings?.Ports)
    ? networkSettings.Ports
    : undefined;

  const parsedPorts: Record<string, DockerInspectPortBinding[] | null> = {};
  if (ports) {
    for (const [key, binding] of Object.entries(ports)) {
      parsedPorts[key] = Array.isArray(binding)
        ? binding.filter((entry) => {
            return isRecord(entry) && typeof entry.HostPort === "string";
          })
        : null;
    }
  }

  return {
    Id: id,
    NetworkSettings: {
      Ports: parsedPorts,
    },
  };
}

function extractHostPort(inspectResult: unknown): string | null {
  const parsed = parseInspectResult(inspectResult);
  const portBindings = parsed?.NetworkSettings?.Ports?.["5432/tcp"];
  if (!portBindings || portBindings.length === 0) {
    return null;
  }

  return portBindings[0]?.HostPort ?? null;
}

function buildPostgresDbName(sessionId: string): string {
  const normalized = sessionId
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "_")
    .replaceAll(/^_+|_+$/g, "")
    .slice(0, 40);

  const suffix = normalized.length > 0 ? normalized : "session";
  return `session_${suffix}`;
}

function buildContainerName(sessionId: string): string {
  const normalized = sessionId
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "")
    .slice(0, 30);

  const suffix = normalized.length > 0 ? normalized : "session";
  const nonce = Date.now().toString(36);
  return `open-agents-postgres-${suffix}-${nonce}`;
}

function defaultRandomPassword(): string {
  return randomBytes(18).toString("base64url");
}

async function defaultDockerFactory(): Promise<DockerLike> {
  // webpackIgnore: true prevents webpack from resolving/bundling this at build time.
  // dockerode is only needed at runtime when the docker provider is active (local dev only).
  const dockerModule = await import(/* webpackIgnore: true */ "dockerode");
  const DockerCtor = dockerModule.default as { new (): DockerLike };
  return new DockerCtor();
}

export class DockerPostgresProvisioner implements DbProvisioner {
  private readonly dockerFactory: () => Promise<DockerLike>;
  private readonly randomPassword: () => string;

  constructor(deps?: DockerPostgresProvisionerDeps) {
    this.dockerFactory = deps?.dockerFactory ?? defaultDockerFactory;
    this.randomPassword = deps?.randomPassword ?? defaultRandomPassword;
  }

  async provision(sessionId: string): Promise<DbProvisionResult> {
    const docker = await this.dockerFactory();

    try {
      await docker.ping();
    } catch {
      throw new Error(
        "Docker Engine is not reachable. Ensure Docker Desktop (or Docker daemon) is running before provisioning Postgres.",
      );
    }

    const password = this.randomPassword();
    const dbName = buildPostgresDbName(sessionId);

    const container = await docker.createContainer({
      Image: POSTGRES_IMAGE,
      name: buildContainerName(sessionId),
      Env: [
        `POSTGRES_USER=${POSTGRES_USER}`,
        `POSTGRES_PASSWORD=${password}`,
        `POSTGRES_DB=${dbName}`,
      ],
      ExposedPorts: {
        "5432/tcp": {},
      },
      HostConfig: {
        PortBindings: {
          "5432/tcp": [{ HostPort: "" }],
        },
      },
    });

    await container.start();
    const inspectResult = await container.inspect();
    const hostPort = extractHostPort(inspectResult);

    if (!hostPort) {
      throw new Error(
        "Docker Postgres container did not expose port 5432 to the host.",
      );
    }

    const parsedInspect = parseInspectResult(inspectResult);
    const containerId = container.id ?? parsedInspect?.Id;
    if (!containerId) {
      throw new Error(
        "Docker Postgres container did not return an identifier.",
      );
    }

    return {
      postgresUrl: `postgresql://${POSTGRES_USER}:${encodeURIComponent(password)}@localhost:${hostPort}/${dbName}`,
      teardownMetadata: {
        provider: "docker-postgres",
        identifier: containerId,
      },
    };
  }

  async teardown(metadata: DbTeardownMetadata): Promise<void> {
    if (metadata.provider !== "docker-postgres") {
      return;
    }

    let docker: DockerLike;
    try {
      docker = await this.dockerFactory();
    } catch (error) {
      console.error(
        "Failed to initialize Docker client for DB teardown:",
        error,
      );
      return;
    }

    let container: DockerContainerLike;
    try {
      container = docker.getContainer(metadata.identifier);
    } catch (error) {
      console.error(
        `Failed to lookup Docker Postgres container ${metadata.identifier}:`,
        error,
      );
      return;
    }

    try {
      await container.stop();
    } catch (error) {
      console.error(
        `Failed to stop Docker Postgres container ${metadata.identifier}:`,
        error,
      );
    }

    try {
      await container.remove({ force: true, v: true });
    } catch (error) {
      console.error(
        `Failed to remove Docker Postgres container ${metadata.identifier}:`,
        error,
      );
    }
  }
}
