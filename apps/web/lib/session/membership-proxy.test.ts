import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { NextRequest } from "next/server";

let signedIn = true;
let approved = true;
let resolveError: Error | null = null;

mock.module("@/lib/session/server", () => ({
  getSessionWithMembershipFromReq: async () => {
    if (resolveError) {
      throw resolveError;
    }
    return {
      session: signedIn ? { user: { id: "u1" } } : undefined,
      approved: signedIn ? approved : false,
    };
  },
}));

const modulePromise = import("@/lib/session/membership-proxy");

function createRequest(pathname: string): NextRequest {
  const url = new URL(`http://localhost${pathname}`);
  return { nextUrl: url, url: url.toString() } as unknown as NextRequest;
}

beforeEach(() => {
  signedIn = true;
  approved = true;
  resolveError = null;
});

describe("gateMembership", () => {
  test("lets an approved member through", async () => {
    const { gateMembership } = await modulePromise;

    expect(await gateMembership(createRequest("/sessions"))).toBeUndefined();
  });

  test("lets a signed-out visitor through so they can sign in", async () => {
    signedIn = false;
    const { gateMembership } = await modulePromise;

    expect(await gateMembership(createRequest("/"))).toBeUndefined();
  });

  test("answers 403 to a pending user's API request", async () => {
    approved = false;
    const { gateMembership, PENDING_APPROVAL_MESSAGE } = await modulePromise;

    const response = await gateMembership(createRequest("/api/sessions"));

    expect(response?.status).toBe(403);
    expect(await response?.json()).toEqual({
      error: PENDING_APPROVAL_MESSAGE,
    });
  });

  // The gate is an exemption list, so a route that does not exist yet is
  // covered the moment it is added.
  test("answers 403 on a route nobody has audited", async () => {
    approved = false;
    const { gateMembership } = await modulePromise;

    const response = await gateMembership(
      createRequest("/api/some/route/added/tomorrow"),
    );

    expect(response?.status).toBe(403);
  });

  test("redirects a pending user's page request to the approval screen", async () => {
    approved = false;
    const { gateMembership } = await modulePromise;

    const response = await gateMembership(createRequest("/sessions"));

    expect(response?.status).toBe(307);
    expect(response?.headers.get("location")).toBe("http://localhost/pending");
  });

  test("lets a pending user reach the approval screen itself", async () => {
    approved = false;
    const { gateMembership } = await modulePromise;

    expect(await gateMembership(createRequest("/pending"))).toBeUndefined();
  });

  test("lets a pending user sign out", async () => {
    approved = false;
    const { gateMembership } = await modulePromise;

    expect(
      await gateMembership(createRequest("/api/auth/sign-out")),
    ).toBeUndefined();
  });

  test("leaves the public share surface alone", async () => {
    approved = false;
    const { gateMembership } = await modulePromise;

    expect(await gateMembership(createRequest("/shared/abc"))).toBeUndefined();
  });

  test("leaves the Linear webhook alone, which checks membership itself", async () => {
    approved = false;
    const { gateMembership } = await modulePromise;

    expect(
      await gateMembership(createRequest("/api/linear/webhook")),
    ).toBeUndefined();
  });

  // The session helper fails closed on the same error, so erring open here
  // degrades into "every route refuses" rather than "sign-out is unreachable".
  test("defers to the session-helper chokepoint when membership cannot be read", async () => {
    resolveError = new Error("database unavailable");
    const { gateMembership } = await modulePromise;

    expect(await gateMembership(createRequest("/sessions"))).toBeUndefined();
  });
});
