/**
 * Server-side, authoritative permission checks.
 *
 * `checkRolePermission` on the client is for hiding affordances only — hiding
 * a button is not authorization, so every hidden control also passes through
 * here.
 *
 * The organization is resolved explicitly rather than read from
 * `auth_sessions.active_organization_id`: that column is NULL on every session
 * issued before this change, and trusting it would deny already-signed-in
 * users, admins included.
 */

import { headers as nextHeaders } from "next/headers";
import { AuthorizationError } from "@/lib/auth/authorization-error";
import { auth } from "@/lib/auth/config";
import type { statement } from "@/lib/auth/permissions";
import { getOrganizationMembership } from "@/lib/org/membership";
import { getSeededOrganizationId } from "@/lib/org/seeded-organization";

/** A `{ resource: [action, ...] }` request against the shared statement set. */
export type PermissionRequest = {
  [Resource in keyof typeof statement]?: (typeof statement)[Resource][number][];
};

export interface PermissionCheckOptions {
  /** Request headers. Defaults to the current Next.js request's headers. */
  headers?: Headers;
}

async function resolveHeaders(options?: PermissionCheckOptions) {
  return options?.headers ?? (await nextHeaders());
}

/**
 * Whether the caller holds every requested permission.
 *
 * Returns `false` rather than throwing on any failure — no session, no
 * organization, no membership — so callers get one fail-closed answer.
 */
export async function hasPermission(
  permissions: PermissionRequest,
  options?: PermissionCheckOptions,
): Promise<boolean> {
  const organizationId = await getSeededOrganizationId();
  if (!organizationId) {
    return false;
  }

  try {
    const result = await auth.api.hasPermission({
      headers: await resolveHeaders(options),
      body: { organizationId, permissions },
    });

    return result?.success === true;
  } catch {
    // A caller who is not a member of the organization raises here. That is a
    // denial, not an error worth propagating.
    return false;
  }
}

/**
 * Assert the caller holds every requested permission.
 *
 * @throws AuthorizationError with reason `forbidden` when they do not.
 */
export async function requirePermission(
  permissions: PermissionRequest,
  options?: PermissionCheckOptions,
): Promise<void> {
  if (!(await hasPermission(permissions, options))) {
    throw new AuthorizationError("forbidden");
  }
}

export interface ApprovedMember {
  userId: string;
  organizationId: string;
  role: string;
}

/**
 * Assert the caller is an approved member of the seeded organization.
 *
 * A positive membership check: a user with no `org_members` row is pending and
 * is refused, whatever else is true of them.
 *
 * @throws AuthorizationError with reason `unauthenticated` when there is no
 * session, or `forbidden` when the user is pending.
 */
export async function requireApprovedMember(
  options?: PermissionCheckOptions,
): Promise<ApprovedMember> {
  const session = await auth.api.getSession({
    headers: await resolveHeaders(options),
  });

  const userId = session?.user?.id;
  if (!userId) {
    throw new AuthorizationError("unauthenticated");
  }

  const membership = await getOrganizationMembership(userId);
  if (!membership) {
    throw new AuthorizationError("forbidden", "Membership is pending approval");
  }

  return {
    userId,
    organizationId: membership.organizationId,
    role: membership.role,
  };
}
