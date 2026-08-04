import { beforeEach, describe, expect, mock, test } from "bun:test";
import { AuthorizationError } from "@/lib/auth/authorization-error";
import { ApprovalError } from "@/lib/policy/approval-errors";

let executeError: Error | null = null;
let executeCalls: Record<string, unknown>[] = [];
let executeResult: Record<string, unknown> = {
  status: "executed",
  approvalId: "approval-1",
  detail: "Committed and pushed.",
  commit: { status: "success", committed: true, pushed: true },
};

mock.module("@/lib/policy/app-side-effect-execution", () => ({
  executeAppSideEffect: async (input: Record<string, unknown>) => {
    executeCalls.push(input);
    if (executeError) {
      throw executeError;
    }
    return await Promise.resolve(executeResult);
  },
}));

const routeModulePromise = import("./route");

function context(sessionId = "session-1", approvalId = "approval-1") {
  return { params: Promise.resolve({ sessionId, approvalId }) };
}

function post(): Request {
  return new Request(
    "http://localhost/api/sessions/session-1/approvals/approval-1/execute",
    { method: "POST" },
  );
}

beforeEach(() => {
  executeError = null;
  executeCalls = [];
  executeResult = {
    status: "executed",
    approvalId: "approval-1",
    detail: "Committed and pushed.",
    commit: { status: "success", committed: true, pushed: true },
  };
});

describe("POST /api/sessions/[sessionId]/approvals/[approvalId]/execute", () => {
  test("performs the approved side effect and reports what happened", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(post(), context());
    const body = (await response.json()) as {
      result: { status: string; commit: { pushed: boolean } };
    };

    expect(response.status).toBe(200);
    expect(body.result.status).toBe("executed");
    expect(body.result.commit.pushed).toBe(true);
    expect(executeCalls[0]).toMatchObject({
      sessionId: "session-1",
      approvalId: "approval-1",
    });
  });

  test("reports a refusal as a skip rather than as a failure", async () => {
    executeResult = {
      status: "skipped",
      approvalId: "approval-1",
      detail: "Skipped by policy: the pending approval was not granted.",
    };
    const { POST } = await routeModulePromise;

    const response = await POST(post(), context());
    const body = (await response.json()) as { result: { status: string } };

    expect(response.status).toBe(200);
    expect(body.result.status).toBe("skipped");
  });

  test("answers 403 for a caller who may not act on the session", async () => {
    executeError = new AuthorizationError(
      "forbidden",
      "You may not act on this session.",
    );
    const { POST } = await routeModulePromise;

    expect((await POST(post(), context())).status).toBe(403);
  });

  test("answers 409 when the approval was already spent", async () => {
    executeError = new ApprovalError(
      "already-decided",
      "This approval has already authorized one execution.",
    );
    const { POST } = await routeModulePromise;

    expect((await POST(post(), context())).status).toBe(409);
  });

  test("answers 400 when nobody has answered the approval yet", async () => {
    executeError = new ApprovalError("invalid", "Not answered yet.");
    const { POST } = await routeModulePromise;

    expect((await POST(post(), context())).status).toBe(400);
  });

  test("answers 404 for an approval that is not on this session", async () => {
    executeError = new ApprovalError("not-found", "No such approval.");
    const { POST } = await routeModulePromise;

    expect((await POST(post(), context())).status).toBe(404);
  });
});
