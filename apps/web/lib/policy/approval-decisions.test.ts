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
let sessionActorCalls = 0;

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
    sessionActorCalls += 1;
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
  getApprovalByToolCall: () => Promise.resolve(storedRow as Approval | null),
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
  sessionActorCalls = 0;
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

/**
 * The other way a decision reaches the server: inside the next chat request,
 * for an approval the user answered in the UI. Recording it is what makes an
 * answered `ask` runnable at all — without it the row stays `pending` and the
 * resume is refused forever.
 */
/** Declared outside the loop below, so the closure captures nothing mutable. */
async function expectTerminalRowUntouched(overrides: Row) {
  storedRow = pendingRow(overrides);
  const { recordAssertedApprovalDecision } = await modulePromise;

  await recordAssertedApprovalDecision({
    sessionId: "session-1",
    toolCallId: "call-1",
    decision: "approved",
    actorUserId: "user-9",
    posture: "auto",
    now: NOW,
  });

  expect(updateSets).toEqual([]);
  expect(policyEventCalls).toEqual([]);
}

describe("recordAssertedApprovalDecision", () => {
  test("moves a pending tool-call row to the decision, attributed to the actor", async () => {
    const { recordAssertedApprovalDecision } = await modulePromise;

    await recordAssertedApprovalDecision({
      sessionId: "session-1",
      toolCallId: "call-1",
      decision: "approved",
      actorUserId: "user-9",
      posture: "auto",
      now: NOW,
    });

    expect(updateSets[0]).toMatchObject({
      decision: "approved",
      decidedBy: "user-9",
      decidedAt: NOW,
    });
  });

  /**
   * The caller has already established the actor may act on the session. Doing
   * it again here would be a second, looser derivation of the same fact.
   */
  test("does not re-derive authorization; it uses the actor it is given", async () => {
    const { recordAssertedApprovalDecision } = await modulePromise;

    await recordAssertedApprovalDecision({
      sessionId: "session-1",
      toolCallId: "call-1",
      decision: "approved",
      actorUserId: "user-9",
      posture: "auto",
      now: NOW,
    });

    expect(sessionActorCalls).toBe(0);
  });

  test("records a denial, so the tool refuses instead of waiting", async () => {
    const { recordAssertedApprovalDecision } = await modulePromise;

    await recordAssertedApprovalDecision({
      sessionId: "session-1",
      toolCallId: "call-1",
      decision: "denied",
      actorUserId: "user-9",
      posture: "strict",
      now: NOW,
    });

    expect(updateSets[0]).toMatchObject({ decision: "denied" });
    expect(policyEventCalls[0]).toMatchObject({
      decision: "deny",
      posture: "strict",
    });
  });

  /** It can only ever answer a row a policy `ask` already created. */
  test("writes nothing when no approval row exists for the tool call", async () => {
    storedRow = null;
    const { recordAssertedApprovalDecision } = await modulePromise;

    await recordAssertedApprovalDecision({
      sessionId: "session-1",
      toolCallId: "forged-call",
      decision: "approved",
      actorUserId: "user-9",
      posture: "auto",
      now: NOW,
    });

    expect(updateSets).toEqual([]);
    expect(policyEventCalls).toEqual([]);
  });

  test("writes nothing for an approval of the other kind", async () => {
    storedRow = pendingRow({ kind: "app-side-effect", toolCallId: null });
    const { recordAssertedApprovalDecision } = await modulePromise;

    await recordAssertedApprovalDecision({
      sessionId: "session-1",
      toolCallId: "call-1",
      decision: "approved",
      actorUserId: "user-9",
      posture: "auto",
      now: NOW,
    });

    expect(updateSets).toEqual([]);
  });

  for (const [label, overrides] of [
    ["denied", { decision: "denied", decidedBy: "user-2" }],
    ["already approved", { decision: "approved", decidedBy: "user-2" }],
    ["expired", { expiresAt: new Date(NOW.getTime() - 1) }],
  ] as const) {
    test(`leaves an ${label} approval exactly as it was`, () =>
      expectTerminalRowUntouched(overrides));
  }

  test("ignores a decision value that is neither approve nor deny", async () => {
    const { recordAssertedApprovalDecision } = await modulePromise;

    await recordAssertedApprovalDecision({
      sessionId: "session-1",
      toolCallId: "call-1",
      decision: "pending" as unknown as "approved",
      actorUserId: "user-9",
      posture: "auto",
      now: NOW,
    });

    expect(updateSets).toEqual([]);
  });

  test("declines quietly when the conditional write loses a race", async () => {
    updateMatchesNothing = true;
    const { recordAssertedApprovalDecision } = await modulePromise;

    await expect(
      recordAssertedApprovalDecision({
        sessionId: "session-1",
        toolCallId: "call-1",
        decision: "approved",
        actorUserId: "user-9",
        posture: "auto",
        now: NOW,
      }),
    ).resolves.toBeUndefined();

    expect(policyEventCalls).toEqual([]);
  });
});
