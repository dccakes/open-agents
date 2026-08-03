import { beforeEach, describe, expect, mock, test } from "bun:test";
import { orgSettings, organizations } from "@/lib/db/schema";

/**
 * The fake stops at the database client rather than at `@/lib/org/settings`.
 *
 * Two reasons: mocking the settings module would replace it for every test
 * file that loads afterwards (Bun's module mocks are process-global), and
 * driving the real read means this covers the wiring the kill switch actually
 * depends on — not just the branch in this file.
 */

let agentRunsPaused = false;
let readError: Error | null = null;
let settingsReads = 0;

async function rowsFor(table: unknown): Promise<Record<string, unknown>[]> {
  if (table === organizations) {
    return [{ id: "org-1" }];
  }
  if (table === orgSettings) {
    settingsReads += 1;
    if (readError) {
      throw readError;
    }
    return [
      {
        organizationId: "org-1",
        agentRunsPaused,
        dailyTokenBudget: null,
      },
    ];
  }
  return [];
}

function selectChain(table: unknown) {
  return {
    where: () => selectChain(table),
    limit: () => rowsFor(table),
  };
}

mock.module("@/lib/db/client", () => ({
  db: {
    select: () => ({ from: (table: unknown) => selectChain(table) }),
  },
}));

const modulePromise = import("@/lib/org/agent-runs-gate");

beforeEach(() => {
  agentRunsPaused = false;
  readError = null;
  settingsReads = 0;
});

describe("checkAgentRunStartAllowed", () => {
  test("allows a run start when the kill switch is off", async () => {
    const { checkAgentRunStartAllowed } = await modulePromise;

    await expect(checkAgentRunStartAllowed()).resolves.toEqual({
      allowed: true,
    });
  });

  test("blocks a run start when the kill switch is on", async () => {
    agentRunsPaused = true;
    const { checkAgentRunStartAllowed } = await modulePromise;

    const decision = await checkAgentRunStartAllowed();

    expect(decision.allowed).toBe(false);
    expect(decision.allowed === false && decision.code).toBe(
      "agent_runs_paused",
    );
    expect(decision.allowed === false && decision.message).toMatch(/paused/i);
  });

  test("fails closed when the settings read errors", async () => {
    readError = new Error("connection reset");
    const { checkAgentRunStartAllowed } = await modulePromise;

    const decision = await checkAgentRunStartAllowed();

    expect(decision.allowed).toBe(false);
    expect(decision.allowed === false && decision.code).toBe(
      "org_settings_unavailable",
    );
  });

  test("reads the switch on every call, so clearing it needs no restart", async () => {
    const { checkAgentRunStartAllowed } = await modulePromise;
    agentRunsPaused = true;

    const blocked = await checkAgentRunStartAllowed();
    agentRunsPaused = false;
    const allowed = await checkAgentRunStartAllowed();

    expect(blocked.allowed).toBe(false);
    expect(allowed.allowed).toBe(true);
    expect(settingsReads).toBe(2);
  });
});

describe("agentRunBlockedResponse", () => {
  test("answers a structured paused response rather than a bare error", async () => {
    agentRunsPaused = true;
    const { checkAgentRunStartAllowed, agentRunBlockedResponse } =
      await modulePromise;

    const decision = await checkAgentRunStartAllowed();
    if (decision.allowed) {
      throw new Error("expected the run start to be blocked");
    }
    const response = agentRunBlockedResponse(decision);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: decision.message,
      code: "agent_runs_paused",
      agentRunsPaused: true,
    });
  });

  test("distinguishes an unreadable switch from a set one", async () => {
    readError = new Error("connection reset");
    const { checkAgentRunStartAllowed, agentRunBlockedResponse } =
      await modulePromise;

    const decision = await checkAgentRunStartAllowed();
    if (decision.allowed) {
      throw new Error("expected the run start to be blocked");
    }
    const body = (await agentRunBlockedResponse(decision).json()) as {
      code: string;
      agentRunsPaused: boolean;
    };

    expect(body.code).toBe("org_settings_unavailable");
    expect(body.agentRunsPaused).toBe(false);
  });
});
