import { beforeEach, describe, expect, mock, test } from "bun:test";
import { AuthorizationError } from "@/lib/auth/authorization-error";
import type { Approval } from "@/lib/db/schema";
import type { PolicyEventInput } from "@/lib/policy/policy-events";

type Row = Record<string, unknown>;

const HOUR = 60 * 60 * 1000;
const NOW = new Date("2026-08-03T12:00:00Z");

let storedRow: Row | null = null;
let actorId: string | null = "user-1";
let updateSets: Row[] = [];
let updateMatchesNothing = false;
let policyEventCalls: PolicyEventInput[] = [];

function pendingRow(overrides: Row = {}): Row {
  return {
    id: "approval-1",
    sessionId: "session-1",
    chatId: "chat-1",
    workflowRunId: "run-1",
    kind: "tool-call",
    toolName: "bash",
    toolCallId: "call-1",
    inputSummary: { command: "git push origin main" },
    decision: "pending",
    decidedBy: null,
    consumedAt: null,
    expiresAt: new Date(NOW.getTime() + HOUR),
    createdAt: new Date(NOW.getTime() - HOUR),
    decidedAt: null,
    ...overrides,
  };
}

mock.module("@/lib/policy/session-access", () => ({
  requireSessionActor: () => {
    if (!actorId) {
      return Promise.reject(new AuthorizationError("forbidden"));
    }
    return Promise.resolve({
      userId: actorId,
      organizationId: "org-1",
      role: "member",
      session: { id: "session-1", userId: actorId, posture: "auto" },
    });
  },
}));

mock.module("@/lib/policy/approvals", () => ({
  getApprovalForSession: () => Promise.resolve(storedRow as Approval | null),
}));

mock.module("@/lib/policy/policy-events", () => ({
  recordPolicyEvent: (input: PolicyEventInput) => {
    policyEventCalls.push(input);
    return Promise.resolve();
  },
}));

mock.module("@/lib/db/client", () => ({
  db: {
    update: () => ({
      set: (values: Row) => ({
        where: () => ({
          returning: () => {
            updateSets.push(values);
            if (updateMatchesNothing || !storedRow) {
              return Promise.resolve([]);
            }
            storedRow = { ...storedRow, ...values };
            return Promise.resolve([storedRow]);
          },
        }),
      }),
    }),
  },
}));

const modulePromise = import("@/lib/policy/approval-decisions");

beforeEach(() => {
  storedRow = pendingRow();
  actorId = "user-1";
  updateSets = [];
  updateMatchesNothing = false;
  policyEventCalls = [];
});

describe("decideApproval authorization", () => {
  test("records the decision for a user entitled to act on the session", async () => {
    const { decideApproval } = await modulePromise;

    const view = await decideApproval({
      sessionId: "session-1",
      approvalId: "approval-1",
      decision: "approved",
      now: NOW,
    });

    expect(view.decision).toBe("approved");
    expect(updateSets[0]).toMatchObject({
      decision: "approved",
      decidedBy: "user-1",
      decidedAt: NOW,
    });
  });

  test("refuses a caller who may not act on the session and leaves it pending", async () => {
    actorId = null;
    const { decideApproval } = await modulePromise;

    await expect(
      decideApproval({
        sessionId: "session-1",
        approvalId: "approval-1",
        decision: "approved",
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);

    expect(updateSets).toEqual([]);
    expect(storedRow?.decision).toBe("pending");
  });

  test("authorizes before reading, so an id cannot be probed", async () => {
    actorId = null;
    storedRow = null;
    const { decideApproval } = await modulePromise;

    const error = await decideApproval({
      sessionId: "session-1",
      approvalId: "approval-1",
      decision: "denied",
      now: NOW,
    }).catch((caught: unknown) => caught);

    // 403, not 404: the caller learns nothing about whether the row exists.
    expect((error as AuthorizationError).status).toBe(403);
  });
});

describe("decideApproval terminal states", () => {
  test("refuses a decision on an already-approved approval", async () => {
    storedRow = pendingRow({ decision: "approved", decidedBy: "user-1" });
    const { decideApproval } = await modulePromise;

    await expect(
      decideApproval({
        sessionId: "session-1",
        approvalId: "approval-1",
        decision: "denied",
        now: NOW,
      }),
    ).rejects.toMatchObject({
      name: "ApprovalError",
      kind: "already-decided",
    });
    expect(updateSets).toEqual([]);
  });

  test("refuses a decision on an already-denied approval", async () => {
    storedRow = pendingRow({ decision: "denied" });
    const { decideApproval } = await modulePromise;

    await expect(
      decideApproval({
        sessionId: "session-1",
        approvalId: "approval-1",
        decision: "approved",
        now: NOW,
      }),
    ).rejects.toMatchObject({ kind: "already-decided" });
  });

  /** Expiry is computed on read, so no sweeper needs to have run. */
  test("refuses a decision on an expired approval", async () => {
    storedRow = pendingRow({ expiresAt: new Date(NOW.getTime() - 1) });
    const { decideApproval } = await modulePromise;

    await expect(
      decideApproval({
        sessionId: "session-1",
        approvalId: "approval-1",
        decision: "approved",
        now: NOW,
      }),
    ).rejects.toMatchObject({ kind: "already-decided" });
    expect(updateSets).toEqual([]);
  });

  test("refuses when there is no such approval on this session", async () => {
    storedRow = null;
    const { decideApproval } = await modulePromise;

    await expect(
      decideApproval({
        sessionId: "session-1",
        approvalId: "nope",
        decision: "approved",
        now: NOW,
      }),
    ).rejects.toMatchObject({ kind: "not-found" });
  });

  test("refuses when the conditional write loses a race", async () => {
    updateMatchesNothing = true;
    const { decideApproval } = await modulePromise;

    await expect(
      decideApproval({
        sessionId: "session-1",
        approvalId: "approval-1",
        decision: "approved",
        now: NOW,
      }),
    ).rejects.toMatchObject({ kind: "already-decided" });
  });

  test("rejects a decision value that is not approve or deny", async () => {
    const { decideApproval } = await modulePromise;

    await expect(
      decideApproval({
        sessionId: "session-1",
        approvalId: "approval-1",
        decision: "pending" as unknown as "approved",
        now: NOW,
      }),
    ).rejects.toMatchObject({ kind: "invalid" });
    expect(updateSets).toEqual([]);
  });
});

describe("decideApproval audit", () => {
  test("records a policy event carrying the decision and the posture", async () => {
    const { decideApproval } = await modulePromise;

    await decideApproval({
      sessionId: "session-1",
      approvalId: "approval-1",
      decision: "denied",
      now: NOW,
    });

    expect(policyEventCalls).toHaveLength(1);
    expect(policyEventCalls[0]).toMatchObject({
      sessionId: "session-1",
      workflowRunId: "run-1",
      toolName: "bash",
      decision: "deny",
      posture: "auto",
    });
  });

  test("records an approval as an ask that was answered", async () => {
    const { decideApproval } = await modulePromise;

    await decideApproval({
      sessionId: "session-1",
      approvalId: "approval-1",
      decision: "approved",
      now: NOW,
    });

    expect(policyEventCalls[0]?.decision).toBe("ask");
  });
});
