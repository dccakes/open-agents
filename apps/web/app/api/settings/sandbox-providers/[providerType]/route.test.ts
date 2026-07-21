import { beforeEach, describe, expect, mock, test } from "bun:test";

let authResult:
  | { ok: true; userId: string }
  | { ok: false; response: Response } = { ok: true, userId: "user-1" };

const upsertUserSandboxConfigMock = mock(async () => ({
  id: "config-1",
  userId: "user-1",
  providerType: "docker" as const,
  enabled: true,
  config: {
    DOCKER_SANDBOX_IMAGE: "open-agents/sandbox-dev:latest",
  },
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
}));

const dockerProvider = {
  type: "docker" as const,
  label: "Docker",
  beta: false,
  capabilities: {
    persistent: false,
    db: true,
    envInjection: true,
    credentialBrokering: false,
  },
  configFields: [
    {
      key: "DOCKER_SANDBOX_IMAGE",
      label: "Sandbox Image",
      type: "text" as const,
      required: true,
    },
  ],
  isAvailable: () => true,
  reasonUnavailable: () => undefined,
};

const daytonaProvider = {
  type: "daytona" as const,
  label: "Daytona",
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
      type: "url" as const,
      required: true,
    },
    {
      key: "DAYTONA_API_KEY",
      label: "API Key",
      type: "password" as const,
      required: true,
    },
  ],
  isAvailable: () => true,
  reasonUnavailable: () => undefined,
};

mock.module("@/app/api/sessions/_lib/session-context", () => ({
  requireAuthenticatedUser: async () => authResult,
}));

mock.module("@/lib/db/sandbox-configs", () => ({
  upsertUserSandboxConfig: upsertUserSandboxConfigMock,
}));

mock.module("@open-agents/sandbox", () => ({
  defaultRegistry: {
    list: () => [dockerProvider, daytonaProvider],
    get: (type: string) =>
      type === "docker"
        ? dockerProvider
        : type === "daytona"
          ? daytonaProvider
          : undefined,
  },
}));

const routeModulePromise = import("./route");

beforeEach(() => {
  authResult = { ok: true, userId: "user-1" };
  upsertUserSandboxConfigMock.mockClear();
  upsertUserSandboxConfigMock.mockImplementation(async () => ({
    id: "config-1",
    userId: "user-1",
    providerType: "docker",
    enabled: true,
    config: {
      DOCKER_SANDBOX_IMAGE: "open-agents/sandbox-dev:latest",
    },
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
  }));
});

describe("PATCH /api/settings/sandbox-providers/[providerType]", () => {
  test("returns 401 for unauthenticated users", async () => {
    authResult = {
      ok: false,
      response: Response.json({ error: "Not authenticated" }, { status: 401 }),
    };

    const { PATCH } = await routeModulePromise;
    const response = await PATCH(
      new Request("http://localhost/api/settings/sandbox-providers/docker", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: true }),
      }),
      { params: Promise.resolve({ providerType: "docker" }) },
    );

    expect(response.status).toBe(401);
    expect(upsertUserSandboxConfigMock).not.toHaveBeenCalled();
  });

  test("returns 404 for unknown providers", async () => {
    const { PATCH } = await routeModulePromise;
    const response = await PATCH(
      new Request("http://localhost/api/settings/sandbox-providers/unknown", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: true }),
      }),
      { params: Promise.resolve({ providerType: "unknown" }) },
    );
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(404);
    expect(body.error).toBe("Unknown sandbox provider");
    expect(upsertUserSandboxConfigMock).not.toHaveBeenCalled();
  });

  test("upserts provider state and config", async () => {
    const { PATCH } = await routeModulePromise;

    const response = await PATCH(
      new Request("http://localhost/api/settings/sandbox-providers/docker", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: true,
          config: {
            DOCKER_SANDBOX_IMAGE: "open-agents/sandbox-dev:latest",
          },
        }),
      }),
      { params: Promise.resolve({ providerType: "docker" }) },
    );

    const body = (await response.json()) as {
      provider: {
        type: string;
        enabled: boolean;
        config: Record<string, string>;
      };
    };

    expect(response.status).toBe(200);
    expect(upsertUserSandboxConfigMock).toHaveBeenCalledWith(
      "user-1",
      "docker",
      {
        enabled: true,
        config: {
          DOCKER_SANDBOX_IMAGE: "open-agents/sandbox-dev:latest",
        },
      },
    );
    expect(body.provider.type).toBe("docker");
    expect(body.provider.enabled).toBe(true);
    expect(body.provider.config).toEqual({
      DOCKER_SANDBOX_IMAGE: "open-agents/sandbox-dev:latest",
    });
  });

  test("rejects invalid daytona server URLs", async () => {
    const { PATCH } = await routeModulePromise;

    const response = await PATCH(
      new Request("http://localhost/api/settings/sandbox-providers/daytona", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: true,
          config: {
            DAYTONA_SERVER_URL: "http://localhost:3000",
            DAYTONA_API_KEY: "daytona-secret",
          },
        }),
      }),
      { params: Promise.resolve({ providerType: "daytona" }) },
    );
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toBe("DAYTONA_SERVER_URL must use https");
    expect(upsertUserSandboxConfigMock).not.toHaveBeenCalled();
  });
});
