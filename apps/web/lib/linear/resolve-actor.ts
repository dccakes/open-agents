/**
 * Resolving a Linear actor to a user who may actually start a run.
 *
 * The webhook has no browser session — it identifies the actor from the
 * payload — so the cookie-based chokepoint in `lib/session/` never runs for
 * it. Without the membership check below, delegating a Linear issue to a
 * pending user would produce an agent run for someone no admin has approved.
 *
 * Two things identify an actor, and `lib/linear/actor-resolution.ts` holds the
 * rules for choosing between them: an administrator's explicit mapping, or a
 * match on a *verified* email. Requiring verification is what stops the
 * obvious spoof; the mapping exists because `accountLinking` permits a
 * member's Linear address to differ from their sign-in address, which makes a
 * mismatch ordinary rather than suspicious.
 *
 * There is deliberately no third path. An actor matching neither does not
 * resolve, and nothing stands in for them — an organization-default identity
 * would let anyone able to act in the connected workspace start a run
 * attributed to the organization.
 */

import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { getLinearActorLink } from "@/lib/db/linear-actor-links";
import { users } from "@/lib/db/schema";
import {
  type LinearActorIdentity,
  type LinearActorResolution as IdentityResolution,
  resolveLinearActorIdentity,
} from "@/lib/linear/actor-resolution";
import { isApprovedMember } from "@/lib/org/membership";
import { getSeededOrganizationId } from "@/lib/org/seeded-organization";

/**
 * The identity outcomes, plus the one this layer adds: a user was identified
 * but holds no membership row. Built on the pure resolver's union rather than
 * restating it, so a new refusal reason cannot be added there and silently
 * missed here.
 */
export type LinearActorResolution =
  | IdentityResolution
  /** A user was identified, but holds no membership row. */
  | { ok: false; reason: "pending"; userId: string };

async function findUserByEmail(
  email: string,
): Promise<{ userId: string; emailVerified: boolean } | null> {
  const [user] = await db
    .select({ id: users.id, emailVerified: users.emailVerified })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  return user ? { userId: user.id, emailVerified: user.emailVerified } : null;
}

export async function resolveApprovedLinearActor(
  actorEmail: string | undefined,
  actorLinearUserId?: string | undefined,
): Promise<LinearActorResolution> {
  const identity: LinearActorIdentity = {
    email: actorEmail,
    linearUserId: actorLinearUserId,
  };

  const organizationId = await getSeededOrganizationId();

  const mappedUserId =
    organizationId && actorLinearUserId
      ? ((await getLinearActorLink(organizationId, actorLinearUserId))
          ?.userId ?? null)
      : null;

  const emailMatch = actorEmail ? await findUserByEmail(actorEmail) : null;

  const resolution = resolveLinearActorIdentity(identity, {
    mappedUserId,
    emailMatch,
  });

  if (!resolution.ok) {
    return resolution;
  }

  // Membership is checked last and separately: a mapping is a statement about
  // *who* an actor is, never about what they may do. A mapped user who has
  // since been removed from the organization starts no run.
  if (!(await isApprovedMember(resolution.userId))) {
    return { ok: false, reason: "pending", userId: resolution.userId };
  }

  return resolution;
}
