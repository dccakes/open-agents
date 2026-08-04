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
  resolveLinearActorIdentity,
} from "@/lib/linear/actor-resolution";
import { isApprovedMember } from "@/lib/org/membership";
import { getSeededOrganizationId } from "@/lib/org/seeded-organization";

export type LinearActorResolution =
  | { ok: true; userId: string; via: "mapping" | "verified-email" }
  /** The payload carried no identifying information at all. */
  | { ok: false; reason: "no-email" }
  /** Nobody is mapped, and no user holds that address. */
  | { ok: false; reason: "not-connected" }
  /** A user holds that address but has never verified it. */
  | { ok: false; reason: "unverified-email"; userId: string }
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
    // `no-identity` keeps the wire name `no-email` that callers already switch
    // on; the payload still most often fails here for want of an address.
    return resolution.reason === "no-identity"
      ? { ok: false, reason: "no-email" }
      : resolution;
  }

  // Membership is checked last and separately: a mapping is a statement about
  // *who* an actor is, never about what they may do. A mapped user who has
  // since been removed from the organization starts no run.
  if (!(await isApprovedMember(resolution.userId))) {
    return { ok: false, reason: "pending", userId: resolution.userId };
  }

  return resolution;
}
