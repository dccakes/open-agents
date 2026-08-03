/**
 * Reading who is a member and who is waiting.
 *
 * "Pending" is the *absence* of an `org_members` row, so the pending list is a
 * LEFT JOIN filtered on the missing side — not a query for a `pending` role
 * value, which does not exist. That shape is what makes a missed permission
 * statement fail closed rather than open.
 */

import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { orgMembers, users } from "@/lib/db/schema";
import { getSeededOrganizationId } from "@/lib/org/seeded-organization";

export interface PendingUser {
  userId: string;
  username: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
  avatarUrl: string | null;
  createdAt: Date;
}

export interface OrganizationMemberEntry {
  memberId: string;
  userId: string;
  username: string;
  email: string | null;
  name: string | null;
  avatarUrl: string | null;
  /** `owner` / `admin` / `member` — the organization role. */
  role: string;
  /** `admin` / `user` — the platform role, from `users.role`. */
  platformRole: string;
  banned: boolean;
  joinedAt: Date;
}

/** Every signed-in user holding no membership row in the seeded organization. */
export async function listPendingUsers(): Promise<PendingUser[]> {
  const organizationId = await getSeededOrganizationId();
  if (!organizationId) {
    return [];
  }

  return await db
    .select({
      userId: users.id,
      username: users.username,
      email: users.email,
      emailVerified: users.emailVerified,
      name: users.name,
      avatarUrl: users.avatarUrl,
      createdAt: users.createdAt,
    })
    .from(users)
    .leftJoin(
      orgMembers,
      and(
        eq(orgMembers.userId, users.id),
        eq(orgMembers.organizationId, organizationId),
      ),
    )
    .where(isNull(orgMembers.id))
    .orderBy(desc(users.createdAt));
}

/** Every approved member of the seeded organization. */
export async function listOrganizationMembers(): Promise<
  OrganizationMemberEntry[]
> {
  const organizationId = await getSeededOrganizationId();
  if (!organizationId) {
    return [];
  }

  return await db
    .select({
      memberId: orgMembers.id,
      userId: users.id,
      username: users.username,
      email: users.email,
      name: users.name,
      avatarUrl: users.avatarUrl,
      role: orgMembers.role,
      platformRole: users.role,
      banned: users.banned,
      joinedAt: orgMembers.createdAt,
    })
    .from(orgMembers)
    .innerJoin(users, eq(users.id, orgMembers.userId))
    .where(eq(orgMembers.organizationId, organizationId))
    .orderBy(desc(orgMembers.createdAt));
}
