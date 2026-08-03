/**
 * The kill switch on the webhook-triggered run-start path.
 *
 * Lives in its own file rather than in a general route test because it is one
 * capability's behaviour: a paused deployment must create nothing and must
 * report the pause through Linear — the trigger's failure-visibility path —
 * rather than only a server log line nobody delegating an issue will read.
 */

import { createHmac } from "crypto";
import { beforeEach, describe, expect, mock, test } from "bun:test";
import {
  orgMembers,
  orgSettings,
  organizations,
  sessions,
  users,
} from "@/lib/db/schema";

const WEBHOOK_SECRET = "test-webhook-secret";

let agentRunsPaused = false;
let orgSettingsReadError: Error | null = null;
let createdSessions: Record<string, unknown>[] = [];
let postedComments: { issueId: string; body: string }[] = [];
let deferredTasks: Promise<unknown>[] = [];

/** Rows each table's SELECT resolves to. */
const selectRows = new Map<unknown, Record<string, unknown>[]>();

interface SelectChain {
  where: () => SelectChain;
  orderBy: () => SelectChain;
  limit: () => Promise<Record<string, unknown>[]>;
}

async function rowsFor(table: unknown): Promise<Record<string, unknown>[]> {
  // Read lazily: a test flips the kill switch after `beforeEach` has run.
  if (table === orgSettings) {
    if (orgSettingsReadError) {
      throw orgSettingsReadError;
    }
    return [
      {
        organizationId: "org-1",
        agentRunsPaused,
        dailyTokenBudget: null,
      },
    ];
  }
  return selectRows.get(table) ?? [];
}

function selectChain(table: unknown): SelectChain {
  return {
    where: () => selectChain(table),
    orderBy: () => selectChain(table),
    limit: () => rowsFor(table),
  };
}

mock.module("next/server", () => ({
  after: (task: () => Promise<unknown>) => {
    deferredTasks.push(task());
  },
}));

mock.module("@/lib/db/client", () => ({
  db: {
    select: () => ({ from: (table: unknown) => selectChain(table) }),
  },
}));

mock.module("@/lib/config/linear", () => ({
  getLinearConfig: () => ({ webhookSecret: WEBHOOK_SECRET }),
}));

mock.module("@/lib/config/public", () => ({
  getPublicConfig: () => ({ appUrl: "https://quackops.test" }),
}));

mock.module("@/lib/linear/token", () => ({
  getLinearWorkspaceToken: async () => "linear-token",
}));

mock.module("@/lib/linear/activities", () => ({
  postLinearThoughtActivity: async () => {},
  postLinearComment: async (_token: string, issueId: string, body: string) => {
    postedComments.push({ issueId, body });
  },
}));

mock.module("@/lib/linear/issues", () => ({
  getLinearIssue: async () => null,
  buildIssueContextBlock: () => "",
}));

mock.module("@/lib/db/sessions", () => ({
  createSessionWithInitialChat: async (input: Record<string, unknown>) => {
    createdSessions.push(input);
  },
}));

const routeModulePromise = import("./route");

function createWebhookRequest(): Request {
  const payload = JSON.stringify({
    type: "AgentSession",
    action: "created",
    data: {
      id: "agent-session-1",
      issue: { id: "issue-1", url: "https://linear.app/issue-1" },
      actor: { email: "ada@nextdegree.org", name: "Ada" },
    },
  });

  return new Request("http://localhost/api/linear/webhook", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "linear-signature": createHmac("sha256", WEBHOOK_SECRET)
        .update(payload)
        .digest("hex"),
    },
    body: payload,
  });
}

async function postWebhook(): Promise<void> {
  const { POST } = await routeModulePromise;
  await POST(createWebhookRequest());
  await Promise.all(deferredTasks);
}

beforeEach(() => {
  agentRunsPaused = false;
  orgSettingsReadError = null;
  createdSessions = [];
  postedComments = [];
  deferredTasks = [];
  selectRows.clear();
  selectRows.set(users, [{ id: "user-1" }]);
  selectRows.set(sessions, []);
  selectRows.set(organizations, [{ id: "org-1" }]);
  selectRows.set(orgMembers, [
    {
      id: "member-1",
      organizationId: "org-1",
      userId: "user-1",
      role: "member",
    },
  ]);
});

describe("Linear webhook run start", () => {
  test("creates the session when agent runs are not paused", async () => {
    await postWebhook();

    expect(createdSessions).toHaveLength(1);
    expect(postedComments).toEqual([]);
  });

  test("creates nothing while the kill switch is on", async () => {
    agentRunsPaused = true;

    await postWebhook();

    expect(createdSessions).toEqual([]);
  });

  test("reports the pause through the Linear thread, not only a log line", async () => {
    agentRunsPaused = true;

    await postWebhook();

    expect(postedComments).toHaveLength(1);
    expect(postedComments[0]?.issueId).toBe("issue-1");
    expect(postedComments[0]?.body).toMatch(/paused/i);
  });

  test("fails closed when the kill switch cannot be read", async () => {
    orgSettingsReadError = new Error("connection reset");

    await postWebhook();

    expect(createdSessions).toEqual([]);
    expect(postedComments).toHaveLength(1);
  });
});
