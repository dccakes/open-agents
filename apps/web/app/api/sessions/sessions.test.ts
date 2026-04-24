import { beforeEach, describe, expect, mock, test } from "bun:test";

let currentSession: {
  user: {
    id: string;
    username: string;
    name: string;
    email?: string;
  };
} | null = {
  user: {
    id: "user-1",
    username: "nico",
    name: "Nico",
  },
};

const createCalls: Array<Record<string, unknown>> = [];
const providerAvailability: Record<string, boolean> = {
  vercel: true,
  docker: true,
  daytona: true,
};
const providerCapabilitiesDb: Record<string, boolean> = {
  vercel: true,
  docker: true,
  daytona: true,
};
const providerUnavailableReason: Record<string, string | undefined> = {};

mock.module("@/lib/session/get-server-session", () => ({
  getServerSession: async () => currentSession,
}));

mock.module("@/lib/db/sessions", () => ({
  getSessionById: async () => null,
  getChatById: async () => null,
  updateSession: async () => null,
  countSessionsByUserId: async () => 0,
  createSessionWithInitialChat: async (input: {
    session: Record<string, unknown>;
    initialChat: Record<string, unknown>;
  }) => {
    createCalls.push(input.session);
    return {
      session: {
        ...input.session,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      chat: {
        id: String(input.initialChat.id),
        sessionId: String(input.session.id),
        title: String(input.initialChat.title),
        modelId: String(input.initialChat.modelId),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    };
  },
  getArchivedSessionCountByUserId: async () => 0,
  getSessionsWithUnreadByUserId: async () => [],
  getUsedSessionTitles: async () => new Set<string>(),
  getChatsBySessionId: async () => [],
}));

mock.module("@/lib/db/user-preferences", () => ({
  getUserPreferences: async () => ({
    defaultModelId: "anthropic/claude-haiku-4.5",
    defaultSubagentModelId: null,
    defaultSandboxType: "vercel",
    defaultDiffMode: "unified",
    autoCommitPush: false,
    autoCreatePr: false,
    alertsEnabled: true,
    alertSoundEnabled: true,
    publicUsageEnabled: false,
    globalSkillRefs: [],
    modelVariants: [],
    enabledModelIds: [],
  }),
}));

mock.module("@/lib/model-access", () => ({
  sanitizeUserPreferencesForSession: (prefs: unknown) => prefs,
}));

mock.module("@/lib/github/repo-identifiers", () => ({
  isValidGitHubRepoName: () => true,
  isValidGitHubRepoOwner: () => true,
}));

mock.module("@/lib/random-city", () => ({
  getRandomCityName: () => "Oslo",
}));

mock.module("@/lib/managed-template-trial", () => ({
  MANAGED_TEMPLATE_TRIAL_SESSION_LIMIT: 1,
  MANAGED_TEMPLATE_TRIAL_SESSION_LIMIT_ERROR: "trial limit",
  isManagedTemplateTrialUser: () => false,
}));

mock.module("@/lib/db/vercel-project-links", () => ({
  getVercelProjectLinkByRepo: async () => null,
  upsertVercelProjectLink: async () => {},
}));

mock.module("@/lib/vercel/projects", () => ({
  listMatchingVercelProjects: async () => [],
}));

mock.module("@/lib/vercel/token", () => ({
  getUserVercelToken: async () => "vercel-token",
}));

mock.module("@open-agents/sandbox", () => ({
  connectSandbox: async () => ({
    stop: async () => {},
  }),
  defaultRegistry: {
    get: (type: string) => {
      if (!(type in providerAvailability)) {
        return undefined;
      }

      return {
        type,
        capabilities: {
          persistent: type !== "docker",
          db: providerCapabilitiesDb[type],
          envInjection: true,
          credentialBrokering: type !== "docker",
        },
        isAvailable: () => providerAvailability[type],
        reasonUnavailable: () => providerUnavailableReason[type],
      };
    },
  },
}));

const routeModulePromise = import("./route");

function createJsonRequest(body: unknown): Request {
  return new Request("http://localhost/api/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("/api/sessions POST sandbox shape", () => {
  beforeEach(() => {
    currentSession = {
      user: {
        id: "user-1",
        username: "nico",
        name: "Nico",
      },
    };
    createCalls.length = 0;
    providerAvailability.vercel = true;
    providerAvailability.docker = true;
    providerAvailability.daytona = true;
    providerCapabilitiesDb.vercel = true;
    providerCapabilitiesDb.docker = true;
    providerCapabilitiesDb.daytona = true;
    providerUnavailableReason.vercel = undefined;
    providerUnavailableReason.docker = undefined;
    providerUnavailableReason.daytona = undefined;
  });

  test("defaults sandboxType to vercel and provisionDb to false", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(createJsonRequest({ title: "test" }));

    expect(response.status).toBe(200);
    expect(createCalls).toHaveLength(1);
    expect(createCalls[0]).toMatchObject({
      sandboxState: { type: "vercel" },
      provisionDb: false,
    });
  });

  test("accepts docker sandboxType and provisionDb true", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(
      createJsonRequest({ sandboxType: "docker", provisionDb: true }),
    );

    expect(response.status).toBe(200);
    expect(createCalls[0]).toMatchObject({
      sandboxState: { type: "docker" },
      provisionDb: true,
    });
  });

  test("accepts daytona sandboxType", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(createJsonRequest({ sandboxType: "daytona" }));

    expect(response.status).toBe(200);
    expect(createCalls[0]).toMatchObject({
      sandboxState: { type: "daytona" },
      provisionDb: false,
    });
  });

  test("rejects invalid sandboxType", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(createJsonRequest({ sandboxType: "invalid" }));
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toBe("Invalid sandbox type");
    expect(createCalls).toHaveLength(0);
  });

  test("rejects non-boolean provisionDb", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(createJsonRequest({ provisionDb: "yes" }));
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toBe("Invalid provisionDb value");
    expect(createCalls).toHaveLength(0);
  });

  test("rejects unavailable providers with actionable error", async () => {
    const { POST } = await routeModulePromise;

    providerAvailability.daytona = false;
    providerUnavailableReason.daytona = "DAYTONA_BETA_ENABLED is not enabled";

    const response = await POST(createJsonRequest({ sandboxType: "daytona" }));
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toBe(
      "Sandbox provider unavailable: DAYTONA_BETA_ENABLED is not enabled",
    );
    expect(createCalls).toHaveLength(0);
  });

  test("rejects provisionDb when provider lacks db capability", async () => {
    const { POST } = await routeModulePromise;

    providerCapabilitiesDb.docker = false;

    const response = await POST(
      createJsonRequest({ sandboxType: "docker", provisionDb: true }),
    );
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toBe(
      "Sandbox provider 'docker' does not support database provisioning",
    );
    expect(createCalls).toHaveLength(0);
  });
});
