import { beforeEach, describe, expect, mock, test } from "bun:test";
import { AuthorizationError } from "@/lib/auth/authorization-error";

interface ApiCall {
  name: string;
  body: Record<string, unknown>;
}

let permitted = true;
let apiCalls: ApiCall[] = [];
let addMemberError: Error | null = null;
let revokedUserIds: string[] = [];
let seededOrganizationId: string | null = "org-1";
let requestedPermissions: Record<string, string[]>[] = [];

mock.module("next/headers", () => ({
  headers: async () => new Headers({ cookie: "session=abc" }),
}));

mock.module("next/cache", () => ({
  revalidatePath: () => undefined,
}));

mock.module("@/lib/auth/require-permission", () => ({
  requirePermission: async (permissions: Record<string, string[]>) => {
    requestedPermissions.push(permissions);
    if (!permitted) {
      throw new AuthorizationError("forbidden");
    }
  },
}));

mock.module("@/lib/org/seeded-organization", () => ({
  getSeededOrganizationId: async () => seededOrganizationId,
}));

mock.module("@/lib/session/get-server-session", () => ({
  getSessionWithMembership: async () => ({
    session: { user: { id: "admin-1" } },
    approved: true,
  }),
}));

mock.module("@/lib/org/revoke-access", () => ({
  revokeUserAccess: async (userId: string) => {
    revokedUserIds.push(userId);
    return { sessionsRevoked: true, sharesRevoked: 1 };
  },
}));

function record(name: string) {
  return async ({ body }: { body: Record<string, unknown> }) => {
    apiCalls.push({ name, body });
    if (name === "addMember" && addMemberError) {
      throw addMemberError;
    }
    return {};
  };
}

mock.module("@/lib/auth/config", () => ({
  auth: {
    api: {
      addMember: record("addMember"),
      updateMemberRole: record("updateMemberRole"),
      removeMember: record("removeMember"),
      setRole: record("setRole"),
      banUser: record("banUser"),
      unbanUser: record("unbanUser"),
    },
  },
}));

const modulePromise = import("@/lib/org/membership-actions");

beforeEach(() => {
  permitted = true;
  apiCalls = [];
  addMemberError = null;
  revokedUserIds = [];
  seededOrganizationId = "org-1";
  requestedPermissions = [];
});

describe("approvePendingUser", () => {
  test("creates a member row through the plugin's member.create path", async () => {
    const { approvePendingUser } = await modulePromise;

    expect(await approvePendingUser("u1")).toEqual({ success: true });
    expect(requestedPermissions).toEqual([{ member: ["create"] }]);
    expect(apiCalls).toEqual([
      {
        name: "addMember",
        body: { userId: "u1", role: "member", organizationId: "org-1" },
      },
    ]);
  });

  test("refuses a caller who does not hold member.create", async () => {
    permitted = false;
    const { approvePendingUser } = await modulePromise;

    const result = await approvePendingUser("u1");

    expect(result.success).toBe(false);
    expect(apiCalls).toHaveLength(0);
  });

  // Approving twice must not create a second membership row, and must not
  // surface as an error to the admin who clicked it.
  test("is a no-op for a user who already holds membership", async () => {
    addMemberError = new Error("User is already a member of this organization");
    const { approvePendingUser } = await modulePromise;

    expect(await approvePendingUser("u1")).toEqual({ success: true });
  });

  test("surfaces an unrelated failure rather than swallowing it", async () => {
    addMemberError = new Error("database unavailable");
    const { approvePendingUser } = await modulePromise;

    expect(await approvePendingUser("u1")).toEqual({
      success: false,
      error: "database unavailable",
    });
  });
});

describe("rejectPendingUser", () => {
  test("cuts the rejected user's sessions and shares", async () => {
    const { rejectPendingUser } = await modulePromise;

    expect(await rejectPendingUser("u1")).toEqual({ success: true });
    expect(requestedPermissions).toEqual([{ member: ["create"] }]);
    expect(revokedUserIds).toEqual(["u1"]);
  });
});

describe("setOrganizationMemberRole", () => {
  test("goes through the plugin endpoint so the last-admin hook runs", async () => {
    const { setOrganizationMemberRole } = await modulePromise;

    expect(await setOrganizationMemberRole("m1", "admin")).toEqual({
      success: true,
    });
    expect(requestedPermissions).toEqual([{ member: ["update"] }]);
    expect(apiCalls[0]).toEqual({
      name: "updateMemberRole",
      body: { memberId: "m1", role: "admin", organizationId: "org-1" },
    });
  });

  test("rejects a role that is not one of the three org roles", async () => {
    const { setOrganizationMemberRole } = await modulePromise;

    const result = await setOrganizationMemberRole(
      "m1",
      "pending" as unknown as "member",
    );

    expect(result.success).toBe(false);
    expect(apiCalls).toHaveLength(0);
  });
});

describe("removeOrganizationMember", () => {
  test("removes the member and revokes their sessions and shares", async () => {
    const { removeOrganizationMember } = await modulePromise;

    expect(await removeOrganizationMember("m1", "u1")).toEqual({
      success: true,
    });
    expect(requestedPermissions).toEqual([{ member: ["delete"] }]);
    expect(apiCalls[0]).toEqual({
      name: "removeMember",
      body: { memberIdOrEmail: "m1", organizationId: "org-1" },
    });
    expect(revokedUserIds).toEqual(["u1"]);
  });

  test("refuses a caller who does not hold member.delete", async () => {
    permitted = false;
    const { removeOrganizationMember } = await modulePromise;

    expect((await removeOrganizationMember("m1", "u1")).success).toBe(false);
    expect(apiCalls).toHaveLength(0);
    expect(revokedUserIds).toEqual([]);
  });
});

describe("setPlatformRole", () => {
  test("changes the platform role through the admin plugin", async () => {
    const { setPlatformRole } = await modulePromise;

    expect(await setPlatformRole("u1", "admin")).toEqual({ success: true });
    expect(apiCalls[0]).toEqual({
      name: "setRole",
      body: { userId: "u1", role: "admin" },
    });
  });

  test("rejects an unknown platform role", async () => {
    const { setPlatformRole } = await modulePromise;

    const result = await setPlatformRole("u1", "owner" as unknown as "admin");

    expect(result.success).toBe(false);
    expect(apiCalls).toHaveLength(0);
  });
});

describe("banOrganizationMember", () => {
  test("bans and then revokes sessions and shares", async () => {
    const { banOrganizationMember } = await modulePromise;

    expect(await banOrganizationMember("u1", "spam")).toEqual({
      success: true,
    });
    expect(apiCalls[0]).toEqual({
      name: "banUser",
      body: { userId: "u1", banReason: "spam" },
    });
    expect(revokedUserIds).toEqual(["u1"]);
  });
});
