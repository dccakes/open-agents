import { describe, expect, mock, test } from "bun:test";
import { DockerPostgresProvisioner } from "./docker-postgres";

function createMockContainer() {
  return {
    id: "container-123",
    start: mock(async () => {}),
    stop: mock(async () => {}),
    remove: mock(async (_options?: { force?: boolean; v?: boolean }) => {}),
    inspect: mock(async () => ({
      Id: "container-123",
      NetworkSettings: {
        Ports: {
          "5432/tcp": [{ HostPort: "49123" }],
        },
      },
    })),
  };
}

describe("DockerPostgresProvisioner", () => {
  test("provision creates postgres container and returns localhost connection + teardown metadata", async () => {
    const container = createMockContainer();
    const ping = mock(async () => ({}));
    const createContainer = mock(async () => container);

    const provisioner = new DockerPostgresProvisioner({
      dockerFactory: async () => {
        return {
          ping,
          createContainer,
          getContainer: mock((_id: string) => container),
        };
      },
      randomPassword: () => "p@ss:/word",
    });

    const result = await provisioner.provision("Session-42");

    expect(ping).toHaveBeenCalledTimes(1);
    expect(createContainer).toHaveBeenCalledTimes(1);
    expect(createContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        Image: "postgres:16-alpine",
        ExposedPorts: { "5432/tcp": {} },
        HostConfig: {
          PortBindings: {
            "5432/tcp": [{ HostPort: "" }],
          },
        },
      }),
    );
    expect(result.postgresUrl).toBe(
      "postgresql://postgres:p%40ss%3A%2Fword@localhost:49123/session_session_42",
    );
    expect(result.teardownMetadata).toEqual({
      provider: "docker-postgres",
      identifier: "container-123",
    });
    expect(container.start).toHaveBeenCalledTimes(1);
    expect(container.inspect).toHaveBeenCalledTimes(1);
  });

  test("teardown best-effort stops then removes container", async () => {
    const stop = mock(async () => {
      throw new Error("already stopped");
    });
    const remove = mock(
      async (_options?: { force?: boolean; v?: boolean }) => {},
    );
    const container = {
      ...createMockContainer(),
      stop,
      remove,
    };

    const getContainer = mock((_id: string) => container);
    const provisioner = new DockerPostgresProvisioner({
      dockerFactory: async () => {
        return {
          ping: mock(async () => ({})),
          createContainer: mock(async () => container),
          getContainer,
        };
      },
    });

    await expect(
      provisioner.teardown({
        provider: "docker-postgres",
        identifier: "container-123",
      }),
    ).resolves.toBeUndefined();

    expect(getContainer).toHaveBeenCalledWith("container-123");
    expect(stop).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith({ force: true, v: true });
  });
});
