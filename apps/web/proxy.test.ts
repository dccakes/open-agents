import { describe, expect, mock, test } from "bun:test";
import { NextRequest } from "next/server";

// The share surface is exempt from the membership gate, so this suite exercises
// the rewrite without a database. `membership-proxy.test.ts` covers the gate.
mock.module("@/lib/session/server", () => ({
  getSessionWithMembershipFromReq: async () => ({
    session: undefined,
    approved: false,
  }),
}));

const proxyModulePromise = import("./proxy");

function makeRequest(path: string, accept: string, method = "GET") {
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: { Accept: accept },
  });
}

describe("shared page content negotiation proxy", () => {
  test("rewrites markdown requests for shared pages", async () => {
    const { proxy } = await proxyModulePromise;
    const response = await proxy(
      makeRequest("/shared/share-1", "text/markdown"),
    );

    expect(response.headers.get("x-middleware-rewrite")).toBe(
      "http://localhost/api/shared/share-1/markdown",
    );
  });

  test("rewrites plain text requests for shared pages", async () => {
    const { proxy } = await proxyModulePromise;
    const response = await proxy(makeRequest("/shared/share-1", "text/plain"));

    expect(response.headers.get("x-middleware-rewrite")).toBe(
      "http://localhost/api/shared/share-1/markdown",
    );
  });

  test("does not rewrite html page requests", async () => {
    const { proxy } = await proxyModulePromise;
    const response = await proxy(makeRequest("/shared/share-1", "text/html"));

    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
  });

  test("does not rewrite non-GET requests", async () => {
    const { proxy } = await proxyModulePromise;
    const response = await proxy(
      makeRequest("/shared/share-1", "text/markdown", "POST"),
    );

    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
  });
});
