import { beforeEach, describe, expect, mock, test } from "bun:test";
import {
  DEFAULT_SANDBOX_BASE_SNAPSHOT_ID,
  DEFAULT_SANDBOX_TIMEOUT_MS,
} from "@/lib/sandbox/config";

mock.module("server-only", () => ({}));

mock.module("botid/server", () => ({
  checkBotId: async () => ({ isBot: false }),
}));

interface TestSessionRecord {
  id: string;
  userId: string;
  lifecycleVersion: number;
  sandboxState: { type: "vercel" };
  vercelProjectId: string | null;
  vercelProjectName: string | null;
  vercelTeamId: string | null;
  globalSkillRefs: Array<{ source: string; skillName: string }>;
}

interface TestVercelAuthInfo {
  token: string;
  expiresAt: number;
  externalId: string;
}

interface KickCall {
  sessionId: string;
  reason: string;
}

interface ConnectConfig {
  state: {
    type: "vercel" | "docker" | "daytona";
    sandboxName?: string;
    source?: {
      repo?: string;
      branch?: string;
      newBranch?: string;
    };
  };
  options?: {
    githubToken?: string;
    gitUser?: {
      email?: string;
    };
    env?: Record<string, string>;
    baseSnapshotId?: string;
    persistent?: boolean;
    resume?: boolean;
    createIfMissing?: boolean;
  };
}

const kickCalls: KickCall[] = [];
const updateCalls: Array<{
  sessionId: string;
  patch: Record<string, unknown>;
}> = [];
const connectConfigs: ConnectConfig[] = [];
const writeFileCalls: Array<{ path: string; content: string }> = [];
const execCalls: Array<{ command: string; cwd: string; timeoutMs: number }> =
  [];
const dotenvSyncCalls: Array<Record<string, unknown>> = [];
const providerAvailability: Record<string, boolean> = {
  vercel: true,
  docker: true,
  daytona: true,
};
const providerUnavailableReason: Record<string, string | undefined> = {};

let sessionRecord: TestSessionRecord;
let currentVercelAuthInfo: TestVercelAuthInfo | null;
let currentGitHubToken: string | null;
let currentDotenvContent: string;
let currentDotenvError: Error | null;
let currentUserSandboxConfigs: Array<{
  providerType: "vercel" | "docker" | "daytona";
  config: Record<string, string>;
}>;

mock.module("@/lib/session/get-server-session", () => ({
  getServerSession: async () => ({
    user: {
      id: "user-1",
      username: "nico",
      name: "Nico",
      email: "nico@example.com",
    },
  }),
}));

mock.module("@/lib/github/token", () => ({
  getGitHubUserProfile: async () => ({
    externalUserId: "12345",
    username: "nico-gh",
  }),
  getUserGitHubToken: async () => currentGitHubToken,
}));

mock.module("@/lib/vercel/token", () => ({
  getUserVercelAuthInfo: async () => currentVercelAuthInfo,
  getUserVercelToken: async () => currentVercelAuthInfo?.token ?? null,
}));

mock.module("@/lib/vercel/projects", () => ({
  buildDevelopmentDotenvFromVercelProject: async (
    input: Record<string, unknown>,
  ) => {
    dotenvSyncCalls.push(input);
    if (currentDotenvError) {
      throw currentDotenvError;
    }
    return currentDotenvContent;
  },
}));

mock.module("@/lib/db/sessions", () => ({
  getChatsBySessionId: async () => [],
  getSessionById: async () => sessionRecord,
  updateSession: async (sessionId: string, patch: Record<string, unknown>) => {
    updateCalls.push({ sessionId, patch });
    return {
      ...sessionRecord,
      ...patch,
    };
  },
}));

mock.module("@/lib/db/sandbox-configs", () => ({
  upsertUserSandboxConfig: async () => null,
  getUserSandboxConfigs: async () =>
    currentUserSandboxConfigs.map((item, index) => ({
      id: `sandbox-config-${index}`,
      userId: "user-1",
      providerType: item.providerType,
      enabled: true,
      config: item.config,
      createdAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt: new Date("2026-01-01T00:00:00Z"),
    })),
}));

mock.module("@/lib/sandbox/lifecycle-kick", () => ({
  kickSandboxLifecycleWorkflow: (input: KickCall) => {
    kickCalls.push(input);
  },
}));

