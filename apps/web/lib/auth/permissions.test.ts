import { describe, expect, test } from "bun:test";
import { defaultStatements as adminDefaultStatements } from "better-auth/plugins/admin/access";
import { defaultStatements as orgDefaultStatements } from "better-auth/plugins/organization/access";
import type { Statements } from "better-auth/plugins/access";
import {
  ac,
  organizationRoles,
  platformRoles,
  statement,
} from "@/lib/auth/permissions";

type OrgRoleName = keyof typeof organizationRoles;

function allows(role: OrgRoleName, resource: string, action: string): boolean {
  return organizationRoles[role].authorize({ [resource]: [action] }).success;
}

describe("shared statement set", () => {
  test("keeps every resource from the organization plugin defaults", () => {
    for (const resource of Object.keys(orgDefaultStatements)) {
      expect({ resource, present: resource in statement }).toEqual({
        resource,
        present: true,
      });
    }
  });

  test("keeps every resource from the admin plugin defaults", () => {
    for (const resource of Object.keys(adminDefaultStatements)) {
      expect({ resource, present: resource in statement }).toEqual({
        resource,
        present: true,
      });
    }
  });

  test("keeps every action from both plugins' defaults", () => {
    const defaults: Statements = {
      ...orgDefaultStatements,
      ...adminDefaultStatements,
    };

    for (const [resource, actions] of Object.entries(defaults)) {
      const shared = (statement as Statements)[resource] ?? [];
      for (const action of actions) {
        expect({ resource, action, present: shared.includes(action) }).toEqual({
          resource,
          action,
          present: true,
        });
      }
    }
  });

  test("adds the QuackOps resources the downstream workstreams consume", () => {
    for (const resource of [
      "orgSettings",
      "integration",
      "repoMapping",
      "observability",
      "agentRun",
      "posture",
      "warmCache",
    ]) {
      expect({ resource, present: resource in statement }).toEqual({
        resource,
        present: true,
      });
    }
  });

  test("exposes the statement set through the access-control instance", () => {
    expect(ac.statements).toBe(statement);
  });
});

describe("organization role matrix", () => {
  test("member holds read actions plus agent-run create and read", () => {
    expect(allows("member", "orgSettings", "read")).toBe(true);
    expect(allows("member", "integration", "read")).toBe(true);
    expect(allows("member", "repoMapping", "read")).toBe(true);
    expect(allows("member", "observability", "read")).toBe(true);
    expect(allows("member", "agentRun", "create")).toBe(true);
    expect(allows("member", "agentRun", "read")).toBe(true);
  });

  test("member holds no write action on shared configuration", () => {
    expect(allows("member", "orgSettings", "update")).toBe(false);
    expect(allows("member", "integration", "connect")).toBe(false);
    expect(allows("member", "integration", "disconnect")).toBe(false);
    expect(allows("member", "repoMapping", "create")).toBe(false);
    expect(allows("member", "observability", "configure")).toBe(false);
    expect(allows("member", "posture", "setDangerous")).toBe(false);
    expect(allows("member", "warmCache", "shareOrgWide")).toBe(false);
    expect(allows("member", "agentRun", "stop")).toBe(false);
    expect(allows("member", "member", "create")).toBe(false);
    expect(allows("member", "member", "update")).toBe(false);
    expect(allows("member", "member", "delete")).toBe(false);
  });

  test("admin holds every action except organization deletion", () => {
    for (const [resource, actions] of Object.entries(statement as Statements)) {
      for (const action of actions) {
        const expected = !(resource === "organization" && action === "delete");
        expect({
          resource,
          action,
          allowed: allows("admin", resource, action),
        }).toEqual({ resource, action, allowed: expected });
      }
    }
  });

  test("owner holds every action", () => {
    for (const [resource, actions] of Object.entries(statement as Statements)) {
      for (const action of actions) {
        expect({
          resource,
          action,
          allowed: allows("owner", resource, action),
        }).toEqual({ resource, action, allowed: true });
      }
    }
  });
});

describe("built-in organization endpoints stay authorized", () => {
  // `removeMember` authorizes `member: ["delete"]` and `updateMemberRole`
  // authorizes `member: ["update"]` against the roles we hand the plugin. A
  // statement set that drifted away from `defaultStatements` would deny these
  // even for the owner — this is the regression test for that.
  const builtIns = [
    { endpoint: "removeMember", permissions: { member: ["delete"] } },
    { endpoint: "updateMemberRole", permissions: { member: ["update"] } },
    { endpoint: "addMember", permissions: { member: ["create"] } },
    { endpoint: "createInvitation", permissions: { invitation: ["create"] } },
    { endpoint: "cancelInvitation", permissions: { invitation: ["cancel"] } },
    {
      endpoint: "updateOrganization",
      permissions: { organization: ["update"] },
    },
  ] as const;

  for (const role of ["owner", "admin"] as const) {
    for (const { endpoint, permissions } of builtIns) {
      test(`${role} may call ${endpoint}`, () => {
        expect(organizationRoles[role].authorize(permissions).success).toBe(
          true,
        );
      });
    }
  }

  test("member may not remove or re-role other members", () => {
    expect(
      organizationRoles.member.authorize({ member: ["delete"] }).success,
    ).toBe(false);
    expect(
      organizationRoles.member.authorize({ member: ["update"] }).success,
    ).toBe(false);
  });

  test("only the owner may delete the organization", () => {
    expect(
      organizationRoles.owner.authorize({ organization: ["delete"] }).success,
    ).toBe(true);
    expect(
      organizationRoles.admin.authorize({ organization: ["delete"] }).success,
    ).toBe(false);
  });
});

describe("platform role matrix", () => {
  test("the platform admin may ban, impersonate, and revoke sessions", () => {
    expect(platformRoles.admin.authorize({ user: ["ban"] }).success).toBe(true);
    expect(
      platformRoles.admin.authorize({ user: ["impersonate"] }).success,
    ).toBe(true);
    expect(platformRoles.admin.authorize({ user: ["set-role"] }).success).toBe(
      true,
    );
    expect(platformRoles.admin.authorize({ session: ["revoke"] }).success).toBe(
      true,
    );
  });

  test("the plain platform user holds nothing", () => {
    expect(platformRoles.user.authorize({ user: ["ban"] }).success).toBe(false);
    expect(
      platformRoles.user.authorize({ user: ["impersonate"] }).success,
    ).toBe(false);
    expect(platformRoles.user.authorize({ session: ["list"] }).success).toBe(
      false,
    );
  });

  test("impersonating another admin is not granted by default", () => {
    expect(
      platformRoles.admin.authorize({ user: ["impersonate-admins"] }).success,
    ).toBe(false);
  });
});
