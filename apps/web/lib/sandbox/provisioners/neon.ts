import type {
  DbProvisioner,
  DbProvisionResult,
  DbTeardownMetadata,
} from "../db-provisioner";
import { EndpointType, createApiClient } from "@neondatabase/api-client";

type NeonClient = ReturnType<typeof createApiClient>;

interface NeonProvisionerDeps {
  neonClient?: Pick<NeonClient, "createProjectBranch" | "deleteProjectBranch">;
  projectId?: string;
}

export class NeonProvisioner implements DbProvisioner {
  private readonly client: NeonProvisionerDeps["neonClient"];
  private readonly projectId: string;

  constructor(deps?: NeonProvisionerDeps) {
    this.projectId = deps?.projectId ?? process.env.NEON_PROJECT_ID ?? "";

    if (deps?.neonClient) {
      this.client = deps.neonClient;
      return;
    }

    const apiKey = process.env.NEON_API_KEY;
    if (!apiKey) {
      this.client = undefined;
      return;
    }

    this.client = createApiClient({ apiKey });
  }

  async provision(sessionId: string): Promise<DbProvisionResult> {
    if (!this.projectId) {
      throw new Error("NEON_PROJECT_ID is not configured");
    }

    if (!this.client) {
      throw new Error("NEON_API_KEY is not configured");
    }

    const { data } = await this.client.createProjectBranch(this.projectId, {
      branch: { name: `session-${sessionId}` },
      endpoints: [{ type: EndpointType.ReadWrite }],
    });

    const postgresUrl = data.connection_uris?.[0]?.connection_uri;
    if (!postgresUrl) {
      throw new Error("Neon did not return a connection URI");
    }

    return {
      postgresUrl,
      teardownMetadata: {
        provider: "neon",
        identifier: data.branch.id,
      },
    };
  }

  async teardown(metadata: DbTeardownMetadata): Promise<void> {
    if (!this.projectId || !this.client) {
      return;
    }

    if (metadata.provider !== "neon") {
      return;
    }

    try {
      await this.client.deleteProjectBranch(this.projectId, metadata.identifier);
    } catch (error) {
      console.error(`Failed to delete Neon branch ${metadata.identifier}:`, error);
    }
  }
}
