import { beforeEach, describe, expect, mock, test } from "bun:test";
import { AuthorizationError } from "@/lib/auth/authorization-error";
import { ApprovalError } from "@/lib/policy/approval-errors";

let readError: Error | null = null;
let updateError: Error | null = null;
let updateCalls: { sessionId: string; input: unknown }[] = [];
let canSetDangerous = true;
let storedPosture = "auto";

mock.module("@/lib/policy/session-posture", () => ({
  readSessionPosture: async (sessionId: string) => {
    if (readError) {
      throw readError;
    }
    return await Promise.resolve({
      sessionId,
      posture: storedPosture,
      canSetDangerous,
      availablePostures: canSetDangerous
        ? ["strict", "auto", "dangerous"]
        : ["strict", "auto"],
    });
  },
  updateSessionPosture: async (sessionId: string, input: unknown) => {
    updateCalls.push({ sessionId, input });
    if (updateError) {
      throw updateError;
    }
    const posture = (input as { posture?: string } | null)?.posture ?? "auto";
    storedPosture = posture;
    return await Promise.resolve({
      sessionId,
      posture,
      canSetDangerous,
      availablePostures: ["strict", "auto", "dangerous"],
    });
  },
}));

const routeModulePromise = import("./route");

function context(sessionId = "session-1") {
  return { params: Promise.resolve({ sessionId }) };
}

function patch(body: unknown): Request {
  return new Request("http://localhost/api/sessions/session-1/posture", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  readError = null;
  updateError = null;
  updateCalls = [];
  canSetDangerous = true;
  storedPosture = "auto";
});

describe("GET /api/sessions/[sessionId]/posture", () => {
  test("returns the posture and the options this viewer may choose", async () => {
    canSetDangerous = false;
    const { GET } = await routeModulePromise;

    const response = await GET(new Request("http://localhost"), context());
    const body = (await response.json()) as {
      posture: { posture: string; availablePostures: string[] };
    };

    expect(response.status).toBe(200);
    expect(body.posture.posture).toBe("auto");
    // The dangerous option is not offered to a viewer who cannot select it.
    expect(body.posture.availablePostures).toEqual(["strict", "auto"]);
  });

  test("answers 403 for a caller who may not act on the session", async () => {
    readError = new AuthorizationError("forbidden");
    const { GET } = await routeModulePromise;

    const response = await GET(new Request("http://localhost"), context());

    expect(response.status).toBe(403);
  });

  test("answers 401 for a caller with no session", async () => {
    readError = new AuthorizationError("unauthenticated");
    const { GET } = await routeModulePromise;

    expect((await GET(new Request("http://localhost"), context())).status).toBe(
      401,
    );
  });
});

describe("PATCH /api/sessions/[sessionId]/posture", () => {
  test("persists a posture change", async () => {
    const { PATCH } = await routeModulePromise;

    const response = await PATCH(patch({ posture: "strict" }), context());
    const body = (await response.json()) as { posture: { posture: string } };

    expect(response.status).toBe(200);
    expect(body.posture.posture).toBe("strict");
    expect(updateCalls[0]).toEqual({
      sessionId: "session-1",
      input: { posture: "strict" },
    });
  });

  /**
   * Hiding the option is not authorization: the server refuses `dangerous`
   * submitted directly, whatever the client rendered.
   */
  test("answers 403 when the caller lacks posture.setDangerous", async () => {
    updateError = new AuthorizationError("forbidden");
    const { PATCH } = await routeModulePromise;

    const response = await PATCH(patch({ posture: "dangerous" }), context());

    expect(response.status).toBe(403);
    expect(storedPosture).toBe("auto");
  });

  test("answers 400 for a posture that is not one of the three", async () => {
    updateError = new ApprovalError("invalid", "bad posture");
    const { PATCH } = await routeModulePromise;

    expect((await PATCH(patch({ posture: "yolo" }), context())).status).toBe(
      400,
    );
  });

  test("answers 400 for a body that is not JSON", async () => {
    const { PATCH } = await routeModulePromise;

    const response = await PATCH(
      new Request("http://localhost", { method: "PATCH", body: "{" }),
      context(),
    );

    expect(response.status).toBe(400);
    expect(updateCalls).toEqual([]);
  });

  test("answers 500 without leaking the failure detail", async () => {
    updateError = new Error("connection reset to db-primary-3");
    const { PATCH } = await routeModulePromise;

    const response = await PATCH(patch({ posture: "strict" }), context());
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(500);
    expect(body.error).not.toContain("db-primary-3");
  });
});
