import { beforeEach, describe, expect, mock, test } from "bun:test";

interface MockUserSandboxConfigRow {
  id: string;
  userId: string;
  providerType: "vercel" | "docker" | "daytona";
  enabled: boolean;
  config: Record<string, string>;
  createdAt: Date;
  updatedAt: Date;
}

let authResult:
  | { ok: true; userId: string }
  | { ok: false; response: Response } = { ok: true, userId: "user-1" };

const getUserSandboxConfigsMock = mock(
  async (): Promise<MockUserSandboxConfigRow[]> => [],
);

mock.module("@/app/api/sessions/_lib/session-context", () => ({
  requireAuthenticatedUser: async () => authResult,
}));

mock.module("@/lib/db/sandbox-configs", () => ({
  getUserSandboxConfigs: getUserSandboxConfigsMock,
}));

mock.module("@open-agents/sandbox", () => ({
  defaultRegistry: {
    list: () => [
      {
        type: "vercel",
        label: "Vercel",
        beta: false,
        capabilities: {
          persistent: true,
          db: true,
          envInjection: true,
          credentialBrokering: true,
        },
        configFields: [
          {
            key: "VERCEL_TEAM",
            label: "Vercel Team",
            type: "text",
            required: false,
          },
          {
            key: "VERCEL_PROJECT",
            label: "Vercel Project",
            type: "text",
            required: false,
          },
        ],
        isAvailable: () => true,
        reasonUnavailable: () => undefined,
      },
      {
        type: "daytona",
        label: "Daytona (Beta)",
        beta: true,
        capabilities: {
          persistent: true,
          db: true,
          envInjection: true,
          credentialBrokering: true,
        },
        configFields: [
          {
            key: "DAYTONA_SERVER_URL",
            label: "Server URL",
            type: "url",
            required: true,
          },
          {
            key: "DAYTONA_API_KEY",
            label: "API Key",
            type: "password",
            required: true,
          },
        ],
        isAvailable: () => false,
        reasonUnavailable: () => "DAYTONA_BETA_ENABLED is not enabled",
      },
    ],
  },
}));

const routeModulePromise = import("./route");

beforeEach(() => {
  authResult = { ok: true, userId: "user-1" };
  getUserSandboxConfigsMock.mockClear();
  getUserSandboxConfigsMock.mockImplementation(async () => []);
  delete process.env.VERCEL_TEAM;
  delete process.env.VERCEL_PROJECT;
  delete process.env.DAYTONA_SERVER_URL;
  delete process.env.DAYTONA_API_KEY;
});

