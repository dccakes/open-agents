import { beforeEach, describe, expect, mock, test } from "bun:test";
import { AuthorizationError } from "@/lib/auth/authorization-error";

let approvedMember: { userId: string } | null = { userId: "user-1" };
let sessionRow: { id: string; userId: string; posture: string } | null = null;

mock.module("@/lib/auth/require-permission", () => ({
  requireApprovedMember: () => {
    if (!approvedMember) {
      return Promise.reject(new AuthorizationError("forbidden"));
    }
    return Promise.resolve({
      userId: approvedMember.userId,
      organizationId: "org-1",
      role: "member",
    });
  },
}));

mock.module("@/lib/db/sessions", () => ({
  getSessionById: () => Promise.resolve(sessionRow),
}));

const modulePromise = import("@/lib/policy/session-access");

beforeEach(() => {
  approvedMember = { userId: "user-1" };
  sessionRow = { id: "session-1", userId: "user-1", posture: "auto" };
});

describe("requireSessionActor", () => {
  test("returns the actor and session for the session's owner", async () => {
    const { requireSessionActor } = await modulePromise;

    const actor = await requireSessionActor("session-1");

    expect(actor.userId).toBe("user-1");
    expect(actor.session.id).toBe("session-1");
  });

  test("refuses a pending member before the session is even read", async () => {
    approvedMember = null;
    const { requireSessionActor } = await modulePromise;

    await expect(requireSessionActor("session-1")).rejects.toBeInstanceOf(
      AuthorizationError,
    );
  });

  /**
   * A different member of the organization is still not entitled to act on
   * somebody else's session — approving their agent's `git push` included.
   */
  test("refuses a member who does not own the session with 403", async () => {
    approvedMember = { userId: "user-2" };
    const { requireSessionActor } = await modulePromise;

    const error = await requireSessionActor("session-1").catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(AuthorizationError);
    expect((error as AuthorizationError).status).toBe(403);
  });

  test("refuses a session that does not exist, without leaking that fact", async () => {
    sessionRow = null;
    const { requireSessionActor } = await modulePromise;

    const error = await requireSessionActor("nope").catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(AuthorizationError);
    expect((error as AuthorizationError).status).toBe(403);
  });
});

describe("canActOnSession", () => {
  test("answers true for the owner and false for anyone else", async () => {
    const { canActOnSession } = await modulePromise;

    await expect(canActOnSession("session-1")).resolves.toBe(true);

    approvedMember = { userId: "user-2" };
    await expect(canActOnSession("session-1")).resolves.toBe(false);
  });

  test("never throws, so it is safe for hiding an affordance", async () => {
    approvedMember = null;
    const { canActOnSession } = await modulePromise;

    await expect(canActOnSession("session-1")).resolves.toBe(false);
  });
});
