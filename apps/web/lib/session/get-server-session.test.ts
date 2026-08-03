import { beforeEach, describe, expect, mock, test } from "bun:test";

let sessionUserId: string | null = "u1";
let approved = true;

mock.module("next/headers", () => ({
  headers: async () => new Headers({ cookie: "session=abc" }),
}));

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

const modulePromise = import("@/lib/session/get-server-session");

beforeEach(() => {
  sessionUserId = "u1";
  approved = true;
});

describe("getServerSession", () => {
  test("returns the session for an approved member", async () => {
    const { getServerSession } = await modulePromise;

    const session = await getServerSession();

    expect(session?.user.id).toBe("u1");
    expect(session?.user.username).toBe("grace");
  });

  // The structural claim: a route that only checks "is there a session" — every
  // route in the app today, and every route added tomorrow — refuses a pending
  // user without knowing the membership gate exists.
  test("hands out no session for a signed-in pending user", async () => {
    approved = false;
    const { getServerSession } = await modulePromise;

    expect(await getServerSession()).toBeUndefined();
  });

  test("hands out no session when nobody is signed in", async () => {
    sessionUserId = null;
    const { getServerSession } = await modulePromise;

    expect(await getServerSession()).toBeUndefined();
  });
});

describe("getSessionWithMembership", () => {
  test("distinguishes pending from signed-out", async () => {
    approved = false;
    const { getSessionWithMembership } = await modulePromise;

    const state = await getSessionWithMembership();

    expect(state.approved).toBe(false);
    expect(state.session?.user.id).toBe("u1");
  });

  test("reports a signed-out caller as having no session at all", async () => {
    sessionUserId = null;
    const { getSessionWithMembership } = await modulePromise;

    expect(await getSessionWithMembership()).toEqual({
      session: undefined,
      approved: false,
    });
  });
});
