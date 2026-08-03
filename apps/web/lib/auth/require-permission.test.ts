import { beforeEach, describe, expect, mock, test } from "bun:test";

type HasPermissionArgs = {
  headers: Headers;
  body: { organizationId?: string; permissions: Record<string, string[]> };
};

let seededOrganizationId: string | null = "org-1";
let membership: { organizationId: string; role: string } | null = null;
let sessionUserId: string | null = "u1";
let hasPermissionResult: { success: boolean } | null = { success: true };
let hasPermissionError: Error | null = null;
let lastHasPermissionArgs: HasPermissionArgs | null = null;

mock.module("next/headers", () => ({
  headers: async () => new Headers({ cookie: "session=abc" }),
}));

mock.module("@/lib/org/seeded-organization", () => ({
  getSeededOrganizationId: async () => seededOrganizationId,
}));

mock.module("@/lib/org/membership", () => ({
  getOrganizationMembership: async (userId: string) =>
    membership ? { id: "m1", userId, ...membership } : null,
}));

mock.module("@/lib/auth/config", () => ({
  auth: {
    api: {
      hasPermission: async (args: HasPermissionArgs) => {
        lastHasPermissionArgs = args;
        if (hasPermissionError) {
          throw hasPermissionError;
        }
        return hasPermissionResult;
      },
      getSession: async () =>
        sessionUserId ? { user: { id: sessionUserId } } : null,
    },
  },
}));

const modulePromise = import("@/lib/auth/require-permission");

beforeEach(() => {
  seededOrganizationId = "org-1";
  membership = null;
  sessionUserId = "u1";
  hasPermissionResult = { success: true };
  hasPermissionError = null;
  lastHasPermissionArgs = null;
});

describe("requirePermission", () => {
  test("resolves the seeded organization explicitly", async () => {
    const { requirePermission } = await modulePromise;

    await requirePermission({ orgSettings: ["update"] });

    expect(lastHasPermissionArgs?.body).toEqual({
      organizationId: "org-1",
      permissions: { orgSettings: ["update"] },
    });
  });

  test("does not depend on the session's active organization being set", async () => {
    const { hasPermission } = await modulePromise;

    // No `activeOrganizationId` is passed anywhere; the id comes from the
    // resolver, which is what makes a NULL column non-load-bearing.
    expect(await hasPermission({ orgSettings: ["read"] })).toBe(true);
    expect(lastHasPermissionArgs?.body.organizationId).toBe("org-1");
  });

  test("throws a forbidden authorization error when the permission is denied", async () => {
    hasPermissionResult = { success: false };
    const { requirePermission } = await modulePromise;

    expect(
      requirePermission({ orgSettings: ["update"] }),
    ).rejects.toMatchObject({
      name: "AuthorizationError",
      reason: "forbidden",
    });
  });

  test("denies when the caller is not a member of the organization", async () => {
    hasPermissionError = new Error("USER_IS_NOT_A_MEMBER");
    const { hasPermission } = await modulePromise;

    expect(await hasPermission({ orgSettings: ["read"] })).toBe(false);
  });

  test("fails closed when the organization has not been seeded", async () => {
    seededOrganizationId = null;
    const { hasPermission } = await modulePromise;

    expect(await hasPermission({ orgSettings: ["read"] })).toBe(false);
  });
});

describe("requireApprovedMember", () => {
  test("returns the membership for an approved member", async () => {
    membership = { organizationId: "org-1", role: "member" };
    const { requireApprovedMember } = await modulePromise;

    expect(await requireApprovedMember()).toEqual({
      userId: "u1",
      organizationId: "org-1",
      role: "member",
    });
  });

  test("refuses a signed-in user with no membership row", async () => {
    membership = null;
    const { requireApprovedMember } = await modulePromise;

    expect(requireApprovedMember()).rejects.toMatchObject({
      name: "AuthorizationError",
      reason: "forbidden",
    });
  });

  test("refuses an unauthenticated caller", async () => {
    sessionUserId = null;
    const { requireApprovedMember } = await modulePromise;

    expect(requireApprovedMember()).rejects.toMatchObject({
      name: "AuthorizationError",
      reason: "unauthenticated",
    });
  });
});
