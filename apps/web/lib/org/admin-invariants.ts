/**
 * Last-admin invariants.
 *
 * Two separate floors, because there are two role concepts: the organization
 * must keep at least one member holding `owner` or `admin`, and the deployment
 * must keep at least one user holding the platform role `admin`. Either one
 * hitting zero is unrecoverable without database access, so demotion, removal,
 * and ban all go through these checks.
 *
 * `APIError` is used rather than a bare `Error` so a refusal from inside a
 * Better Auth hook surfaces as a 4xx with a readable message instead of a 500.
 */

import { APIError } from "better-auth/api";
import { eq } from "drizzle-orm";
import {
  ORGANIZATION_ADMIN_ROLES,
  PLATFORM_ADMIN_ROLE,
} from "@/lib/auth/permissions";
import { db } from "@/lib/db/client";
import { orgMembers, users } from "@/lib/db/schema";

const LAST_ORG_ADMIN_MESSAGE =
  "This is the last organization owner or admin. Promote another member first.";

const LAST_PLATFORM_ADMIN_MESSAGE =
  "This is the last platform admin. Grant the platform admin role to another user first.";

/**
 * Roles arrive comma-separated from the organization plugin, which supports
 * multi-role members even though this deployment assigns exactly one.
 */
function splitRoles(role: string): string[] {
  return role
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function isOrganizationAdminRole(role: string): boolean {
  return splitRoles(role).some((entry) =>
    (ORGANIZATION_ADMIN_ROLES as readonly string[]).includes(entry),
  );
}

export interface OrganizationAdminInvariantInput {
  organizationId: string;
  /**
   * The `org_members.id` being demoted or removed. The organization plugin's
   * member endpoints identify the target this way.
   */
  memberId?: string;
  /**
   * The `users.id` being banned or deleted. The admin plugin's endpoints
   * identify the target this way, and never see a member id.
   */
  userId?: string;
  /**
   * The role the member would end up with. Omit for removal and ban, which
   * leave them with no role at all.
   */
  nextRole?: string;
}

/**
 * Refuse any change that would leave the organization with zero owners/admins.
 *
 * @throws APIError when the target is the last owner/admin and the change
 * would strip that role.
 */
export async function ensureNotLastOrganizationAdmin(
  input: OrganizationAdminInvariantInput,
): Promise<void> {
  const { organizationId, memberId, userId, nextRole } = input;

  if (nextRole !== undefined && isOrganizationAdminRole(nextRole)) {
    return;
  }

  if (!(memberId || userId)) {
    return;
  }

  const rows = await db
    .select({
      id: orgMembers.id,
      userId: orgMembers.userId,
      role: orgMembers.role,
    })
    .from(orgMembers)
    .where(eq(orgMembers.organizationId, organizationId));

  const isTarget = (row: { id: string; userId: string }): boolean =>
    (memberId !== undefined && row.id === memberId) ||
    (userId !== undefined && row.userId === userId);

  const target = rows.find(isTarget);
  if (!target || !isOrganizationAdminRole(target.role)) {
    return;
  }

  const remainingAdmins = rows.filter(
    (row) => !isTarget(row) && isOrganizationAdminRole(row.role),
  );

  if (remainingAdmins.length === 0) {
    throw new APIError("BAD_REQUEST", { message: LAST_ORG_ADMIN_MESSAGE });
  }
}

export interface PlatformAdminInvariantInput {
  /** The `users.id` being demoted, removed, or banned. */
  userId: string;
  /** The platform role the user would end up with; omit for removal or ban. */
  nextRole?: string;
}

/**
 * Refuse any change that would leave the deployment with zero platform admins.
 *
 * @throws APIError when the target is the last platform admin.
 */
export async function ensureNotLastPlatformAdmin(
  input: PlatformAdminInvariantInput,
): Promise<void> {
  const { userId, nextRole } = input;

  if (
    nextRole !== undefined &&
    splitRoles(nextRole).includes(PLATFORM_ADMIN_ROLE)
  ) {
    return;
  }

  const rows = await db
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(eq(users.role, PLATFORM_ADMIN_ROLE));

  const isTargetAdmin = rows.some((row) => row.id === userId);
  if (!isTargetAdmin) {
    return;
  }

  if (rows.length <= 1) {
    throw new APIError("BAD_REQUEST", { message: LAST_PLATFORM_ADMIN_MESSAGE });
  }
}
