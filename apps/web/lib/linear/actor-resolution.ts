/**
 * Deciding which QuackOps user a Linear actor is, without touching the
 * database.
 *
 * Two inputs can identify an actor and they are deliberately unequal in
 * authority:
 *
 * 1. An **explicit mapping** an administrator recorded. `accountLinking`
 *    permits a member's Linear address to differ from their sign-in address,
 *    so a mismatch is an ordinary state rather than a misconfiguration, and it
 *    needs a resolution somebody decided on.
 * 2. A **verified-email match**. Requiring `emailVerified` is what stops the
 *    obvious spoof — the webhook carries no cookie, so an unverified address
 *    is an unproven claim about who someone is.
 *
 * There is no third input. An actor matching neither does not resolve, and no
 * default, fallback, or organization identity stands in for them: anyone able
 * to act in the connected Linear workspace could otherwise start an agent run
 * attributed to the organization.
 */

export interface LinearActorIdentity {
  /** The actor's Linear user id, when the payload carried one. */
  linearUserId?: string | undefined;
  /** The actor's email, when the payload carried one. */
  email?: string | undefined;
}

/** What the database found for the identity above. */
export interface LinearActorLookup {
  /** The user an administrator mapped this Linear identity to, if any. */
  mappedUserId: string | null;
  /** A user whose email matches, whether or not it is verified. */
  emailMatch: { userId: string; emailVerified: boolean } | null;
}

export type LinearActorResolution =
  | { ok: true; userId: string; via: "mapping" | "verified-email" }
  /** The payload carried neither a Linear user id nor an email. */
  | { ok: false; reason: "no-identity" }
  /** Nobody is mapped, and no user holds that address. */
  | { ok: false; reason: "not-connected" }
  /** A user holds that address but has never verified it. */
  | { ok: false; reason: "unverified-email"; userId: string };

/**
 * Resolve an actor to a user id, or explain why not.
 *
 * Membership is *not* checked here — that is a separate question with a
 * separate answer ("pending"), and keeping it out means this function's rules
 * can be read and tested on their own. The caller applies it.
 */
export function resolveLinearActorIdentity(
  identity: LinearActorIdentity,
  lookup: LinearActorLookup,
): LinearActorResolution {
  const hasLinearUserId = Boolean(identity.linearUserId);
  const hasEmail = Boolean(identity.email);

  if (!(hasLinearUserId || hasEmail)) {
    return { ok: false, reason: "no-identity" };
  }

  // The mapping wins over a conflicting email match: it is the deliberate
  // statement, and the email match is an inference.
  if (lookup.mappedUserId) {
    return { ok: true, userId: lookup.mappedUserId, via: "mapping" };
  }

  if (!lookup.emailMatch) {
    return { ok: false, reason: "not-connected" };
  }

  if (!lookup.emailMatch.emailVerified) {
    return {
      ok: false,
      reason: "unverified-email",
      userId: lookup.emailMatch.userId,
    };
  }

  return {
    ok: true,
    userId: lookup.emailMatch.userId,
    via: "verified-email",
  };
}