describe("GET /api/settings/sandbox-providers", () => {
  test("returns 401 for unauthenticated users", async () => {
    authResult = {
      ok: false,
      response: Response.json({ error: "Not authenticated" }, { status: 401 }),
    };

    const { GET } = await routeModulePromise;
    const response = await GET();
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(401);
    expect(body.error).toBe("Not authenticated");
  });

  test("returns provider settings including masked secret fields", async () => {
    const sandboxConfigRows: MockUserSandboxConfigRow[] = [
      {
        id: "config-1",
        userId: "user-1",
        providerType: "vercel",
        enabled: true,
        config: {
          VERCEL_TEAM: "my-team",
          VERCEL_PROJECT: "my-project",
        },
        createdAt: new Date("2026-01-01T00:00:00Z"),
        updatedAt: new Date("2026-01-01T00:00:00Z"),
      },
      {
        id: "config-2",
        userId: "user-1",
        providerType: "daytona",
        enabled: true,
        config: {
          DAYTONA_SERVER_URL: "https://app.daytona.io",
          DAYTONA_API_KEY: "secret",
        },
        createdAt: new Date("2026-01-01T00:00:00Z"),
        updatedAt: new Date("2026-01-01T00:00:00Z"),
      },
    ];

    getUserSandboxConfigsMock.mockImplementation(async () => sandboxConfigRows);

    const { GET } = await routeModulePromise;
    const response = await GET();
    const body = (await response.json()) as {
      providers: Array<{
        type: string;
        label: string;
        beta: boolean;
        capabilities: {
          persistent: boolean;
          db: boolean;
          envInjection: boolean;
          credentialBrokering: boolean;
        };
        configFields: Array<{
          key: string;
          label: string;
          type: string;
          required: boolean;
        }>;
        isAvailable: boolean;
        reasonUnavailable?: string;
        enabled: boolean;
        isConfigured: boolean;
        config: Record<string, string>;
        secretConfigKeys: string[];
        environmentConfigKeys: string[];
        overriddenEnvironmentConfigKeys: string[];
      }>;
    };

    expect(response.status).toBe(200);
    expect(body.providers).toEqual([
      {
        type: "vercel",
        label: "Vercel",
        beta: false,
        capabilities: {
          persistent: true,
          db: true,
          envInjection: true,
          credentialBrokering: true,
        },
        configFields: [
          {
            key: "VERCEL_TEAM",
            label: "Vercel Team",
            type: "text",
            required: false,
          },
          {
            key: "VERCEL_PROJECT",
            label: "Vercel Project",
            type: "text",
            required: false,
          },
        ],
        isAvailable: true,
        reasonUnavailable: undefined,
        enabled: true,
        config: {
          VERCEL_TEAM: "my-team",
          VERCEL_PROJECT: "my-project",
        },
        secretConfigKeys: [],
        environmentConfigKeys: [],
        overriddenEnvironmentConfigKeys: [],
        isConfigured: true,
      },
      {
        type: "daytona",
        label: "Daytona (Beta)",
        beta: true,
        capabilities: {
          persistent: true,
          db: true,
          envInjection: true,
          credentialBrokering: true,
        },
        configFields: [
          {
            key: "DAYTONA_SERVER_URL",
            label: "Server URL",
            type: "url",
            required: true,
          },
          {
            key: "DAYTONA_API_KEY",
            label: "API Key",
            type: "password",
            required: true,
          },
        ],
        isAvailable: false,
        reasonUnavailable: "DAYTONA_BETA_ENABLED is not enabled",
        enabled: true,
        config: {
          DAYTONA_SERVER_URL: "https://app.daytona.io",
        },
        secretConfigKeys: ["DAYTONA_API_KEY"],
        environmentConfigKeys: [],
        overriddenEnvironmentConfigKeys: [],
        isConfigured: true,
      },
    ]);
  });

  test("uses environment config values as fallback when saved config is missing", async () => {
    process.env.VERCEL_TEAM = "env-team";

    const sandboxConfigRows: MockUserSandboxConfigRow[] = [
      {
        id: "config-1",
        userId: "user-1",
        providerType: "vercel",
        enabled: true,
        config: {},
        createdAt: new Date("2026-01-01T00:00:00Z"),
        updatedAt: new Date("2026-01-01T00:00:00Z"),
      },
    ];

    getUserSandboxConfigsMock.mockImplementation(async () => sandboxConfigRows);

    const { GET } = await routeModulePromise;
    const response = await GET();
    const body = (await response.json()) as {
      providers: Array<{
        type: string;
        config: Record<string, string>;
        isConfigured: boolean;
        environmentConfigKeys: string[];
      }>;
    };

    const vercelProvider = body.providers.find(
      (provider) => provider.type === "vercel",
    );

    expect(response.status).toBe(200);
    expect(vercelProvider).toEqual(
      expect.objectContaining({
        type: "vercel",
        config: {},
        isConfigured: true,
        environmentConfigKeys: ["VERCEL_TEAM"],
      }),
    );
  });

  test("marks saved config as overriding environment values", async () => {
    process.env.VERCEL_TEAM = "env-team";

    const sandboxConfigRows: MockUserSandboxConfigRow[] = [
      {
        id: "config-1",
        userId: "user-1",
        providerType: "vercel",
        enabled: true,
        config: {
          VERCEL_TEAM: "saved-team",
        },
        createdAt: new Date("2026-01-01T00:00:00Z"),
        updatedAt: new Date("2026-01-01T00:00:00Z"),
      },
    ];

    getUserSandboxConfigsMock.mockImplementation(async () => sandboxConfigRows);

    const { GET } = await routeModulePromise;
    const response = await GET();
    const body = (await response.json()) as {
      providers: Array<{
        type: string;
        config: Record<string, string>;
        overriddenEnvironmentConfigKeys: string[];
      }>;
    };

    const vercelProvider = body.providers.find(
      (provider) => provider.type === "vercel",
    );

    expect(response.status).toBe(200);
    expect(vercelProvider).toEqual(
      expect.objectContaining({
        type: "vercel",
        config: { VERCEL_TEAM: "saved-team" },
        overriddenEnvironmentConfigKeys: ["VERCEL_TEAM"],
      }),
    );
  });

  test("does not mark required provider as configured with only one required env value", async () => {
    process.env.DAYTONA_SERVER_URL = "https://env.daytona.io";

    const { GET } = await routeModulePromise;
    const response = await GET();
    const body = (await response.json()) as {
      providers: Array<{
        type: string;
        isConfigured: boolean;
        config: Record<string, string>;
        environmentConfigKeys: string[];
        overriddenEnvironmentConfigKeys: string[];
      }>;
    };

    const daytonaProvider = body.providers.find(
      (provider) => provider.type === "daytona",
    );

    expect(response.status).toBe(200);
    expect(daytonaProvider).toEqual(
      expect.objectContaining({
        type: "daytona",
        isConfigured: false,
        config: {},
        environmentConfigKeys: ["DAYTONA_SERVER_URL"],
        overriddenEnvironmentConfigKeys: [],
      }),
    );
  });

  test("marks required provider as configured when env and saved config together satisfy required fields", async () => {
    process.env.DAYTONA_SERVER_URL = "https://env.daytona.io";

    const sandboxConfigRows: MockUserSandboxConfigRow[] = [
      {
        id: "config-1",
        userId: "user-1",
        providerType: "daytona",
        enabled: true,
        config: {
          DAYTONA_API_KEY: "saved-secret",
        },
        createdAt: new Date("2026-01-01T00:00:00Z"),
        updatedAt: new Date("2026-01-01T00:00:00Z"),
      },
    ];

    getUserSandboxConfigsMock.mockImplementation(async () => sandboxConfigRows);

    const { GET } = await routeModulePromise;
    const response = await GET();
    const body = (await response.json()) as {
      providers: Array<{
        type: string;
        isConfigured: boolean;
        config: Record<string, string>;
        secretConfigKeys: string[];
        environmentConfigKeys: string[];
      }>;
    };

    const daytonaProvider = body.providers.find(
      (provider) => provider.type === "daytona",
    );

    expect(response.status).toBe(200);
    expect(daytonaProvider).toEqual(
      expect.objectContaining({
        type: "daytona",
        isConfigured: true,
        config: {},
        secretConfigKeys: ["DAYTONA_API_KEY"],
        environmentConfigKeys: ["DAYTONA_SERVER_URL"],
      }),
    );
  });

  test("tracks overridden env keys and keeps saved secrets masked in config", async () => {
    process.env.DAYTONA_SERVER_URL = "https://env.daytona.io";
    process.env.DAYTONA_API_KEY = "env-secret";

    const sandboxConfigRows: MockUserSandboxConfigRow[] = [
      {
        id: "config-1",
        userId: "user-1",
        providerType: "daytona",
        enabled: true,
        config: {
          DAYTONA_SERVER_URL: "https://saved.daytona.io",
          DAYTONA_API_KEY: "saved-secret",
        },
        createdAt: new Date("2026-01-01T00:00:00Z"),
        updatedAt: new Date("2026-01-01T00:00:00Z"),
      },
    ];

    getUserSandboxConfigsMock.mockImplementation(async () => sandboxConfigRows);

    const { GET } = await routeModulePromise;
    const response = await GET();
    const body = (await response.json()) as {
      providers: Array<{
        type: string;
        isConfigured: boolean;
        config: Record<string, string>;
        secretConfigKeys: string[];
        environmentConfigKeys: string[];
        overriddenEnvironmentConfigKeys: string[];
      }>;
    };

    const daytonaProvider = body.providers.find(
      (provider) => provider.type === "daytona",
    );

    expect(response.status).toBe(200);
    expect(daytonaProvider).toEqual(
      expect.objectContaining({
        type: "daytona",
        isConfigured: true,
        config: {
          DAYTONA_SERVER_URL: "https://saved.daytona.io",
        },
        secretConfigKeys: ["DAYTONA_API_KEY"],
        environmentConfigKeys: [],
        overriddenEnvironmentConfigKeys: [
          "DAYTONA_SERVER_URL",
          "DAYTONA_API_KEY",
        ],
      }),
    );
    expect(daytonaProvider?.config.DAYTONA_API_KEY).toBeUndefined();
  });
});
