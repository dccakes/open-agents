import type { SandboxProviderType } from "@open-agents/sandbox";
import { DockerPostgresProvisioner } from "./provisioners/docker-postgres";
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

export function getDbProvisioner(
  providerType: SandboxProviderType,
): DbProvisioner | null {
  if (providerType === "vercel" || providerType === "daytona") {
    return new NeonProvisioner();
  }

  if (providerType === "docker") {
    return new DockerPostgresProvisioner();
  }

  return null;
}
