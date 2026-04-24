import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { createHmac } from "crypto";

const originalWebhookSecret = process.env.GITHUB_WEBHOOK_SECRET;

let linkedSessions: Array<{ id: string; status?: string; prStatus?: string }> =
  [];
let findManyCalls = 0;

let sessionsById: Record<
  string,
  {
    id: string;
    userId: string;
    prStatus: "open" | "closed" | "merged" | null;
    prNumber: number | null;
    repoOwner: string | null;
    repoName: string | null;
  }
> = {};

let githubTokensByUserId: Record<string, string | null> = {};

const processedDeliveryIds = new Set<string>();

const recordWebhookDeliveryIfNewMock = mock(async (deliveryId: string) => {
  if (processedDeliveryIds.has(deliveryId)) {
    return false;
  }

  processedDeliveryIds.add(deliveryId);
  return true;
});

const getSessionByIdMock = mock(
  async (sessionId: string) => sessionsById[sessionId] ?? null,
);
const getUserGitHubTokenMock = mock(
  async (userId: string) => githubTokensByUserId[userId] ?? null,
);
const startPrCheckWatcherMock = mock(async () => ({
  started: true as const,
  runId: "watcher-run-1",
}));

mock.module("next/server", () => ({
  after: (task: () => Promise<unknown> | unknown) => {
    void Promise.resolve(task());
  },
}));

mock.module("@/lib/db/installations", () => ({
  deleteInstallationByInstallationId: async () => 0,
  getInstallationsByInstallationId: async () => [],
  updateInstallationsByInstallationId: async () => 0,
  upsertInstallation: async () => undefined,
}));

mock.module("@/lib/db/sessions", () => ({
  getSessionById: getSessionByIdMock,
  updateSession: async () => null,
}));

mock.module("@/lib/github/token", () => ({
  getUserGitHubToken: getUserGitHubTokenMock,
}));

mock.module("@/app/workflows/pr-check-watcher", () => ({
  startPrCheckWatcher: startPrCheckWatcherMock,
}));

mock.module("@/lib/sandbox/archive-session", () => ({
  archiveSession: async () => ({
    session: null,
    archiveTriggered: false,
  }),
}));

mock.module("@/lib/db/client", () => ({
  db: {
    query: {
      sessions: {
        findMany: async () => {
          findManyCalls += 1;
          return linkedSessions;
        },
      },
    },
  },
}));

mock.module("@/lib/db/pr-remediation", () => ({
  recordWebhookDeliveryIfNew: recordWebhookDeliveryIfNewMock,
}));

let routeImportVersion = 0;

async function loadRouteModule() {
  routeImportVersion += 1;
  return import(`./route?test=${routeImportVersion}`);
}

function signPayload(payload: string): string {
  return `sha256=${createHmac("sha256", process.env.GITHUB_WEBHOOK_SECRET ?? "")
    .update(payload)
    .digest("hex")}`;
}

function createWebhookRequest(input: {
  event: string;
  payload: Record<string, unknown>;
  deliveryId?: string;
}) {
  const payloadText = JSON.stringify(input.payload);
  const headers = new Headers({
    "Content-Type": "application/json",
    "x-github-event": input.event,
    "x-hub-signature-256": signPayload(payloadText),
  });

  if (input.deliveryId) {
    headers.set("x-github-delivery", input.deliveryId);
  }

  return new Request("http://localhost/api/github/webhook", {
    method: "POST",
    headers,
    body: payloadText,
  });
}

function buildCheckRunPayload(prNumber: number): Record<string, unknown> {
  return {
    action: "completed",
    repository: {
      name: "repo-1",
      owner: {
        login: "Acme",
      },
    },
    check_run: {
      pull_requests: [{ number: prNumber }],
    },
  };
}

