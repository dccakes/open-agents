import { beforeEach, describe, expect, mock, test } from "bun:test";
import { AuthorizationError } from "@/lib/auth/authorization-error";
import { ApprovalError } from "@/lib/policy/approval-errors";

let decideError: Error | null = null;
let decideCalls: Record<string, unknown>[] = [];

mock.module("@/lib/policy/approval-decisions", () => ({
  decideApproval: async (input: Record<string, unknown>) => {
    decideCalls.push(input);
    if (decideError) {
      throw decideError;
    }
    return await Promise.resolve({
      id: input.approvalId,
      sessionId: input.sessionId,
      decision: input.decision,
      storedDecision: input.decision,
      decidedBy: "user-1",
    });
  },
}));

const routeModulePromise = import("./route");

function context(sessionId = "session-1", approvalId = "approval-1") {
  return { params: Promise.resolve({ sessionId, approvalId }) };
}

function post(body: unknown): Request {
  return new Request(
    "http://localhost/api/sessions/session-1/approvals/approval-1",
    { method: "POST", body: JSON.stringify(body) },
  );
}

beforeEach(() => {
  decideError = null;
  decideCalls = [];
});

describe("POST /api/sessions/[sessionId]/approvals/[approvalId]", () => {
  test("records an approval for an entitled caller", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(post({ decision: "approved" }), context());
    const body = (await response.json()) as {
      approval: { decision: string; decidedBy: string };
    };

    expect(response.status).toBe(200);
    expect(body.approval.decision).toBe("approved");
    expect(body.approval.decidedBy).toBe("user-1");
    expect(decideCalls[0]).toMatchObject({
      sessionId: "session-1",
      approvalId: "approval-1",
      decision: "approved",
    });
  });

  test("records a denial", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(post({ decision: "denied" }), context());
    const body = (await response.json()) as { approval: { decision: string } };

    expect(body.approval.decision).toBe("denied");
  });

  /** The approval stays pending: the module refuses before writing. */
  test("answers 403 for a caller who may not act on the session", async () => {
    decideError = new AuthorizationError("forbidden");
    const { POST } = await routeModulePromise;

    const response = await POST(post({ decision: "approved" }), context());
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(403);
    expect(body.error).toBe("Forbidden");
  });

  test("answers 401 for a caller with no session", async () => {
    decideError = new AuthorizationError("unauthenticated");
    const { POST } = await routeModulePromise;

    expect((await POST(post({ decision: "approved" }), context())).status).toBe(
      401,
    );
  });

  test("answers 409 for an approval that is already decided", async () => {
    decideError = new ApprovalError("already-decided", "already approved");
    const { POST } = await routeModulePromise;

    const response = await POST(post({ decision: "denied" }), context());
    const body = (await response.json()) as { code: string };

    expect(response.status).toBe(409);
    expect(body.code).toBe("already-decided");
  });

  test("answers 409 for an approval that has expired", async () => {
    // Expiry is a terminal state computed on read, so it reads as a conflict
    // rather than as a decision that could still be made.
    decideError = new ApprovalError("already-decided", "timed out");
    const { POST } = await routeModulePromise;

    expect((await POST(post({ decision: "approved" }), context())).status).toBe(
      409,
    );
  });

  test("answers 404 for an approval that is not on this session", async () => {
    decideError = new ApprovalError("not-found", "no such approval");
    const { POST } = await routeModulePromise;

    expect((await POST(post({ decision: "approved" }), context())).status).toBe(
      404,
    );
  });

  test("answers 400 for a decision value that is not approve or deny", async () => {
    decideError = new ApprovalError("invalid", "bad decision");
    const { POST } = await routeModulePromise;

    expect((await POST(post({ decision: "maybe" }), context())).status).toBe(
      400,
    );
  });

  test("answers 400 for a body that is not JSON", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(
      new Request("http://localhost", { method: "POST", body: "{" }),
      context(),
    );

    expect(response.status).toBe(400);
    expect(decideCalls).toEqual([]);
  });
});
