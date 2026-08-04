import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { Approval } from "@/lib/db/schema";
import type { PolicyEventInput } from "@/lib/policy/policy-events";

/**
 * Admitting — or refusing — the approval claims a resume request makes.
 *
 * These tests run the *real* verification path (only the store underneath it is
 * faked), because the bug this file now pins was invisible while
 * `verifyAssertedApprovals` was mocked out: nothing anywhere transitioned a
 * `tool-call` approval from `pending` to `approved`, so every answered `ask`
 * resumed into a 403 and the tool never ran.
 *
 * The property that must survive the fix: a decision is only ever *recorded*
 * onto a row a policy `ask` already created. A claim with no row still buys
 * nothing.
 */

type Row = Record<string, unknown>;

const HOUR = 60 * 60 * 1000;
const NOW = new Date("2026-08-04T12:00:00Z");
const ACTOR = "user-1";

let rows: Row[] = [];
let lookups: string[] = [];
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

/**
 * Both compare-and-sets, honestly emulated.
 *
 * A decision write only matches a row that is still `pending`, unconsumed and
 * unexpired; a spend only matches one that is `approved`, unconsumed and
 * unexpired. Emulating the WHERE rather than blindly assigning is the point —
 * these are the conditions the single-use guarantee rests on.
 */
function applyUpdate(values: Row): Row[] {
  const now = (values.decidedAt ?? values.consumedAt) as Date;
  const target = rows.find((row) => {
    if (row.consumedAt !== null) {
      return false;
    }
    if ((row.expiresAt as Date).getTime() <= now.getTime()) {
      return false;
    }
    return values.decision === undefined
      ? row.decision === "approved"
      : row.decision === "pending";
  });

  if (!target) {
    return [];
  }

  Object.assign(target, values);
  return [target];
}

mock.module("@/lib/policy/session-access", () => ({
  requireSessionActor: () => {
    throw new Error(
      "admission must not re-derive authorization; the route establishes it",
    );
  },
}));

mock.module("@/lib/policy/approvals", () => ({
  getApprovalByToolCall: (sessionId: string, toolCallId: string) => {
    lookups.push(toolCallId);
    return Promise.resolve(
      (rows.find(
        (row) => row.sessionId === sessionId && row.toolCallId === toolCallId,
      ) ?? null) as Approval | null,
    );
  },
  getApprovalForSession: (sessionId: string, approvalId: string) =>
    Promise.resolve(
      (rows.find(
        (row) => row.sessionId === sessionId && row.id === approvalId,
      ) ?? null) as Approval | null,
    ),
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
          returning: () => Promise.resolve(applyUpdate(values)),
        }),
      }),
    }),
  },
}));

const { checkApprovalAdmission, LEGACY_UNRECORDED_APPROVAL_TOOLS } =
  await import("./approval-admission");
const { consumeToolCallApproval } =
  await import("@/lib/policy/approval-enforcement");

function approvalPart(overrides: Row = {}) {
  return {
    type: "tool-bash",
    toolCallId: "call-1",
    state: "approval-responded",
    approval: { approved: true },
    ...overrides,
  };
}

function admit(messages: unknown, now: Date = NOW) {
  return checkApprovalAdmission({
    sessionId: "session-1",
    actorUserId: ACTOR,
    posture: "auto",
    messages,
    now,
  });
}

function claim(overrides: Row = {}): unknown {
  return [{ role: "assistant", parts: [approvalPart(overrides)] }];
}

async function refusalCodes(result: Awaited<ReturnType<typeof admit>>) {
  if (result.ok) {
    throw new Error("expected a refusal");
  }
  const body = (await result.response.json()) as {
    code: string;
    refusedApprovals: Array<{ code: string }>;
  };
  return { status: result.response.status, body };
}

beforeEach(() => {
  rows = [pendingRow()];
  lookups = [];
  policyEventCalls = [];
});

describe("recording the decision the user gave", () => {
  test("an approved claim transitions the pending row and resumes", async () => {
    const result = await admit(claim());

    expect(result.ok).toBe(true);
    expect(rows[0]).toMatchObject({
      decision: "approved",
      decidedBy: ACTOR,
      decidedAt: NOW,
    });
  });

  test("the approval it recorded then authorizes exactly one execution", async () => {
    await admit(claim());

    const first = await consumeToolCallApproval({
      sessionId: "session-1",
      toolCallId: "call-1",
      now: NOW,
    });
    const second = await consumeToolCallApproval({
      sessionId: "session-1",
      toolCallId: "call-1",
      now: NOW,
    });

    expect(first.authorized).toBe(true);
    expect(second.authorized).toBe(false);
    expect(second.authorized === false && second.code).toBe("already_consumed");
  });

  test("a denial is recorded too, and the tool then refuses", async () => {
    const result = await admit(claim({ approval: { approved: false } }));

    expect(result.ok).toBe(true);
    expect(rows[0]).toMatchObject({ decision: "denied", decidedBy: ACTOR });

    const verification = await consumeToolCallApproval({
      sessionId: "session-1",
      toolCallId: "call-1",
      now: NOW,
    });
    expect(verification.authorized).toBe(false);
    expect(verification.authorized === false && verification.code).toBe(
      "denied",
    );
  });

  test("the decision is audited as an answered ask, or as a denial", async () => {
    await admit(claim());
    expect(policyEventCalls).toMatchObject([
      { sessionId: "session-1", toolName: "bash", decision: "ask" },
    ]);

    rows = [pendingRow()];
    policyEventCalls = [];
    await admit(claim({ approval: { approved: false } }));
    expect(policyEventCalls[0]?.decision).toBe("deny");
  });
});

