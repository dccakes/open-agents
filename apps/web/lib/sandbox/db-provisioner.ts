import type { SandboxProviderType } from "@open-agents/sandbox";
import { NeonProvisioner } from "./provisioners/neon";

export interface DbTeardownMetadata {
  provider: "neon" | "docker-postgres";
  identifier: string;
}

export interface DbProvisionResult {
  postgresUrl: string;
  teardownMetadata: DbTeardownMetadata;
}

export interface DbProvisioner {
  provision(sessionId: string): Promise<DbProvisionResult>;
  teardown(metadata: DbTeardownMetadata): Promise<void>;
}

export async function getDbProvisioner(
  providerType: SandboxProviderType,
): Promise<DbProvisioner | null> {
  if (providerType === "vercel" || providerType === "daytona") {
    return new NeonProvisioner();
  }

  if (providerType === "docker") {
    const { DockerPostgresProvisioner } =
      await import("./provisioners/docker-postgres");
    return new DockerPostgresProvisioner();
  }

  return null;
}
