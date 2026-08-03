/**
 * The one access-control vocabulary for QuackOps.
 *
 * Both Better Auth plugins and the client read their roles from here, so
 * "who may change shared configuration" has a single definition and a single
 * test surface.
 *
 * The plugins' own `defaultStatements` are spread in first and are
 * load-bearing, not decorative: the organization plugin's built-in
 * `removeMember` / `updateMemberRole` endpoints authorize `member.delete` /
 * `member.update` against *these* roles. A statement set containing only the
 * QuackOps resources would deny every built-in member mutation, owner
 * included.
 */

import { createAccessControl } from "better-auth/plugins/access";
import { defaultStatements as adminDefaultStatements } from "better-auth/plugins/admin/access";
import { defaultStatements as orgDefaultStatements } from "better-auth/plugins/organization/access";

/**
 * Resources QuackOps owns, consumed by the Phase 1 workstreams.
 *
 * There is deliberately no `membership` resource: approve / set-role / remove
 * map onto the organization plugin's own `member.create` / `update` / `delete`.
 */
export const quackOpsStatements = {
  orgSettings: ["read", "update"],
  integration: ["read", "connect", "disconnect"],
  repoMapping: ["read", "create", "update", "delete"],
  observability: ["read", "configure"],
  agentRun: ["create", "read", "stop"],
  posture: ["setDangerous"],
  warmCache: ["shareOrgWide", "discard"],
} as const;

export const statement = {
  ...orgDefaultStatements,
  ...adminDefaultStatements,
  ...quackOpsStatements,
} as const;

export const ac = createAccessControl(statement);

/**
 * Organization roles, governing shared configuration.
 *
 * `member` holds read actions plus agent-run create/read; `admin` holds
 * everything except deleting the organization; `owner` holds everything.
 */
export const member = ac.newRole({
  organization: [],
  member: [],
  invitation: [],
  team: [],
  ac: ["read"],
  user: [],
  session: [],
  orgSettings: ["read"],
  integration: ["read"],
  repoMapping: ["read"],
  observability: ["read"],
  agentRun: ["create", "read"],
  posture: [],
  warmCache: [],
});

export const admin = ac.newRole({
  organization: ["update"],
  member: ["create", "update", "delete"],
  invitation: ["create", "cancel"],
  team: ["create", "update", "delete"],
  ac: ["create", "read", "update", "delete"],
  user: [
    "create",
    "list",
    "set-role",
    "ban",
    "impersonate",
    "impersonate-admins",
    "delete",
    "set-password",
    "get",
    "update",
  ],
  session: ["list", "revoke", "delete"],
  orgSettings: ["read", "update"],
  integration: ["read", "connect", "disconnect"],
  repoMapping: ["read", "create", "update", "delete"],
  observability: ["read", "configure"],
  agentRun: ["create", "read", "stop"],
  posture: ["setDangerous"],
  warmCache: ["shareOrgWide", "discard"],
});

export const owner = ac.newRole({
  ...admin.statements,
  organization: ["update", "delete"],
});

export const organizationRoles = { owner, admin, member } as const;

/**
 * Platform roles, governing instance-level operations that exist above any
 * organization: ban, impersonation, session revocation, and the bulk OAuth
 * token revocation actions.
 *
 * Keyed by `users.role`, which is why the names are `admin` / `user` rather
 * than the organization plugin's `owner` / `admin` / `member`. Holding org
 * role `admin` grants none of these.
 */
export const platformAdmin = ac.newRole({
  user: [
    "create",
    "list",
    "set-role",
    "ban",
    "impersonate",
    "delete",
    "set-password",
    "get",
    "update",
  ],
  session: ["list", "revoke", "delete"],
});

export const platformUser = ac.newRole({
  user: [],
  session: [],
});

export const platformRoles = {
  admin: platformAdmin,
  user: platformUser,
} as const;

export type OrganizationRoleName = keyof typeof organizationRoles;
export type PlatformRoleName = keyof typeof platformRoles;

/** Roles that count as organization administrators for the last-admin rule. */
export const ORGANIZATION_ADMIN_ROLES: readonly OrganizationRoleName[] = [
  "owner",
  "admin",
];

/** The platform role that may perform instance-level operations. */
export const PLATFORM_ADMIN_ROLE: PlatformRoleName = "admin";

/** The platform role every user starts with. */
export const PLATFORM_DEFAULT_ROLE: PlatformRoleName = "user";
