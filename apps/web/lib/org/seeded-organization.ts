/**
 * Resolving the single seeded organization.
 *
 * Permission checks resolve the organization through here rather than through
 * `auth_sessions.active_organization_id`, which is NULL on every session
 * issued before this change existed. Trusting that field would fail closed for
 * already-signed-in users — admins included — until they signed out and back
 * in.
 */

import { eq } from "drizzle-orm";
import { getMembershipConfig } from "@/lib/config/auth";
import { db } from "@/lib/db/client";
import { organizations } from "@/lib/db/schema";

/**
 * Cached per process. Exactly one organization exists and its id never
 * changes, so a cache hit cannot go stale; a miss is never cached, so a
 * lookup that ran before the seeder is retried.
 */
let cachedOrganizationId: string | null = null;

/** The seeded organization's id, or `null` when seeding has not run yet. */
export async function getSeededOrganizationId(): Promise<string | null> {
  if (cachedOrganizationId) {
    return cachedOrganizationId;
  }

  const { defaultOrgSlug } = getMembershipConfig();
  const rows = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.slug, defaultOrgSlug))
    .limit(1);

  const id = rows[0]?.id;
  if (!id) {
    return null;
  }

  cachedOrganizationId = id;
  return id;
}

/** Prime the cache from a caller that already knows the id (the seeder). */
export function setSeededOrganizationId(id: string): void {
  cachedOrganizationId = id;
}

/** Drop the cache. Exists for tests; nothing in the app should need it. */
export function resetSeededOrganizationCache(): void {
  cachedOrganizationId = null;
}
