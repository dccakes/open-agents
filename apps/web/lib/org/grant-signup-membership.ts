/**
 * Applying the sign-up allowlist decision to the database.
 *
 * Split from `signup-approval.ts` so the security-critical rule stays a pure
 * function: this file only writes what that function decided.
 *
 * Called from `databaseHooks.user.create.after`, which fires exactly once per
 * user row. Linking a second OAuth provider account creates an `account` row,
 * not a user row, so it never reaches here — which is what keeps
 * `accountLinking.allowDifferentEmails` from becoming a membership bypass.
 */

import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { recordAuditEvent } from "@/lib/audit/record";
import { PLATFORM_ADMIN_ROLE } from "@/lib/auth/permissions";
import { getMembershipConfig } from "@/lib/config/auth";
import { db } from "@/lib/db/client";
import { orgMembers, users } from "@/lib/db/schema";
import type { EmailIdentity } from "@/lib/org/membership-plan";
import { getSeededOrganizationId } from "@/lib/org/seeded-organization";
import {
  decideSignupApproval,
  type SignupApproval,
} from "@/lib/org/signup-approval";

export interface SignupUser extends EmailIdentity {
  id: string;
}

/**
 * Grant whatever the allowlists entitle a brand-new user to.
 *
 * @returns the grant that was applied, or `null` when the user is pending —
 * which is the fail-closed default for a non-match, an absent email, an
 * unverified email, or an unseeded organization.
 */
export async function grantSignupMembership(
  user: SignupUser,
): Promise<SignupApproval | null> {
  const approval = decideSignupApproval(user, getMembershipConfig());
  if (!approval) {
    return null;
  }

  const organizationId = await getSeededOrganizationId();
  if (!organizationId) {
    // Sign-in before the boot seeder finished. The user stays pending rather
    // than being granted membership against an organization that may not be
    // the seeded one.
    console.warn(
      "[membership] Organization not seeded yet; user left pending:",
      user.id,
    );
    return null;
  }

  await db
    .insert(orgMembers)
    .values({
      id: nanoid(),
      organizationId,
      userId: user.id,
      role: approval.organizationRole,
    })
    .onConflictDoNothing({
      target: [orgMembers.organizationId, orgMembers.userId],
    })
    .returning({ id: orgMembers.id });

  if (approval.platformAdmin) {
    await db
      .update(users)
      .set({ role: PLATFORM_ADMIN_ROLE })
      .where(eq(users.id, user.id));
  }

  recordAuditEvent({
    action: "membership.auto_granted",
    targetId: user.id,
    organizationId,
    metadata: {
      organizationRole: approval.organizationRole,
      platformAdmin: approval.platformAdmin,
    },
  });

  return approval;
}