mock.module("@open-agents/sandbox", () => ({
  defaultRegistry: {
    get: (type: string) => {
      if (!(type in providerAvailability)) {
        return undefined;
      }

      return {
        type,
        capabilities: {
          persistent: type !== "docker",
          db: true,
          envInjection: true,
          credentialBrokering: type !== "docker",
        },
        configFields:
          type === "daytona"
            ? [
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
              ]
            : type === "docker"
              ? [
                  {
                    key: "DOCKER_SANDBOX_IMAGE",
                    label: "Sandbox Image",
                    type: "text",
                    required: true,
                  },
                ]
              : [
                  {
                    key: "VERCEL_SANDBOX_BASE_SNAPSHOT_ID",
                    label: "Base Snapshot ID",
                    type: "text",
                    required: false,
                  },
                ],
        isAvailable: () => providerAvailability[type],
        reasonUnavailable: () => providerUnavailableReason[type],
      };
    },
  },
  connectSandbox: async (config: ConnectConfig) => {
    connectConfigs.push(config);

    return {
      currentBranch: "main",
      workingDirectory: "/vercel/sandbox",
      getState: () => ({
        type: "vercel" as const,
        sandboxName: config.state.sandboxName ?? "session_session-1",
        expiresAt: Date.now() + 120_000,
      }),
      exec: async (command: string, cwd: string, timeoutMs: number) => {
        execCalls.push({ command, cwd, timeoutMs });
        if (command === 'printf %s "$HOME"') {
          return {
            success: true,
            exitCode: 0,
            stdout: "/root",
            stderr: "",
            truncated: false,
          };
        }

        return {
          success: true,
          exitCode: 0,
          stdout: "",
          stderr: "",
          truncated: false,
        };
      },
      writeFile: async (path: string, content: string) => {
        writeFileCalls.push({ path, content });
      },
      stop: async () => {},
    };
  },
}));

const routeModulePromise = import("./route");

