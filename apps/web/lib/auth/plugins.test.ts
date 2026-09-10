import { beforeEach, describe, expect, mock, test } from "bun:test";

const invariantCalls: Record<string, unknown>[] = [];
let invariantError: Error | null = null;

mock.module("@/lib/org/admin-invariants", () => ({
  ensureNotLastOrganizationAdmin: async (input: Record<string, unknown>) => {
    invariantCalls.push(input);
    if (invariantError) {
      throw invariantError;
    }
  },
  ensureNotLastPlatformAdmin: async () => undefined,
}));

const modulePromise = import("@/lib/auth/plugins");

type MemberHooks = {
  beforeUpdateMemberRole: (data: {
    member: { id: string };
    newRole: string;
    organization: { id: string };
  }) => Promise<void>;
  beforeRemoveMember: (data: {
    member: { id: string };
    organization: { id: string };
  }) => Promise<void>;
};

beforeEach(() => {
  invariantCalls.length = 0;
  invariantError = null;
});

describe("organization plugin options", () => {
  test("forbids users from creating organizations", async () => {
    const { organizationPluginOptions } = await modulePromise;

    expect(organizationPluginOptions.allowUserToCreateOrganization).toBe(false);
  });

  test("keeps teams disabled", async () => {
    const { organizationPluginOptions } = await modulePromise;

    expect(organizationPluginOptions.teams.enabled).toBe(false);
  });

  test("keeps dynamic access control disabled", async () => {
    const { organizationPluginOptions } = await modulePromise;

    expect(organizationPluginOptions.dynamicAccessControl.enabled).toBe(false);
  });

  test("maps the plugin models onto the repository table names", async () => {
    const { organizationPluginOptions } = await modulePromise;

    expect(organizationPluginOptions.schema).toEqual({
      organization: { modelName: "organizations" },
      member: { modelName: "org_members" },
      invitation: { modelName: "org_invitations" },
    });
  });

  test("uses the shared roles so built-in endpoints authorize correctly", async () => {
    const { organizationPluginOptions } = await modulePromise;
    const { ac, organizationRoles } = await import("@/lib/auth/permissions");

    expect(organizationPluginOptions.ac).toBe(ac);
    expect(organizationPluginOptions.roles).toBe(organizationRoles);
  });
});

describe("admin plugin options", () => {
  test("defaults new users to the plain platform role", async () => {
    const { adminPluginOptions } = await modulePromise;

    expect(adminPluginOptions.defaultRole).toBe("user");
  });

  test("treats only `admin` as a platform admin role", async () => {
    const { adminPluginOptions } = await modulePromise;

    expect(adminPluginOptions.adminRoles).toEqual(["admin"]);
  });

  test("uses the shared platform roles", async () => {
    const { adminPluginOptions } = await modulePromise;
    const { ac, platformRoles } = await import("@/lib/auth/permissions");

    expect(adminPluginOptions.ac).toBe(ac);
    expect(adminPluginOptions.roles).toBe(platformRoles);
  });
});

describe("last-admin invariant on the built-in member endpoints", () => {
  test("checks the invariant before a role update", async () => {
    const { organizationPluginOptions } = await modulePromise;
    const hooks = organizationPluginOptions.organizationHooks as MemberHooks;

    await hooks.beforeUpdateMemberRole({
      member: { id: "m1" },
      newRole: "member",
      organization: { id: "org-1" },
    });

    expect(invariantCalls).toEqual([
      { organizationId: "org-1", memberId: "m1", nextRole: "member" },
    ]);
  });

  test("checks the invariant before a removal", async () => {
    const { organizationPluginOptions } = await modulePromise;
    const hooks = organizationPluginOptions.organizationHooks as MemberHooks;

    await hooks.beforeRemoveMember({
      member: { id: "m1" },
      organization: { id: "org-1" },
    });

    expect(invariantCalls).toEqual([
      { organizationId: "org-1", memberId: "m1" },
    ]);
  });

  test("propagates a refusal so the endpoint fails", async () => {
    invariantError = new Error("last admin");
    const { organizationPluginOptions } = await modulePromise;
    const hooks = organizationPluginOptions.organizationHooks as MemberHooks;

    expect(
      hooks.beforeRemoveMember({
        member: { id: "m1" },
        organization: { id: "org-1" },
      }),
    ).rejects.toThrow("last admin");
  });
});
