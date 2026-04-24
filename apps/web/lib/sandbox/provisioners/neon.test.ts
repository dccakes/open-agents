import { describe, expect, mock, test } from "bun:test";
import { NeonProvisioner } from "./neon";

describe("NeonProvisioner", () => {
  test("provision creates a Neon branch and returns connection URL", async () => {
    const createBranch = mock(async () => ({
      data: {
        branch: { id: "br-test-123" },
        connection_uris: [{ connection_uri: "postgres://user:pass@host/db" }],
      },
    }));

    const provisioner = new NeonProvisioner({
      neonClient: { createProjectBranch: createBranch } as never,
      projectId: "proj-123",
    });

    const result = await provisioner.provision("session-abc");

    expect(createBranch).toHaveBeenCalledWith(
      "proj-123",
      expect.objectContaining({ branch: { name: "session-session-abc" } }),
    );
    expect(result.postgresUrl).toBe("postgres://user:pass@host/db");
    expect(result.teardownMetadata).toEqual({
      provider: "neon",
      identifier: "br-test-123",
    });
  });

  test("teardown deletes the Neon branch", async () => {
    const deleteBranch = mock(async () => ({}));
    const provisioner = new NeonProvisioner({
      neonClient: { deleteProjectBranch: deleteBranch } as never,
      projectId: "proj-123",
    });

    await provisioner.teardown({ provider: "neon", identifier: "br-test-123" });

    expect(deleteBranch).toHaveBeenCalledWith("proj-123", "br-test-123");
  });
});
