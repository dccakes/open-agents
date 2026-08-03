import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { NextRequest } from "next/server";

let sessionUserId: string | null = "u1";
let approved = true;

mock.module("@/lib/auth/config", () => ({
  auth: {
    api: {
      getSession: async () =>
        sessionUserId
          ? {
              session: { createdAt: new Date(0) },
              user: {
                id: sessionUserId,
                username: "grace",
                email: "grace@nextdegree.org",
                image: null,
                name: "Grace",
              },
            }
          : null,
    },
  },
}));

mock.module("@/lib/org/membership", () => ({
  isApprovedMember: async () => approved,
}));

const modulePromise = import("@/lib/session/server");

function createRequest(): NextRequest {
  return { headers: new Headers() } as NextRequest;
}

beforeEach(() => {
  sessionUserId = "u1";
  approved = true;
});

describe("getSessionFromReq", () => {
  test("returns the session for an approved member", async () => {
    const { getSessionFromReq } = await modulePromise;

    expect((await getSessionFromReq(createRequest()))?.user.id).toBe("u1");
  });

  test("hands out no session for a signed-in pending user", async () => {
    approved = false;
    const { getSessionFromReq } = await modulePromise;

    expect(await getSessionFromReq(createRequest())).toBeUndefined();
  });
});

describe("getSessionWithMembershipFromReq", () => {
  test("distinguishes pending from signed-out", async () => {
    approved = false;
    const { getSessionWithMembershipFromReq } = await modulePromise;

    const state = await getSessionWithMembershipFromReq(createRequest());

    expect(state.approved).toBe(false);
    expect(state.session?.user.id).toBe("u1");
  });
});
