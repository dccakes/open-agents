import { beforeEach, describe, expect, mock, test } from "bun:test";
import { AuthorizationError } from "@/lib/auth/authorization-error";

let actorId: string | null = "user-1";
let storedPosture = "auto";
let permitted = true;
let permissionRequests: unknown[] = [];
let updateCalls: { sessionId: string; data: Record<string, unknown> }[] = [];

mock.module("@/lib/policy/session-access", () => ({
  requireSessionActor: () => {
    if (!actorId) {
      return Promise.reject(new AuthorizationError("forbidden"));
    }
    return Promise.resolve({
      userId: actorId,
      organizationId: "org-1",
      role: "member",
      session: {
        id: "session-1",
        userId: actorId,
        posture: storedPosture,
      },
    });
  },
}));

mock.module("@/lib/auth/require-permission", () => ({
  requirePermission: (permissions: unknown) => {
    permissionRequests.push(permissions);
    if (!permitted) {
      return Promise.reject(new AuthorizationError("forbidden"));
    }
    return Promise.resolve();
  },
  hasPermission: (permissions: unknown) => {
    permissionRequests.push(permissions);
    return Promise.resolve(permitted);
  },
}));

mock.module("@/lib/db/sessions", () => ({
  updateSession: (sessionId: string, data: Record<string, unknown>) => {
    updateCalls.push({ sessionId, data });
    storedPosture = String(data.posture ?? storedPosture);
    return Promise.resolve({
      id: sessionId,
      userId: "user-1",
      posture: storedPosture,
    });
  },
}));

const modulePromise = import("@/lib/policy/session-posture");

beforeEach(() => {
  actorId = "user-1";
  storedPosture = "auto";
  permitted = true;
  permissionRequests = [];
  updateCalls = [];
});

describe("readSessionPosture", () => {
  test("reports the stored posture for a caller who may act on the session", async () => {
    storedPosture = "strict";
    const { readSessionPosture } = await modulePromise;

    const view = await readSessionPosture("session-1");

    expect(view).toMatchObject({ sessionId: "session-1", posture: "strict" });
  });

  test("defaults an existing session with no posture to auto", async () => {
    // Rows written before the column existed read back as the column default,
    // but a defensive fallback keeps a malformed value from being evaluated.
    storedPosture = "nonsense";
    const { readSessionPosture } = await modulePromise;

    expect((await readSessionPosture("session-1")).posture).toBe("auto");
  });

  test("says whether the viewer may select dangerous, for hiding the option", async () => {
    permitted = false;
    const { readSessionPosture } = await modulePromise;

    const view = await readSessionPosture("session-1");

    expect(view.canSetDangerous).toBe(false);
    expect(view.availablePostures).toEqual(["strict", "auto"]);
  });

  test("offers dangerous to a viewer who holds the permission", async () => {
    const { readSessionPosture } = await modulePromise;

    const view = await readSessionPosture("session-1");

    expect(view.canSetDangerous).toBe(true);
    expect(view.availablePostures).toEqual(["strict", "auto", "dangerous"]);
  });

  test("refuses a caller who may not act on the session", async () => {
    actorId = null;
    const { readSessionPosture } = await modulePromise;

    await expect(readSessionPosture("session-1")).rejects.toBeInstanceOf(
      AuthorizationError,
    );
  });
});

describe("updateSessionPosture", () => {
  test("persists strict for any caller who may act on the session", async () => {
    const { updateSessionPosture } = await modulePromise;

    const view = await updateSessionPosture("session-1", {
      posture: "strict",
    });

    expect(view.posture).toBe("strict");
    expect(updateCalls[0]).toMatchObject({
      sessionId: "session-1",
      data: { posture: "strict" },
    });
  });

  test("does not demand the dangerous permission for strict or auto", async () => {
    permitted = false;
    const { updateSessionPosture } = await modulePromise;

    await updateSessionPosture("session-1", { posture: "strict" });
    await updateSessionPosture("session-1", { posture: "auto" });

    expect(updateCalls).toHaveLength(2);
  });

  /**
   * The first consumer of the `posture.setDangerous` statement WS-1.0
   * declared. Hiding the option in the UI is not authorization; this is.
   */
  test("gates dangerous on posture.setDangerous", async () => {
    const { updateSessionPosture } = await modulePromise;

    await updateSessionPosture("session-1", { posture: "dangerous" });

    expect(permissionRequests).toContainEqual({
      posture: ["setDangerous"],
    });
  });

  test("refuses dangerous for a member without the permission and changes nothing", async () => {
    permitted = false;
    const { updateSessionPosture } = await modulePromise;

    await expect(
      updateSessionPosture("session-1", { posture: "dangerous" }),
    ).rejects.toBeInstanceOf(AuthorizationError);

    expect(updateCalls).toEqual([]);
    expect(storedPosture).toBe("auto");
  });

  test("rejects a posture that is not one of the three", async () => {
    const { updateSessionPosture } = await modulePromise;

    await expect(
      updateSessionPosture("session-1", { posture: "extremely-dangerous" }),
    ).rejects.toMatchObject({ name: "ApprovalError", kind: "invalid" });
    expect(updateCalls).toEqual([]);
  });

  test("rejects a body that names no posture", async () => {
    const { updateSessionPosture } = await modulePromise;

    await expect(updateSessionPosture("session-1", {})).rejects.toMatchObject({
      kind: "invalid",
    });
    await expect(updateSessionPosture("session-1", null)).rejects.toMatchObject(
      { kind: "invalid" },
    );
  });

  test("authorizes before validating, so a denied caller cannot probe the schema", async () => {
    actorId = null;
    const { updateSessionPosture } = await modulePromise;

    await expect(
      updateSessionPosture("session-1", { posture: "not-a-posture" }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});
