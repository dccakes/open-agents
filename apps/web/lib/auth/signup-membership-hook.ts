/**
 * The Better Auth `user.create.after` hook that runs the membership allowlist.
 *
 * This is the single place membership is granted automatically, so there is
 * one place to audit. It is deliberately mounted on **user** creation rather
 * than on sign-in or account linking:
 *
 * - `accountLinking.allowDifferentEmails` is enabled, so a pending user could
 *   otherwise link a second provider account carrying an allowlisted address
 *   and let themselves in.
 * - Better Auth creates an `account` row, not a `user` row, when linking, so a
 *   hook mounted here cannot fire for a link.
 *
 * A failure here leaves the user pending rather than failing the sign-in: the
 * gate fails closed, and a pending user sees the approval-request screen
 * instead of an opaque OAuth error.
 */

import { grantSignupMembership } from "@/lib/org/grant-signup-membership";

/** The subset of the created row this hook reads. Better Auth passes more. */
export interface CreatedUserRecord {
  id: string;
  email?: string | null;
  emailVerified?: boolean | null;
}

export async function applySignupMembership(
  user: CreatedUserRecord,
): Promise<void> {
  try {
    await grantSignupMembership({
      id: user.id,
      email: user.email ?? null,
      emailVerified: user.emailVerified === true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      `[membership] Failed to evaluate the sign-up allowlist for ${user.id}; leaving them pending: ${message}`,
    );
  }
}
