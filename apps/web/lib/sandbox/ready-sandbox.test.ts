import { beforeEach, describe, expect, mock, test } from "bun:test";

/**
 * The path an approval granted after the sandbox hibernated has to take.
 *
 * This is existing machinery — the chat workflow has always used it — and the
 * point of the test is that the *same* machinery is what the approval-execution
 * route reaches, so a session whose sandbox is gone is reprovisioned rather
 * than failing. Only the workflow start is stubbed; the decision logic under
 * test is the real function.
 */

type Row = Record<string, unknown>;

let sessionRows: Row[] = [];
let kickCalls: string[] = [];
let waitedRunIds: string[] = [];
let kickResult: Row = { status: "started", runId: "run-provision-1" };

mock.module("@/lib/db/sessions", () => ({
  getSessionById: () => Promise.resolve(sessionRows.shift() ?? null),
}));

mock.module("@/lib/sandbox/provisioning-kick", () => ({
  kickSandboxProvisioningWorkflow: (sessionId: string) => {
    kickCalls.push(sessionId);
    return Promise.resolve(kickResult);
  },
  waitForSandboxProvisioningRun: (runId: string) => {
    waitedRunIds.push(runId);
    return Promise.resolve(undefined);
  },
}));

mock.module("@/lib/sandbox/utils", () => ({
  isSandboxActive: (state: unknown) =>
    typeof state === "object" && state !== null && "sandboxName" in state,
}));

const modulePromise = import("@/lib/sandbox/ready-sandbox");

function session(overrides: Row = {}): Row {
  return {
    id: "session-1",
    userId: "user-1",
    status: "active",
    title: "My session",
    sandboxState: { type: "vercel", sandboxName: "session_session-1" },
    lifecycleError: null,
    ...overrides,
  };
}

beforeEach(() => {
  sessionRows = [];
  kickCalls = [];
  waitedRunIds = [];
  kickResult = { status: "started", runId: "run-provision-1" };
});

describe("getReadySessionSandbox", () => {
  test("returns a live sandbox without provisioning anything", async () => {
    sessionRows = [session()];
    const { getReadySessionSandbox } = await modulePromise;

    const ready = await getReadySessionSandbox({
      sessionId: "session-1",
      userId: "user-1",
    });

    expect(ready.didSetupWorkspace).toBe(false);
    expect(kickCalls).toEqual([]);
  });

  test("reprovisions a hibernated sandbox and waits for the run", async () => {
    sessionRows = [session({ sandboxState: null }), session()];
    const { getReadySessionSandbox } = await modulePromise;

    const ready = await getReadySessionSandbox({
      sessionId: "session-1",
      userId: "user-1",
    });

    expect(kickCalls).toEqual(["session-1"]);
    expect(waitedRunIds).toEqual(["run-provision-1"]);
    expect(ready.didSetupWorkspace).toBe(true);
    expect(ready.session.sandboxState).toMatchObject({
      sandboxName: "session_session-1",
    });
  });

  test("reports the lifecycle error when provisioning did not produce a sandbox", async () => {
    sessionRows = [
      session({ sandboxState: null }),
      session({ sandboxState: null, lifecycleError: "clone failed" }),
    ];
    const { getReadySessionSandbox } = await modulePromise;

    await expect(
      getReadySessionSandbox({ sessionId: "session-1", userId: "user-1" }),
    ).rejects.toThrow("clone failed");
  });

  test("refuses a session that is not the caller's", async () => {
    sessionRows = [session({ userId: "somebody-else" })];
    const { getReadySessionSandbox } = await modulePromise;

    await expect(
      getReadySessionSandbox({ sessionId: "session-1", userId: "user-1" }),
    ).rejects.toThrow("Unauthorized");
  });

  test("refuses an archived session", async () => {
    sessionRows = [session({ status: "archived" })];
    const { getReadySessionSandbox } = await modulePromise;

    await expect(
      getReadySessionSandbox({ sessionId: "session-1", userId: "user-1" }),
    ).rejects.toThrow("archived");
  });
});
