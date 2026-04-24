import { beforeEach, describe, expect, mock, test } from "bun:test";

type SandboxProviderType = "vercel" | "docker" | "daytona";

interface SandboxConfigRow {
  id: string;
  userId: string;
  providerType: SandboxProviderType;
  enabled: boolean;
  config: unknown;
  createdAt: Date;
  updatedAt: Date;
}

const sandboxConfigRows: SandboxConfigRow[] = [];
let idCounter = 0;

const fakeDb = {
  select: () => ({
    from: () => ({
      where: async (_condition: unknown) =>
        sandboxConfigRows.map((row) => ({ ...row })),
    }),
  }),
  insert: () => ({
    values: (input: Omit<SandboxConfigRow, "id"> & { id?: string }) => ({
      returning: async () => {
        const row: SandboxConfigRow = {
          id: input.id ?? `sandbox-config-${++idCounter}`,
          userId: input.userId,
          providerType: input.providerType,
          enabled: input.enabled,
          config: input.config,
          createdAt: input.createdAt,
          updatedAt: input.updatedAt,
        };

        sandboxConfigRows.push(row);
        return [{ ...row }];
      },
    }),
  }),
  update: () => ({
    set: (patch: Partial<SandboxConfigRow>) => ({
      where: (_condition: unknown) => ({
        returning: async () => {
          const existing = sandboxConfigRows[0];
          if (!existing) {
            return [];
          }

          const updated = {
            ...existing,
            ...patch,
          };
          sandboxConfigRows[0] = updated;
          return [{ ...updated }];
        },
      }),
    }),
  }),
};

mock.module("./client", () => ({
  db: fakeDb,
}));

const sandboxConfigsModulePromise = import("./sandbox-configs");

beforeEach(() => {
  sandboxConfigRows.length = 0;
  idCounter = 0;
});

describe("getUserSandboxConfigs", () => {
  test("normalizes stored config values", async () => {
    const { getUserSandboxConfigs } = await sandboxConfigsModulePromise;

    sandboxConfigRows.push({
      id: "config-1",
      userId: "user-1",
      providerType: "vercel",
      enabled: true,
      config: {
        VERCEL_TEAM: " my-team ",
        EMPTY: "   ",
        INVALID: 42,
      },
      createdAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt: new Date("2026-01-01T00:00:00Z"),
    });

    const rows = await getUserSandboxConfigs("user-1");

    expect(rows).toEqual([
      {
        id: "config-1",
        userId: "user-1",
        providerType: "vercel",
        enabled: true,
        config: {
          VERCEL_TEAM: "my-team",
        },
        createdAt: new Date("2026-01-01T00:00:00Z"),
        updatedAt: new Date("2026-01-01T00:00:00Z"),
      },
    ]);
  });
});

describe("upsertUserSandboxConfig", () => {
  test("inserts a new row when none exists", async () => {
    const { upsertUserSandboxConfig } = await sandboxConfigsModulePromise;

    const result = await upsertUserSandboxConfig("user-1", "docker", {
      config: {
        DOCKER_SANDBOX_IMAGE: " open-agents/sandbox-dev:latest ",
      },
    });

    expect(result.providerType).toBe("docker");
    expect(result.enabled).toBe(false);
    expect(result.config).toEqual({
      DOCKER_SANDBOX_IMAGE: "open-agents/sandbox-dev:latest",
    });
    expect(sandboxConfigRows).toHaveLength(1);
  });

  test("updates existing rows and merges/deletes config keys", async () => {
    const { upsertUserSandboxConfig } = await sandboxConfigsModulePromise;

    sandboxConfigRows.push({
      id: "config-1",
      userId: "user-1",
      providerType: "daytona",
      enabled: true,
      config: {
        DAYTONA_SERVER_URL: "https://app.daytona.io",
        DAYTONA_API_KEY: "secret",
      },
      createdAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt: new Date("2026-01-01T00:00:00Z"),
    });

    const result = await upsertUserSandboxConfig("user-1", "daytona", {
      enabled: false,
      config: {
        DAYTONA_SERVER_URL: " https://custom.daytona.io ",
        DAYTONA_API_KEY: "",
      },
    });

    expect(result.id).toBe("config-1");
    expect(result.enabled).toBe(false);
    expect(result.config).toEqual({
      DAYTONA_SERVER_URL: "https://custom.daytona.io",
    });
    expect(sandboxConfigRows).toHaveLength(1);
  });
});
