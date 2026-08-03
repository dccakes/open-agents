/**
 * Idempotent runtime seeding of the single organization.
 *
 * This cannot be a migration. Migrations are static committed SQL executed by
 * `lib/db/migrate.ts`; they cannot read `DEFAULT_ORG_NAME`, `DEFAULT_ORG_SLUG`,
 * or `ADMIN_EMAILS`, and hardcoding one environment's values into committed
 * SQL would bake them into every preview too.
 *
 * Every write here is insert-with-conflict rather than check-then-insert, so
 * two instances booting simultaneously against an empty database converge on
 * one organization row through the `organizations.slug` unique index instead
 * of racing between the check and the insert.
 */

import { and, eq, inArray, isNull, ne, notInArray } from "drizzle-orm";
import { nanoid } from "nanoid";
import { PLATFORM_ADMIN_ROLE } from "@/lib/auth/permissions";
import { getMembershipConfig } from "@/lib/config/auth";
import { db } from "@/lib/db/client";
import {
  authSessions,
  orgMembers,
  organizations,
  users,
} from "@/lib/db/schema";
import {
  planPlatformAdminIds,
  planSeedMemberships,
} from "@/lib/org/membership-plan";
import { setSeededOrganizationId } from "@/lib/org/seeded-organization";

/** Roles that already satisfy "this user can administer the organization". */
const ORG_ADMIN_ROLES = ["owner", "admin"];

export interface SeedOrganizationResult {
  organizationId: string;
  /** True when this process inserted the row rather than finding it. */
  createdOrganization: boolean;
  grantedMemberships: number;
  promotedOrganizationOwners: number;
  promotedPlatformAdmins: number;
  backfilledSessions: number;
}

async function ensureOrganizationRow(): Promise<{
  id: string;
  created: boolean;
}> {
  const { defaultOrgName, defaultOrgSlug } = getMembershipConfig();

  const inserted = await db
    .insert(organizations)
    .values({ id: nanoid(), name: defaultOrgName, slug: defaultOrgSlug })
    .onConflictDoNothing({ target: organizations.slug })
    .returning({ id: organizations.id });

  const createdId = inserted[0]?.id;
  if (createdId) {
    return { id: createdId, created: true };
  }

  // The insert conflicted, which means another boot won the race.
  const existing = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.slug, defaultOrgSlug))
    .limit(1);

  const id = existing[0]?.id;
  if (!id) {
    throw new Error(
      `Failed to seed the organization: no row for slug "${defaultOrgSlug}" after insert.`,
    );
  }

  return { id, created: false };
}

/**
 * Create the organization, grant membership to every existing user, bootstrap
 * the configured admins, and give already-issued sessions an organization.
 *
 * Safe to call on every boot.
 */
export async function ensureSeededOrganization(): Promise<SeedOrganizationResult> {
  const { adminEmails } = getMembershipConfig();
  const { id: organizationId, created } = await ensureOrganizationRow();
  setSeededOrganizationId(organizationId);

  // Extension point: the org-settings change creates its row here, keyed by
  // this organization id and likewise insert-with-conflict.

  const candidates = await db
    .select({
      id: users.id,
      email: users.email,
      emailVerified: users.emailVerified,
    })
    .from(users);

  const plan = planSeedMemberships(candidates, adminEmails);
  let grantedMemberships = 0;
  if (plan.length > 0) {
    const granted = await db
      .insert(orgMembers)
      .values(
        plan.map((entry) => ({
          id: nanoid(),
          organizationId,
          userId: entry.userId,
          role: entry.role,
        })),
      )
      .onConflictDoNothing({
        target: [orgMembers.organizationId, orgMembers.userId],
      })
      .returning({ id: orgMembers.id });
    grantedMemberships = granted.length;
  }

  // A configured admin who already had a plain membership before their email
  // was added to `ADMIN_EMAILS` is promoted, so a redeploy can always restore
  // an adminless deployment. An existing `admin` is left alone rather than
  // being pushed up to `owner`.
  const bootstrapAdminIds = planPlatformAdminIds(candidates, adminEmails);
  let promotedOrganizationOwners = 0;
  if (bootstrapAdminIds.length > 0) {
    const promoted = await db
      .update(orgMembers)
      .set({ role: "owner" })
      .where(
        and(
          eq(orgMembers.organizationId, organizationId),
          inArray(orgMembers.userId, bootstrapAdminIds),
          notInArray(orgMembers.role, ORG_ADMIN_ROLES),
        ),
      )
      .returning({ id: orgMembers.id });
    promotedOrganizationOwners = promoted.length;
  }

  let promotedPlatformAdmins = 0;
  if (bootstrapAdminIds.length > 0) {
    const promoted = await db
      .update(users)
      .set({ role: PLATFORM_ADMIN_ROLE })
      .where(
        and(
          inArray(users.id, bootstrapAdminIds),
          ne(users.role, PLATFORM_ADMIN_ROLE),
        ),
      )
      .returning({ id: users.id });
    promotedPlatformAdmins = promoted.length;
  }

  // Sessions issued before the organization existed carry a NULL active
  // organization. `requirePermission()` does not depend on this field, but
  // Better Auth's own endpoints do.
  const backfilled = await db
    .update(authSessions)
    .set({ activeOrganizationId: organizationId })
    .where(isNull(authSessions.activeOrganizationId))
    .returning({ id: authSessions.id });

  return {
    organizationId,
    createdOrganization: created,
    grantedMemberships,
    promotedOrganizationOwners,
    promotedPlatformAdmins,
    backfilledSessions: backfilled.length,
  };
}
