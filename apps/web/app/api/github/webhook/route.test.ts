import { createHmac } from "crypto";
import { beforeEach, describe, expect, mock, test } from "bun:test";

interface TestSessionRecord {
  id: string;
  userId: string;
  repoOwner: string;
  repoName: string;
  prNumber: number;
  prStatus: "open" | "merged" | "closed" | null;
  status: "running" | "archived";
  sandboxState: unknown;
}

interface UpsertInstallationCall {
  userId: string;
  installationId: number;
  accountLogin: string;
  accountType: "User" | "Organization";
  repositorySelection: string | undefined;
  installationUrl: string | null;
}

const WEBHOOK_SECRET = "test-webhook-secret";

let linkedSessions: TestSessionRecord[];
let updateSessionCalls: Array<{
  sessionId: string;
  update: Record<string, unknown>;
}>;
let updateSessionResult: { id: string } | null;
let archiveCalls: Array<{
  sessionId: string;
  update: Record<string, unknown> | undefined;
  logPrefix: string | undefined;
}>;
let archiveResult: {
  session: { id: string } | null;
  archiveTriggered: boolean;
};
let existingInstallations: Array<{
  userId: string;
  repositorySelection: string;
}>;
let upsertInstallationCalls: UpsertInstallationCall[];
let deleteInstallationCalls: number[];
let deleteInstallationResult = 1;
let updateInstallationsCalls: Array<{
  installationId: number;
  update: Record<string, unknown>;
}>;
let updateInstallationsResult = 1;

mock.module("next/server", () => ({
  after: (callback: () => Promise<void>) => {
    void callback();
  },
}));

mock.module("@/lib/db/client", () => ({
  db: {
    query: {
      sessions: {
        findMany: async () => linkedSessions,
      },
    },
  },
}));

mock.module("@/lib/db/sessions", () => ({
  updateSession: async (sessionId: string, update: Record<string, unknown>) => {
    updateSessionCalls.push({ sessionId, update });
    return updateSessionResult;
  },
}));

mock.module("@/lib/sandbox/archive-session", () => ({
  archiveSession: async (
    sessionId: string,
    options: { update?: Record<string, unknown>; logPrefix?: string },
  ) => {
    archiveCalls.push({
      sessionId,
      update: options.update,
      logPrefix: options.logPrefix,
    });
    return archiveResult;
  },
}));

mock.module("@/lib/db/installations", () => ({
  getInstallationsByInstallationId: async () => existingInstallations,
  upsertInstallation: async (input: UpsertInstallationCall) => {
    upsertInstallationCalls.push(input);
  },
  deleteInstallationByInstallationId: async (installationId: number) => {
    deleteInstallationCalls.push(installationId);
    return deleteInstallationResult;
  },
  updateInstallationsByInstallationId: async (
    installationId: number,
    update: Record<string, unknown>,
  ) => {
    updateInstallationsCalls.push({ installationId, update });
    return updateInstallationsResult;
  },
}));

const routeModulePromise = import("./route");

function sign(payload: string, secret = WEBHOOK_SECRET): string {
  return `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`;
}

function webhookRequest({
  event,
  payload,
  signature,
  omitSignature = false,
  omitEvent = false,
}: {
  event: string;
  payload: unknown;
  signature?: string;
  omitSignature?: boolean;
  omitEvent?: boolean;
}): Request {
  const body = typeof payload === "string" ? payload : JSON.stringify(payload);
  const headers = new Headers();

  if (!omitEvent) {
    headers.set("x-github-event", event);
  }
  if (!omitSignature) {
    headers.set("x-hub-signature-256", signature ?? sign(body));
  }

  return new Request("http://localhost/api/github/webhook", {
    method: "POST",
    headers,
    body,
  });
}

function makeSession(
  overrides: Partial<TestSessionRecord> = {},
): TestSessionRecord {
  return {
    id: "session-1",
    userId: "user-1",
    repoOwner: "Octo-Org",
    repoName: "Hello-World",
    prNumber: 42,
    prStatus: "open",
    status: "running",
    sandboxState: { type: "vercel" },
    ...overrides,
  };
}

function pullRequestPayload({
  action,
  merged,
  number = 42,
}: {
  action: string;
  merged?: boolean;
  number?: number;
}) {
  return {
    action,
    repository: {
      name: "hello-world",
      owner: { login: "octo-org" },
    },
    pull_request: { number, merged },
  };
}

function installationPayload({
  action,
  id = 555,
  repositorySelection,
  htmlUrl,
  account,
}: {
  action: string;
  id?: number;
  repositorySelection?: "all" | "selected";
  htmlUrl?: string | null;
  account?: { login: string; type: string };
}) {
  return {
    action,
    installation: {
      id,
      ...(repositorySelection
        ? { repository_selection: repositorySelection }
        : {}),
      ...(htmlUrl === undefined ? {} : { html_url: htmlUrl }),
      ...(account ? { account } : {}),
    },
  };
}

