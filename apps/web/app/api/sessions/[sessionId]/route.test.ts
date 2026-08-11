import { beforeEach, describe, expect, mock, test } from "bun:test";

interface TestSessionRecord {
  id: string;
  userId: string;
  title: string;
  status: "running" | "completed" | "failed" | "archived";
  snapshotUrl: string | null;
  prStatus: "open" | "merged" | "closed" | null;
  lifecycleState: string | null;
  lifecycleError: string | null;
  sandboxState: unknown;
}

type SessionUpdate = Record<string, unknown>;

interface ArchiveCall {
  sessionId: string;
  currentSession: TestSessionRecord;
  update: SessionUpdate | undefined;
  logPrefix: string | undefined;
}

let authSession: { user: { id: string } } | null;
let storedSession: TestSessionRecord | null;
let updateSessionResult: TestSessionRecord | null;
let updateSessionCalls: Array<{ sessionId: string; update: SessionUpdate }>;
let deleteSessionCalls: string[];
let archiveCalls: ArchiveCall[];
let archiveResult: { session: TestSessionRecord | null };

mock.module("next/server", () => ({
  after: (callback: () => Promise<void>) => {
    void callback();
  },
}));

mock.module("@/lib/db/sessions", () => ({
  getSessionById: async () => storedSession,
  updateSession: async (sessionId: string, update: SessionUpdate) => {
    updateSessionCalls.push({ sessionId, update });
    return updateSessionResult;
  },
  deleteSession: async (sessionId: string) => {
    deleteSessionCalls.push(sessionId);
  },
}));

mock.module("@/lib/sandbox/archive-session", () => ({
  archiveSession: async (
    sessionId: string,
    options: {
      currentSession: TestSessionRecord;
      update?: SessionUpdate;
      logPrefix?: string;
    },
  ) => {
    archiveCalls.push({
      sessionId,
      currentSession: options.currentSession,
      update: options.update,
      logPrefix: options.logPrefix,
    });
    return archiveResult;
  },
}));

mock.module("@/lib/session/get-server-session", () => ({
  getServerSession: async () => authSession,
}));

const routeModulePromise = import("./route");

const SESSION_ID = "session-1";

function makeSession(
  overrides: Partial<TestSessionRecord> = {},
): TestSessionRecord {
  return {
    id: SESSION_ID,
    userId: "user-1",
    title: "My session",
    status: "running",
    snapshotUrl: null,
    prStatus: null,
    lifecycleState: null,
    lifecycleError: null,
    sandboxState: { type: "vercel" },
    ...overrides,
  };
}

function makeParams() {
  return { params: Promise.resolve({ sessionId: SESSION_ID }) };
}