describe("what a claim still cannot do", () => {
  /** The real protection: no row means no policy `ask` ever gated this call. */
  test("a claim with no approval row is refused, and writes nothing", async () => {
    rows = [];

    const { status, body } = await refusalCodes(
      await admit(claim({ toolCallId: "forged-call" })),
    );

    expect(status).toBe(403);
    expect(body.code).toBe("approval_not_verified");
    expect(body.refusedApprovals[0]?.code).toBe("no_approval_record");
    expect(policyEventCalls).toEqual([]);
  });

  test("a replayed body whose approval was already spent is refused", async () => {
    await admit(claim());
    await consumeToolCallApproval({
      sessionId: "session-1",
      toolCallId: "call-1",
      now: NOW,
    });

    const { status, body } = await refusalCodes(await admit(claim()));

    expect(status).toBe(403);
    expect(body.refusedApprovals[0]?.code).toBe("already_consumed");
  });

  test("an expired row cannot be decided into life", async () => {
    rows = [pendingRow({ expiresAt: new Date(NOW.getTime() - 1) })];

    const { body } = await refusalCodes(await admit(claim()));

    expect(body.refusedApprovals[0]?.code).toBe("expired");
    expect(rows[0]?.decision).toBe("pending");
    expect(policyEventCalls).toEqual([]);
  });

  test("an already-denied row is not walked back by a later approval claim", async () => {
    rows = [pendingRow({ decision: "denied", decidedBy: "user-2" })];

    const { body } = await refusalCodes(await admit(claim()));

    expect(body.refusedApprovals[0]?.code).toBe("denied");
    expect(rows[0]?.decidedBy).toBe("user-2");
  });

  test("an approval of the wrong kind is not a tool-call approval", async () => {
    rows = [pendingRow({ kind: "app-side-effect" })];

    const { body } = await refusalCodes(await admit(claim()));

    expect(body.refusedApprovals[0]?.code).toBe("no_approval_record");
    expect(rows[0]?.decision).toBe("pending");
  });
});

describe("what gets checked", () => {
  test("ignores a claim whose tool call already produced output", async () => {
    const result = await admit(claim({ state: "output-available" }));

    expect(result.ok).toBe(true);
    expect(lookups).toEqual([]);
    expect(rows[0]?.decision).toBe("pending");
  });

  test("ignores approvals carried by earlier messages in the history", async () => {
    const result = await admit([
      { role: "assistant", parts: [approvalPart({ toolCallId: "old-call" })] },
      { role: "user", parts: [{ type: "text", text: "next" }] },
    ]);

    expect(result.ok).toBe(true);
    expect(lookups).toEqual([]);
  });
});

/** Declared outside the loop below, so the closure captures nothing mutable. */
async function expectAdmittedWithoutRecord(toolName: string) {
  rows = [];

  const result = await admit(claim({ type: `tool-${toolName}` }));

  expect(result.ok).toBe(true);
  expect(lookups).toEqual([]);
}

describe("legacy approval flows", () => {
  test("the exempt set is exactly the pre-record approval tools", () => {
    expect([...LEGACY_UNRECORDED_APPROVAL_TOOLS].sort()).toEqual([
      "ask_user_question",
      "web_fetch",
    ]);
  });

  for (const toolName of ["web_fetch", "ask_user_question"]) {
    test(`${toolName} is admitted without an approval record`, () =>
      expectAdmittedWithoutRecord(toolName));
  }

  test("a legacy claim alongside a policed one still checks the policed one", async () => {
    rows = [pendingRow({ toolCallId: "call-bash" })];

    const result = await admit([
      {
        role: "assistant",
        parts: [
          approvalPart({ type: "tool-web_fetch", toolCallId: "call-fetch" }),
          approvalPart({ toolCallId: "call-bash" }),
        ],
      },
    ]);

    expect(result.ok).toBe(true);
    expect(lookups).toEqual(["call-bash", "call-bash"]);
    expect(rows[0]?.decision).toBe("approved");
  });
});