beforeEach(() => {
  process.env.GITHUB_WEBHOOK_SECRET = WEBHOOK_SECRET;
  linkedSessions = [];
  updateSessionCalls = [];
  updateSessionResult = { id: "session-1" };
  archiveCalls = [];
  archiveResult = { session: { id: "session-1" }, archiveTriggered: true };
  existingInstallations = [];
  upsertInstallationCalls = [];
  deleteInstallationCalls = [];
  deleteInstallationResult = 1;
  updateInstallationsCalls = [];
  updateInstallationsResult = 1;
});

describe("POST /api/github/webhook (transport)", () => {
  test("returns 500 when the webhook secret is not configured", async () => {
    process.env.GITHUB_WEBHOOK_SECRET = "";
    const { POST } = await routeModulePromise;

    const response = await POST(webhookRequest({ event: "ping", payload: {} }));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "GITHUB_WEBHOOK_SECRET is not configured",
    });
  });

  test("returns 400 when the event header is missing", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(
      webhookRequest({ event: "ping", payload: {}, omitEvent: true }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Missing webhook headers",
    });
  });

  test("returns 400 when the signature header is missing", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(
      webhookRequest({ event: "ping", payload: {}, omitSignature: true }),
    );

    expect(response.status).toBe(400);
  });

  test("returns 401 for a signature produced with the wrong secret", async () => {
    const { POST } = await routeModulePromise;
    const body = JSON.stringify({ zen: "hi" });

    const response = await POST(
      webhookRequest({
        event: "ping",
        payload: body,
        signature: sign(body, "wrong-secret"),
      }),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: "Invalid webhook signature",
    });
  });

  test("returns 401 for a signature of a different length", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(
      webhookRequest({ event: "ping", payload: {}, signature: "sha256=short" }),
    );

    expect(response.status).toBe(401);
  });

  test("returns 401 when the body is tampered with after signing", async () => {
    const { POST } = await routeModulePromise;
    const signed = JSON.stringify(pullRequestPayload({ action: "closed" }));
    const tampered = JSON.stringify(
      pullRequestPayload({ action: "closed", number: 99 }),
    );

    const response = await POST(
      webhookRequest({
        event: "pull_request",
        payload: tampered,
        signature: sign(signed),
      }),
    );

    expect(response.status).toBe(401);
  });

  test("acknowledges ping without parsing the payload", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(
      webhookRequest({ event: "ping", payload: "not json at all" }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  test("returns 400 for a correctly signed but unparsable body", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(
      webhookRequest({ event: "pull_request", payload: "{ nope" }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid JSON payload" });
  });

  test("ignores events it does not handle", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(
      webhookRequest({ event: "push", payload: { ref: "refs/heads/main" } }),
    );

    expect(await response.json()).toEqual({
      ok: true,
      ignored: true,
      event: "push",
    });
  });
});

describe("POST /api/github/webhook (pull_request)", () => {
  test("returns 400 for a malformed pull_request payload", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(
      webhookRequest({ event: "pull_request", payload: { action: "closed" } }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid webhook payload" });
  });

  test("ignores pull_request actions other than closed and reopened", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(
      webhookRequest({
        event: "pull_request",
        payload: pullRequestPayload({ action: "synchronize" }),
      }),
    );

    expect(await response.json()).toEqual({
      ok: true,
      ignored: true,
      action: "synchronize",
    });
    expect(updateSessionCalls).toHaveLength(0);
  });

  test("reports zero counts when no session is linked to the PR", async () => {
    linkedSessions = [];
    const { POST } = await routeModulePromise;

    const response = await POST(
      webhookRequest({
        event: "pull_request",
        payload: pullRequestPayload({ action: "closed", merged: true }),
      }),
    );

    expect(await response.json()).toEqual({
      ok: true,
      event: "pull_request",
      action: "closed",
      matchedSessions: 0,
      updatedSessions: 0,
      archivedSessions: 0,
    });
    expect(archiveCalls).toHaveLength(0);
  });

  test("marks a merged PR as merged and archives the session", async () => {
    linkedSessions = [makeSession()];
    const { POST } = await routeModulePromise;

    const response = await POST(
      webhookRequest({
        event: "pull_request",
        payload: pullRequestPayload({ action: "closed", merged: true }),
      }),
    );
    const body = (await response.json()) as {
      prStatus: string;
      matchedSessions: number;
      updatedSessions: number;
      archivedSessions: number;
    };

    expect(body.prStatus).toBe("merged");
    expect(body.matchedSessions).toBe(1);
    expect(body.updatedSessions).toBe(1);
    expect(body.archivedSessions).toBe(1);
    expect(archiveCalls).toHaveLength(1);
    expect(archiveCalls[0]?.update).toEqual({ prStatus: "merged" });
    expect(archiveCalls[0]?.logPrefix).toBe("[GitHub webhook]");
    expect(updateSessionCalls).toHaveLength(0);
  });

  test("marks an unmerged closed PR as closed", async () => {
    linkedSessions = [makeSession()];
    const { POST } = await routeModulePromise;

    const response = await POST(
      webhookRequest({
        event: "pull_request",
        payload: pullRequestPayload({ action: "closed", merged: false }),
      }),
    );
    const body = (await response.json()) as { prStatus: string };

    expect(body.prStatus).toBe("closed");
    expect(archiveCalls[0]?.update).toEqual({ prStatus: "closed" });
  });

  test("reopening restores open status without archiving", async () => {
    linkedSessions = [makeSession({ prStatus: "closed" })];
    const { POST } = await routeModulePromise;

    const response = await POST(
      webhookRequest({
        event: "pull_request",
        payload: pullRequestPayload({ action: "reopened" }),
      }),
    );
    const body = (await response.json()) as {
      prStatus: string;
      updatedSessions: number;
      archivedSessions: number;
    };

    expect(body.prStatus).toBe("open");
    expect(body.updatedSessions).toBe(1);
    expect(body.archivedSessions).toBe(0);
    expect(archiveCalls).toHaveLength(0);
    expect(updateSessionCalls).toEqual([
      { sessionId: "session-1", update: { prStatus: "open" } },
    ]);
  });

  test("skips the update when prStatus already matches", async () => {
    linkedSessions = [makeSession({ prStatus: "open" })];
    const { POST } = await routeModulePromise;

    const response = await POST(
      webhookRequest({
        event: "pull_request",
        payload: pullRequestPayload({ action: "reopened" }),
      }),
    );
    const body = (await response.json()) as { updatedSessions: number };

    expect(updateSessionCalls).toHaveLength(0);
    expect(body.updatedSessions).toBe(0);
  });

  test("does not re-archive an already archived session", async () => {
    linkedSessions = [makeSession({ status: "archived", prStatus: "open" })];
    const { POST } = await routeModulePromise;

    const response = await POST(
      webhookRequest({
        event: "pull_request",
        payload: pullRequestPayload({ action: "closed", merged: true }),
      }),
    );
    const body = (await response.json()) as {
      updatedSessions: number;
      archivedSessions: number;
    };

    expect(archiveCalls).toHaveLength(0);
    expect(updateSessionCalls).toEqual([
      { sessionId: "session-1", update: { prStatus: "merged" } },
    ]);
    expect(body.updatedSessions).toBe(1);
    expect(body.archivedSessions).toBe(0);
  });

  test("counts each linked session independently", async () => {
    linkedSessions = [
      makeSession({ id: "session-1" }),
      makeSession({ id: "session-2", status: "archived" }),
    ];
    const { POST } = await routeModulePromise;

    const response = await POST(
      webhookRequest({
        event: "pull_request",
        payload: pullRequestPayload({ action: "closed", merged: true }),
      }),
    );
    const body = (await response.json()) as {
      matchedSessions: number;
      updatedSessions: number;
      archivedSessions: number;
    };

    expect(body.matchedSessions).toBe(2);
    expect(body.updatedSessions).toBe(2);
    expect(body.archivedSessions).toBe(1);
    expect(archiveCalls.map((call) => call.sessionId)).toEqual(["session-1"]);
    expect(updateSessionCalls.map((call) => call.sessionId)).toEqual([
      "session-2",
    ]);
  });

  test("does not count an archive that returned no session", async () => {
    linkedSessions = [makeSession()];
    archiveResult = { session: null, archiveTriggered: false };
    const { POST } = await routeModulePromise;

    const response = await POST(
      webhookRequest({
        event: "pull_request",
        payload: pullRequestPayload({ action: "closed", merged: true }),
      }),
    );
    const body = (await response.json()) as {
      updatedSessions: number;
      archivedSessions: number;
    };

    expect(body.updatedSessions).toBe(0);
    expect(body.archivedSessions).toBe(0);
  });
});

describe("POST /api/github/webhook (installation)", () => {
  test("returns 400 for a malformed installation payload", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(
      webhookRequest({ event: "installation", payload: { action: "created" } }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid webhook payload" });
  });

  test("deletes the installation on the deleted action", async () => {
    deleteInstallationResult = 3;
    const { POST } = await routeModulePromise;

    const response = await POST(
      webhookRequest({
        event: "installation",
        payload: installationPayload({ action: "deleted", id: 555 }),
      }),
    );

    expect(await response.json()).toEqual({ ok: true, deleted: 3 });
    expect(deleteInstallationCalls).toEqual([555]);
    expect(upsertInstallationCalls).toHaveLength(0);
  });

  test("does not delete on installation_repositories removed", async () => {
    existingInstallations = [{ userId: "user-1", repositorySelection: "all" }];
    const { POST } = await routeModulePromise;

    await POST(
      webhookRequest({
        event: "installation_repositories",
        payload: installationPayload({
          action: "removed",
          repositorySelection: "selected",
          account: { login: "octo-org", type: "Organization" },
        }),
      }),
    );

    expect(deleteInstallationCalls).toHaveLength(0);
    expect(upsertInstallationCalls).toHaveLength(1);
  });

  test("upserts every existing row when account info is present", async () => {
    existingInstallations = [
      { userId: "user-1", repositorySelection: "all" },
      { userId: "user-2", repositorySelection: "all" },
    ];
    const { POST } = await routeModulePromise;

    const response = await POST(
      webhookRequest({
        event: "installation",
        payload: installationPayload({
          action: "created",
          id: 555,
          repositorySelection: "selected",
          htmlUrl: "https://github.com/settings/installations/555",
          account: { login: "octo-org", type: "Organization" },
        }),
      }),
    );

    expect(await response.json()).toEqual({ ok: true, updatedUsers: 2 });
    expect(upsertInstallationCalls).toEqual([
      {
        userId: "user-1",
        installationId: 555,
        accountLogin: "octo-org",
        accountType: "Organization",
        repositorySelection: "selected",
        installationUrl: "https://github.com/settings/installations/555",
      },
      {
        userId: "user-2",
        installationId: 555,
        accountLogin: "octo-org",
        accountType: "Organization",
        repositorySelection: "selected",
        installationUrl: "https://github.com/settings/installations/555",
      },
    ]);
  });

  test("normalizes any non-Organization account type to User", async () => {
    existingInstallations = [{ userId: "user-1", repositorySelection: "all" }];
    const { POST } = await routeModulePromise;

    await POST(
      webhookRequest({
        event: "installation",
        payload: installationPayload({
          action: "created",
          account: { login: "octocat", type: "Bot" },
        }),
      }),
    );

    expect(upsertInstallationCalls[0]?.accountType).toBe("User");
  });

  test("falls back to the stored repositorySelection when absent", async () => {
    existingInstallations = [{ userId: "user-1", repositorySelection: "all" }];
    const { POST } = await routeModulePromise;

    await POST(
      webhookRequest({
        event: "installation",
        payload: installationPayload({
          action: "created",
          account: { login: "octocat", type: "User" },
        }),
      }),
    );

    expect(upsertInstallationCalls[0]?.repositorySelection).toBe("all");
    expect(upsertInstallationCalls[0]?.installationUrl).toBeNull();
  });

  test("ignores the event when there is nothing to update", async () => {
    existingInstallations = [];
    const { POST } = await routeModulePromise;

    const response = await POST(
      webhookRequest({
        event: "installation",
        payload: installationPayload({ action: "created" }),
      }),
    );

    expect(await response.json()).toEqual({
      ok: true,
      ignored: true,
      reason: "no-updates",
    });
    expect(updateInstallationsCalls).toHaveLength(0);
  });

  test("applies a partial update when no rows carry account info yet", async () => {
    existingInstallations = [];
    updateInstallationsResult = 2;
    const { POST } = await routeModulePromise;

    const response = await POST(
      webhookRequest({
        event: "installation",
        payload: installationPayload({
          action: "created",
          id: 777,
          repositorySelection: "all",
          htmlUrl: "https://github.com/settings/installations/777",
        }),
      }),
    );

    expect(await response.json()).toEqual({ ok: true, updatedUsers: 2 });
    expect(updateInstallationsCalls).toEqual([
      {
        installationId: 777,
        update: {
          repositorySelection: "all",
          installationUrl: "https://github.com/settings/installations/777",
        },
      },
    ]);
    expect(upsertInstallationCalls).toHaveLength(0);
  });

  test("omits absent fields from the partial update", async () => {
    existingInstallations = [];
    const { POST } = await routeModulePromise;

    await POST(
      webhookRequest({
        event: "installation",
        payload: installationPayload({
          action: "created",
          repositorySelection: "selected",
          htmlUrl: null,
        }),
      }),
    );

    expect(updateInstallationsCalls[0]?.update).toEqual({
      repositorySelection: "selected",
    });
  });
});