async function flushBackgroundTasks(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("/api/github/webhook", () => {
  beforeEach(() => {
    process.env.GITHUB_WEBHOOK_SECRET = "test-webhook-secret";
    linkedSessions = [];
    sessionsById = {};
    githubTokensByUserId = {};
    findManyCalls = 0;
    processedDeliveryIds.clear();

    recordWebhookDeliveryIfNewMock.mockClear();
    getSessionByIdMock.mockClear();
    getUserGitHubTokenMock.mockClear();
    startPrCheckWatcherMock.mockClear();
  });

  afterAll(() => {
    if (originalWebhookSecret === undefined) {
      delete process.env.GITHUB_WEBHOOK_SECRET;
    } else {
      process.env.GITHUB_WEBHOOK_SECRET = originalWebhookSecret;
    }
  });

  test("triggers evaluation on check_run completed for tracked PR", async () => {
    linkedSessions = [{ id: "session-1", prStatus: "open" }];
    sessionsById["session-1"] = {
      id: "session-1",
      userId: "user-1",
      prStatus: "open",
      prNumber: 77,
      repoOwner: "acme",
      repoName: "repo-1",
    };
    githubTokensByUserId["user-1"] = "gh-token";

    const { POST } = await loadRouteModule();

    const response = await POST(
      createWebhookRequest({
        event: "check_run",
        payload: buildCheckRunPayload(77),
        deliveryId: "delivery-1",
      }),
    );

    const body = (await response.json()) as {
      ok: boolean;
      event: string;
      matchedSessions: number;
      triggeredSessions: number;
    };

    expect(response.status).toBe(200);
    expect(body).toEqual({
      ok: true,
      event: "check_run",
      matchedSessions: 1,
      triggeredSessions: 1,
    });

    expect(findManyCalls).toBe(1);

    await flushBackgroundTasks();

    expect(getSessionByIdMock).toHaveBeenCalledWith("session-1");
    expect(getUserGitHubTokenMock).toHaveBeenCalledWith("user-1");
    expect(startPrCheckWatcherMock).toHaveBeenCalledWith({
      sessionId: "session-1",
      userId: "user-1",
      prNumber: 77,
      repoOwner: "acme",
      repoName: "repo-1",
    });
  });

  test("skips duplicate delivery via idempotency guard", async () => {
    linkedSessions = [{ id: "session-1", prStatus: "open" }];
    sessionsById["session-1"] = {
      id: "session-1",
      userId: "user-1",
      prStatus: "open",
      prNumber: 77,
      repoOwner: "acme",
      repoName: "repo-1",
    };
    githubTokensByUserId["user-1"] = "gh-token";

    const { POST } = await loadRouteModule();

    const first = await POST(
      createWebhookRequest({
        event: "check_run",
        payload: buildCheckRunPayload(77),
        deliveryId: "duplicate-delivery",
      }),
    );

    expect(first.status).toBe(200);
    expect(findManyCalls).toBe(1);

    await flushBackgroundTasks();

    expect(startPrCheckWatcherMock).toHaveBeenCalledTimes(1);

    const second = await POST(
      createWebhookRequest({
        event: "check_run",
        payload: buildCheckRunPayload(77),
        deliveryId: "duplicate-delivery",
      }),
    );

    const secondBody = (await second.json()) as {
      ok: boolean;
      duplicate: boolean;
      deliveryId: string;
    };

    expect(second.status).toBe(200);
    expect(secondBody).toEqual({
      ok: true,
      duplicate: true,
      deliveryId: "duplicate-delivery",
    });
    expect(findManyCalls).toBe(1);
    expect(startPrCheckWatcherMock).toHaveBeenCalledTimes(1);
  });

  test("ignores events for unlinked PRs", async () => {
    linkedSessions = [];
    const { POST } = await loadRouteModule();

    const response = await POST(
      createWebhookRequest({
        event: "check_run",
        payload: buildCheckRunPayload(55),
        deliveryId: "delivery-unlinked",
      }),
    );

    const body = (await response.json()) as {
      ok: boolean;
      event: string;
      matchedSessions: number;
      triggeredSessions: number;
    };

    expect(response.status).toBe(200);
    expect(body).toEqual({
      ok: true,
      event: "check_run",
      matchedSessions: 0,
      triggeredSessions: 0,
    });
    expect(findManyCalls).toBe(1);

    await flushBackgroundTasks();

    expect(startPrCheckWatcherMock).not.toHaveBeenCalled();
  });
});
