/**
 * The one decision that turns a brand-new sign-in into a member — or into a
 * pending user.
 *
 * Kept pure and free of database access so the security-critical rules are
 * testable in isolation:
 *
 * - **Both** allowlists require `emailVerified`. An unverified `ADMIN_EMAILS`
 *   match would be a full-takeover path, since anyone able to register that
 *   address at any OAuth provider would become an organization owner.
 * - An absent email never matches. GitHub accounts can withhold one.
 * - An unset `ALLOWED_EMAIL_DOMAINS` auto-approves *nobody*. "Unconfigured"
 *   must fail closed, or the gate is a no-op on every deployment that forgot
 *   to set it.
 * - Domain comparison is case-insensitive and exact — `mail.nextdegree.org`
 *   does not satisfy an entry of `nextdegree.org`.
 *
 * The decision is made once, from the email on the *user record* at creation.
 * `accountLinking.allowDifferentEmails` is enabled, so linking a second
 * provider account later must never re-run this.
 */

import {
  type EmailIdentity,
  isBootstrapAdmin,
} from "@/lib/org/membership-plan";

export type SignupOrganizationRole = "owner" | "member";

export interface SignupApprovalConfig {
  /** Domains auto-approved into the seeded organization. Empty means nobody. */
  allowedEmailDomains: readonly string[];
  /** Emails bootstrapped as organization owner + platform admin. */
  adminEmails: readonly string[];
}

export interface SignupApproval {
  organizationRole: SignupOrganizationRole;
  platformAdmin: boolean;
}

/**
 * The domain part of a verified address, lowercased.
 *
 * Returns `null` for an absent, unverified, or malformed address — every one
 * of which must fail to match rather than match loosely.
 */
function verifiedEmailDomain(user: EmailIdentity): string | null {
  if (!(user.email && user.emailVerified)) {
    return null;
  }

  const parts = user.email.trim().toLowerCase().split("@");
  if (parts.length !== 2) {
    return null;
  }

  const [local, domain] = parts;
  if (!(local && domain)) {
    return null;
  }

  return domain;
}

/** Whether a verified address' domain is exactly one of the allowed domains. */
export function matchesAllowedDomain(
  user: EmailIdentity,
  allowedEmailDomains: readonly string[],
): boolean {
  const domain = verifiedEmailDomain(user);
  if (!domain) {
    return false;
  }

  return allowedEmailDomains.some(
    (allowed) => allowed.trim().toLowerCase() === domain,
  );
}

/**
 * What a newly created user is granted, or `null` when they are pending.
 *
 * `null` is the common case by design: no membership row means pending, and
 * pending fails closed everywhere because every check is positive.
 */
export function decideSignupApproval(
  user: EmailIdentity,
  config: SignupApprovalConfig,
): SignupApproval | null {
  if (isBootstrapAdmin(user, config.adminEmails)) {
    return { organizationRole: "owner", platformAdmin: true };
  }

  if (matchesAllowedDomain(user, config.allowedEmailDomains)) {
    return { organizationRole: "member", platformAdmin: false };
  }

  return null;
}