describe("/api/sandbox lifecycle kicks", () => {
  beforeEach(() => {
    kickCalls.length = 0;
    updateCalls.length = 0;
    connectConfigs.length = 0;
    writeFileCalls.length = 0;
    execCalls.length = 0;
    dotenvSyncCalls.length = 0;
    currentVercelAuthInfo = {
      token: "vercel-token",
      expiresAt: 1_700_000_000,
      externalId: "user_ext_1",
    };
    currentGitHubToken = null;
    currentDotenvContent = 'API_KEY="secret"\n';
    currentDotenvError = null;
    providerAvailability.vercel = true;
    providerAvailability.docker = true;
    providerAvailability.daytona = true;
    providerUnavailableReason.vercel = undefined;
    providerUnavailableReason.docker = undefined;
    providerUnavailableReason.daytona = undefined;
    delete process.env.DAYTONA_API_KEY;
    delete process.env.DAYTONA_SERVER_URL;
    delete process.env.VERCEL_SANDBOX_BASE_SNAPSHOT_ID;
    currentUserSandboxConfigs = [];
    sessionRecord = {
      id: "session-1",
      userId: "user-1",
      lifecycleVersion: 3,
      sandboxState: { type: "vercel" },
      vercelProjectId: "project-1",
      vercelProjectName: "open-agents-web",
      vercelTeamId: "team-1",
      globalSkillRefs: [],
    };
  });

  test("uses session_<sessionId> as the persistent sandbox name", async () => {
    const { POST } = await routeModulePromise;

    currentDotenvContent = "";
    sessionRecord.vercelProjectId = null;
    sessionRecord.vercelProjectName = null;
    sessionRecord.vercelTeamId = null;

    const request = new Request("http://localhost/api/sandbox", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: "session-1",
        sandboxType: "vercel",
      }),
    });

    const response = await POST(request);

    expect(response.ok).toBe(true);
    expect(kickCalls).toEqual([
      {
        sessionId: "session-1",
        reason: "sandbox-created",
      },
    ]);
    expect(connectConfigs[0]).toMatchObject({
      state: {
        type: "vercel",
        sandboxName: "session_session-1",
      },
      options: {
        persistent: true,
        resume: true,
        createIfMissing: true,
      },
    });
    expect(dotenvSyncCalls).toHaveLength(0);
  });

  test("repo sandboxes broker the user GitHub token instead of embedding it", async () => {
    const { POST } = await routeModulePromise;

    currentGitHubToken = "github-user-token";
    sessionRecord.vercelProjectId = null;
    sessionRecord.vercelProjectName = null;
    sessionRecord.vercelTeamId = null;

    const response = await POST(
      new Request("http://localhost/api/sandbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repoUrl: "https://github.com/acme/private-repo",
          branch: "main",
          sandboxType: "vercel",
        }),
      }),
    );

    expect(response.ok).toBe(true);
    expect(connectConfigs[0]).toMatchObject({
      state: {
        type: "vercel",
        source: {
          repo: "https://github.com/acme/private-repo",
          branch: "main",
        },
      },
      options: {
        githubToken: "github-user-token",
      },
    });
    expect(connectConfigs[0]?.state.source).not.toHaveProperty("token");
  });

  test("daytona proceeds with partial host env fallback when saved config is absent", async () => {
    const { POST } = await routeModulePromise;

    process.env.DAYTONA_SERVER_URL = "https://env.daytona.example.com";
    delete process.env.DAYTONA_API_KEY;
    currentUserSandboxConfigs = [];

    const response = await POST(
      new Request("http://localhost/api/sandbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: "session-1",
          sandboxType: "daytona",
        }),
      }),
    );

    expect(response.ok).toBe(true);
    expect(connectConfigs[0]).toMatchObject({
      state: {
        type: "daytona",
      },
      options: {
        env: {
          DAYTONA_SERVER_URL: "https://env.daytona.example.com",
        },
      },
    });
    expect(connectConfigs[0]?.options?.env).not.toHaveProperty(
      "DAYTONA_API_KEY",
    );
  });

  test("daytona applies saved-over-env precedence for matching config keys", async () => {
    const { POST } = await routeModulePromise;

    process.env.DAYTONA_API_KEY = "env-api-key";
    process.env.DAYTONA_SERVER_URL = "https://env.daytona.example.com";
    currentUserSandboxConfigs = [
      {
        providerType: "daytona",
        config: {
          DAYTONA_API_KEY: "saved-api-key",
        },
      },
    ];

    const response = await POST(
      new Request("http://localhost/api/sandbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: "session-1",
          sandboxType: "daytona",
        }),
      }),
    );

    expect(response.ok).toBe(true);
    expect(connectConfigs[0]).toMatchObject({
      state: {
        type: "daytona",
      },
      options: {
        env: {
          DAYTONA_API_KEY: "saved-api-key",
          DAYTONA_SERVER_URL: "https://env.daytona.example.com",
        },
      },
    });
  });

  test("vercel uses host env base snapshot when saved config is absent", async () => {
    const { POST } = await routeModulePromise;

    process.env.VERCEL_SANDBOX_BASE_SNAPSHOT_ID = "env-snapshot-id";
    currentUserSandboxConfigs = [];

    const response = await POST(
      new Request("http://localhost/api/sandbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: "session-1",
          sandboxType: "vercel",
        }),
      }),
    );

    expect(response.ok).toBe(true);
    expect(connectConfigs[0]?.options?.baseSnapshotId).toBe("env-snapshot-id");
    expect(connectConfigs[0]?.options?.env).toMatchObject({
      VERCEL_SANDBOX_BASE_SNAPSHOT_ID: "env-snapshot-id",
    });
  });

  test("vercel saved base snapshot overrides host env and default fallback", async () => {
    const { POST } = await routeModulePromise;

    process.env.VERCEL_SANDBOX_BASE_SNAPSHOT_ID = "env-snapshot-id";
    currentUserSandboxConfigs = [
      {
        providerType: "vercel",
        config: {
          VERCEL_SANDBOX_BASE_SNAPSHOT_ID: "saved-snapshot-id",
        },
      },
    ];

    const response = await POST(
      new Request("http://localhost/api/sandbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: "session-1",
          sandboxType: "vercel",
        }),
      }),
    );

    expect(response.ok).toBe(true);
    expect(connectConfigs[0]?.options?.baseSnapshotId).toBe(
      "saved-snapshot-id",
    );
    expect(connectConfigs[0]?.options?.baseSnapshotId).not.toBe(
      DEFAULT_SANDBOX_BASE_SNAPSHOT_ID,
    );
    expect(connectConfigs[0]?.options?.env).toMatchObject({
      VERCEL_SANDBOX_BASE_SNAPSHOT_ID: "saved-snapshot-id",
    });
  });

  test("rejects repo bootstrap for non-vercel providers", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(
      new Request("http://localhost/api/sandbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repoUrl: "https://github.com/acme/private-repo",
          sandboxType: "docker",
        }),
      }),
    );
    const payload = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(payload.error).toBe(
      "Repository bootstrap is currently only supported for the vercel sandbox provider for secure auth reasons. Set sandboxType to 'vercel' or omit repoUrl.",
    );
    expect(connectConfigs).toHaveLength(0);
  });

  test("non-vercel providers do not receive githubToken in connect options", async () => {
    const { POST } = await routeModulePromise;

    currentGitHubToken = "github-user-token";

    const response = await POST(
      new Request("http://localhost/api/sandbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sandboxType: "docker",
        }),
      }),
    );

    expect(response.ok).toBe(true);
    expect(connectConfigs[0]?.state.type).toBe("docker");
    expect(connectConfigs[0]?.options).not.toHaveProperty("githubToken");
  });

  test("new vercel sandbox does not sync linked Development env vars while code is commented out", async () => {
    const { POST } = await routeModulePromise;

    const request = new Request("http://localhost/api/sandbox", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: "session-1",
        sandboxType: "vercel",
      }),
    });

    const response = await POST(request);

    expect(response.ok).toBe(true);
    expect(kickCalls).toEqual([
      {
        sessionId: "session-1",
        reason: "sandbox-created",
      },
    ]);
    expect(updateCalls.length).toBeGreaterThan(0);
    expect(connectConfigs[0]?.options?.gitUser?.email).toBe(
      "12345+nico-gh@users.noreply.github.com",
    );
    expect(dotenvSyncCalls).toHaveLength(0);
    expect(writeFileCalls).toEqual([]);

    const payload = (await response.json()) as {
      timeout: number;
      mode: string;
    };
    expect(payload.timeout).toBe(DEFAULT_SANDBOX_TIMEOUT_MS);
    expect(payload.mode).toBe("vercel");
  });

  test("commented-out env sync does not run during sandbox creation", async () => {
    const { POST } = await routeModulePromise;

    currentDotenvError = new Error("boom");

    const response = await POST(
      new Request("http://localhost/api/sandbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: "session-1",
          sandboxType: "vercel",
        }),
      }),
    );

    expect(response.ok).toBe(true);
    expect(kickCalls).toEqual([
      {
        sessionId: "session-1",
        reason: "sandbox-created",
      },
    ]);
    expect(dotenvSyncCalls).toHaveLength(0);
    expect(writeFileCalls).toEqual([]);
  });

  test("new sandboxes install global skills", async () => {
    const { POST } = await routeModulePromise;

    sessionRecord.globalSkillRefs = [
      { source: "vercel/ai", skillName: "ai-sdk" },
    ];

    const response = await POST(
      new Request("http://localhost/api/sandbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: "session-1",
          sandboxType: "vercel",
        }),
      }),
    );

    expect(response.ok).toBe(true);
    expect(execCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ command: 'printf %s "$HOME"' }),
        expect.objectContaining({
          command:
            "HOME='/root' npx skills add 'vercel/ai' --skill 'ai-sdk' --agent amp -g -y --copy",
        }),
      ]),
    );
  });

  test("rejects unsupported sandbox types", async () => {
    const { POST } = await routeModulePromise;

    const request = new Request("http://localhost/api/sandbox", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: "session-1",
        sandboxType: "invalid",
      }),
    });

    const response = await POST(request);
    const payload = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(payload.error).toBe("Invalid sandbox type");
    expect(connectConfigs).toHaveLength(0);
    expect(kickCalls).toHaveLength(0);
  });

  test("returns actionable error when provider is unavailable", async () => {
    const { POST } = await routeModulePromise;

    providerAvailability.vercel = false;
    providerUnavailableReason.vercel = "Vercel credentials are missing";

    const response = await POST(
      new Request("http://localhost/api/sandbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: "session-1",
          sandboxType: "vercel",
        }),
      }),
    );
    const payload = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(payload.error).toBe(
      "Sandbox provider unavailable: Vercel credentials are missing",
    );
    expect(connectConfigs).toHaveLength(0);
  });
});
