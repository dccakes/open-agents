/**
 * Who gets which organization role — decided without touching the database.
 *
 * Kept separate from the seeder so the rule ("a verified `ADMIN_EMAILS` match
 * is an owner, everyone else is a member") is testable on its own and can be
 * reused by the sign-in-time approval hook.
 */

export type SeededMembershipRole = "owner" | "member";

export interface SeedCandidateUser {
  id: string;
  email: string | null;
  emailVerified: boolean;
}

export interface PlannedMembership {
  userId: string;
  role: SeededMembershipRole;
}

/**
 * Whether a user's email bootstraps them as an admin.
 *
 * The email must be **verified**: otherwise registering an unverified matching
 * address at any OAuth provider would be a full takeover path. A null email
 * never matches, which is the case that matters because GitHub accounts can
 * withhold one.
 */
export function isBootstrapAdmin(
  user: SeedCandidateUser,
  adminEmails: readonly string[],
): boolean {
  if (!(user.email && user.emailVerified)) {
    return false;
  }

  const email = user.email.trim().toLowerCase();
  return adminEmails.some((candidate) => candidate.toLowerCase() === email);
}

/**
 * Membership rows for every existing user at cutover.
 *
 * Existing users predate the membership gate, so they are granted membership
 * rather than dropped into `pending` — dropping them would lock out a live
 * deployment. `ADMIN_EMAILS` holders become `owner`.
 */
export function planSeedMemberships(
  candidates: readonly SeedCandidateUser[],
  adminEmails: readonly string[],
): PlannedMembership[] {
  return candidates.map((user) => ({
    userId: user.id,
    role: isBootstrapAdmin(user, adminEmails) ? "owner" : "member",
  }));
}

/** Ids of the users who should hold the platform `admin` role after seeding. */
export function planPlatformAdminIds(
  candidates: readonly SeedCandidateUser[],
  adminEmails: readonly string[],
): string[] {
  return candidates
    .filter((user) => isBootstrapAdmin(user, adminEmails))
    .map((user) => user.id);
}