function patchRequest(body: unknown): Request {
  return new Request(`http://localhost/api/sessions/${SESSION_ID}`, {
    method: "PATCH",
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  authSession = { user: { id: "user-1" } };
  storedSession = makeSession();
  updateSessionResult = makeSession();
  updateSessionCalls = [];
  deleteSessionCalls = [];
  archiveCalls = [];
  archiveResult = { session: makeSession({ status: "archived" }) };
});

describe("GET /api/sessions/[sessionId]", () => {
  test("returns 401 when unauthenticated", async () => {
    authSession = null;
    const { GET } = await routeModulePromise;

    const response = await GET(new Request("http://localhost"), makeParams());

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Not authenticated" });
  });

  test("returns 404 when the session does not exist", async () => {
    storedSession = null;
    const { GET } = await routeModulePromise;

    const response = await GET(new Request("http://localhost"), makeParams());

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Session not found" });
  });

  test("returns 403 when the session belongs to another user", async () => {
    storedSession = makeSession({ userId: "someone-else" });
    const { GET } = await routeModulePromise;

    const response = await GET(new Request("http://localhost"), makeParams());

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Forbidden" });
  });

  test("returns the session for its owner", async () => {
    const { GET } = await routeModulePromise;

    const response = await GET(new Request("http://localhost"), makeParams());
    const body = (await response.json()) as { session: TestSessionRecord };

    expect(response.status).toBe(200);
    expect(body.session.id).toBe(SESSION_ID);
  });
});

describe("PATCH /api/sessions/[sessionId]", () => {
  test("returns 401 when unauthenticated", async () => {
    authSession = null;
    const { PATCH } = await routeModulePromise;

    const response = await PATCH(patchRequest({ title: "New" }), makeParams());

    expect(response.status).toBe(401);
    expect(updateSessionCalls).toHaveLength(0);
  });

  test("returns 404 when the session does not exist", async () => {
    storedSession = null;
    const { PATCH } = await routeModulePromise;

    const response = await PATCH(patchRequest({ title: "New" }), makeParams());

    expect(response.status).toBe(404);
    expect(updateSessionCalls).toHaveLength(0);
  });

  test("returns 403 without updating another user's session", async () => {
    storedSession = makeSession({ userId: "someone-else" });
    const { PATCH } = await routeModulePromise;

    const response = await PATCH(patchRequest({ title: "New" }), makeParams());

    expect(response.status).toBe(403);
    expect(updateSessionCalls).toHaveLength(0);
  });

  test("returns 400 for a malformed JSON body", async () => {
    const { PATCH } = await routeModulePromise;

    const response = await PATCH(patchRequest("{ not json"), makeParams());

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid JSON body" });
    expect(updateSessionCalls).toHaveLength(0);
  });

  test("applies a plain field update through updateSession", async () => {
    const { PATCH } = await routeModulePromise;

    const response = await PATCH(
      patchRequest({ title: "Renamed", linesAdded: 12 }),
      makeParams(),
    );

    expect(response.status).toBe(200);
    expect(archiveCalls).toHaveLength(0);
    expect(updateSessionCalls).toEqual([
      { sessionId: SESSION_ID, update: { title: "Renamed", linesAdded: 12 } },
    ]);
  });

  test("returns 404 when the update finds no row", async () => {
    updateSessionResult = null;
    const { PATCH } = await routeModulePromise;

    const response = await PATCH(patchRequest({ title: "Gone" }), makeParams());

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Session not found" });
  });

  test("archives through archiveSession when transitioning to archived", async () => {
    const { PATCH } = await routeModulePromise;

    const response = await PATCH(
      patchRequest({ status: "archived" }),
      makeParams(),
    );

    expect(response.status).toBe(200);
    expect(updateSessionCalls).toHaveLength(0);
    expect(archiveCalls).toHaveLength(1);
    expect(archiveCalls[0]?.sessionId).toBe(SESSION_ID);
    expect(archiveCalls[0]?.update).toEqual({ status: "archived" });
    expect(archiveCalls[0]?.logPrefix).toBe("[Sessions]");
  });

  test("does not re-archive a session that is already archived", async () => {
    storedSession = makeSession({ status: "archived" });
    const { PATCH } = await routeModulePromise;

    const response = await PATCH(
      patchRequest({ status: "archived" }),
      makeParams(),
    );

    expect(response.status).toBe(200);
    expect(archiveCalls).toHaveLength(0);
    expect(updateSessionCalls).toHaveLength(1);
  });

  test("returns 404 when archiveSession reports no session", async () => {
    archiveResult = { session: null };
    const { PATCH } = await routeModulePromise;

    const response = await PATCH(
      patchRequest({ status: "archived" }),
      makeParams(),
    );

    expect(response.status).toBe(404);
  });

  test("returns 409 when unarchiving while the sandbox is still pausing", async () => {
    storedSession = makeSession({
      status: "archived",
      snapshotUrl: null,
      sandboxState: {
        type: "vercel",
        sandboxName: "session_1",
        expiresAt: Date.now() + 60_000,
      },
    });
    const { PATCH } = await routeModulePromise;

    const response = await PATCH(
      patchRequest({ status: "running" }),
      makeParams(),
    );
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(409);
    expect(body.error).toContain("still being paused");
    expect(updateSessionCalls).toHaveLength(0);
  });

  test("resets lifecycle fields when unarchiving a snapshotted session", async () => {
    storedSession = makeSession({
      status: "archived",
      snapshotUrl: "https://snapshots.example/session-1",
      lifecycleState: "archived",
      lifecycleError: "boom",
    });
    const { PATCH } = await routeModulePromise;

    const response = await PATCH(
      patchRequest({ status: "running" }),
      makeParams(),
    );

    expect(response.status).toBe(200);
    expect(updateSessionCalls).toEqual([
      {
        sessionId: SESSION_ID,
        update: {
          status: "running",
          lifecycleState: null,
          lifecycleError: null,
        },
      },
    ]);
  });

  test("unarchives a session whose sandbox state has no runtime data", async () => {
    storedSession = makeSession({
      status: "archived",
      snapshotUrl: null,
      sandboxState: { type: "vercel" },
    });
    const { PATCH } = await routeModulePromise;

    const response = await PATCH(
      patchRequest({ status: "running" }),
      makeParams(),
    );

    expect(response.status).toBe(200);
    expect(updateSessionCalls[0]?.update).toMatchObject({
      lifecycleState: null,
      lifecycleError: null,
    });
  });

  test("does not reset lifecycle fields for a non-unarchive status change", async () => {
    const { PATCH } = await routeModulePromise;

    await PATCH(patchRequest({ status: "completed" }), makeParams());

    expect(updateSessionCalls[0]?.update).toEqual({ status: "completed" });
  });
});

describe("DELETE /api/sessions/[sessionId]", () => {
  test("returns 401 when unauthenticated", async () => {
    authSession = null;
    const { DELETE } = await routeModulePromise;

    const response = await DELETE(
      new Request("http://localhost"),
      makeParams(),
    );

    expect(response.status).toBe(401);
    expect(deleteSessionCalls).toHaveLength(0);
  });

  test("returns 404 when the session does not exist", async () => {
    storedSession = null;
    const { DELETE } = await routeModulePromise;

    const response = await DELETE(
      new Request("http://localhost"),
      makeParams(),
    );

    expect(response.status).toBe(404);
    expect(deleteSessionCalls).toHaveLength(0);
  });

  test("returns 403 without deleting another user's session", async () => {
    storedSession = makeSession({ userId: "someone-else" });
    const { DELETE } = await routeModulePromise;

    const response = await DELETE(
      new Request("http://localhost"),
      makeParams(),
    );

    expect(response.status).toBe(403);
    expect(deleteSessionCalls).toHaveLength(0);
  });

  test("deletes the session for its owner", async () => {
    const { DELETE } = await routeModulePromise;

    const response = await DELETE(
      new Request("http://localhost"),
      makeParams(),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(deleteSessionCalls).toEqual([SESSION_ID]);
  });
});
