import { eq } from "drizzle-orm";
import { PLATFORM_ADMIN_ROLE } from "@/lib/auth/permissions";
import { db } from "./client";
import { users } from "./schema";

/**
 * Check if a user exists in the database by ID.
 * Returns true if found, false otherwise. Lightweight query (only fetches the ID).
 */
export async function userExists(userId: string): Promise<boolean> {
  const result = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return result.length > 0;
}

/**
 * Check if a user holds the *platform* admin role.
 *
 * Reads `users.role` (the better-auth admin plugin's column), which the
 * migration backfilled from the legacy `is_admin` boolean. The signature is
 * unchanged on purpose: `app/api/auth/info/route.ts`, `lib/admin/actions.ts`,
 * and `hooks/use-session.ts` keep working without edits.
 *
 * This is the instance-level role — bulk token revocation, ban, impersonate.
 * Shared organization configuration is gated by `requirePermission()` instead.
 */
export async function isUserAdmin(userId: string): Promise<boolean> {
  const result = await db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return result[0]?.role === PLATFORM_ADMIN_ROLE;
}
