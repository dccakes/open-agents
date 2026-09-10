import { describe, expect, test } from "bun:test";
import { isApiPath, isMembershipExemptPath } from "@/lib/session/gated-paths";

describe("isMembershipExemptPath", () => {
  test.each([
    "/api/auth/sign-in/social",
    "/api/auth",
    "/api/linear/webhook",
    "/api/shared/abc/status",
    "/shared/abc",
    "/pending",
    "/_next/static/chunk.js",
    "/favicon.ico",
    "/robots.txt",
  ])("exempts %s", (pathname) => {
    expect(isMembershipExemptPath(pathname)).toBe(true);
  });

  // The gate is an exemption list, so anything not written down stays gated —
  // including routes that do not exist yet.
  test.each([
    "/",
    "/sessions",
    "/settings/admin",
    "/api/sessions",
    "/api/chat",
    "/api/some/route/added/tomorrow",
    "/api/authorize",
    "/sharedish",
  ])("gates %s", (pathname) => {
    expect(isMembershipExemptPath(pathname)).toBe(false);
  });
});

describe("isApiPath", () => {
  test("recognizes API routes so the refusal can be JSON", () => {
    expect(isApiPath("/api/sessions")).toBe(true);
    expect(isApiPath("/api")).toBe(true);
    expect(isApiPath("/apiary")).toBe(false);
    expect(isApiPath("/sessions")).toBe(false);
  });
});
