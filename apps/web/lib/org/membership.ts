/**
 * Reading a user's membership in the seeded organization.
 *
 * `pending` is the *absence* of a row, not a role value, so every check here
 * is positive: "is there a membership row?" rather than "is the role something
 * other than pending?". A missing row fails closed by construction.
 */

import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { orgMembers } from "@/lib/db/schema";
import { getSeededOrganizationId } from "@/lib/org/seeded-organization";

export interface OrganizationMembership {
  id: string;
  organizationId: string;
  userId: string;
  role: string;
}

/** The user's membership row, or `null` when they are pending. */
export async function getOrganizationMembership(
  userId: string,
): Promise<OrganizationMembership | null> {
  const organizationId = await getSeededOrganizationId();
  if (!organizationId) {
    return null;
  }

  const rows = await db
    .select({
      id: orgMembers.id,
      organizationId: orgMembers.organizationId,
      userId: orgMembers.userId,
      role: orgMembers.role,
    })
    .from(orgMembers)
    .where(
      and(
        eq(orgMembers.organizationId, organizationId),
        eq(orgMembers.userId, userId),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

/** Whether the user is an approved member of the seeded organization. */
export async function isApprovedMember(userId: string): Promise<boolean> {
  return (await getOrganizationMembership(userId)) !== null;
}
