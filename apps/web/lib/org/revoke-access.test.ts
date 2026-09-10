import { beforeEach, describe, expect, mock, test } from "bun:test";

let revokedUserIds: string[] = [];
let revokedShareUserIds: string[] = [];
let revokeSessionsError: Error | null = null;
let revokeSharesError: Error | null = null;

mock.module("next/headers", () => ({
  headers: async () => new Headers({ cookie: "session=abc" }),
}));

mock.module("@/lib/auth/config", () => ({
  auth: {
    api: {
      revokeUserSessions: async ({ body }: { body: { userId: string } }) => {
        if (revokeSessionsError) {
          throw revokeSessionsError;
        }
        revokedUserIds.push(body.userId);
        return { status: true };
      },
    },
  },
}));

mock.module("@/lib/db/user-shares", () => ({
  revokeSharesForUser: async (userId: string) => {
    if (revokeSharesError) {
      throw revokeSharesError;
    }
    revokedShareUserIds.push(userId);
    return 2;
  },
}));

const modulePromise = import("@/lib/org/revoke-access");

beforeEach(() => {
  revokedUserIds = [];
  revokedShareUserIds = [];
  revokeSessionsError = null;
  revokeSharesError = null;
});

describe("revokeUserAccess", () => {
  // Demotion is already effective on the next request because every check is a
  // per-request lookup; removal and ban go further and kill the sessions now.
  test("revokes the target's sessions and shares", async () => {
    const { revokeUserAccess } = await modulePromise;

    const result = await revokeUserAccess("u1");

    expect(revokedUserIds).toEqual(["u1"]);
    expect(revokedShareUserIds).toEqual(["u1"]);
    expect(result).toEqual({ sessionsRevoked: true, sharesRevoked: 2 });
  });

  test("still revokes shares when session revocation fails", async () => {
    revokeSessionsError = new Error("upstream unavailable");
    const { revokeUserAccess } = await modulePromise;

    const result = await revokeUserAccess("u1");

    expect(result.sessionsRevoked).toBe(false);
    expect(revokedShareUserIds).toEqual(["u1"]);
  });

  test("still revokes sessions when share revocation fails", async () => {
    revokeSharesError = new Error("database unavailable");
    const { revokeUserAccess } = await modulePromise;

    const result = await revokeUserAccess("u1");

    expect(result).toEqual({ sessionsRevoked: true, sharesRevoked: 0 });
  });
});
