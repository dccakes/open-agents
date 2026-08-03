/**
 * Resolving a Linear actor to a user who may actually start a run.
 *
 * The webhook has no browser session — it matches the actor's *email* to a
 * user row — so the cookie-based chokepoint in `lib/session/` never runs for
 * it. Without the membership check below, delegating a Linear issue to a
 * pending user's email would produce an agent run for someone no admin has
 * ever approved.
 */

import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { isApprovedMember } from "@/lib/org/membership";

export type LinearActorResolution =
  | { ok: true; userId: string }
  /** The payload carried no actor email at all. */
  | { ok: false; reason: "no-email" }
  /** No user has signed in with that address. */
  | { ok: false; reason: "not-connected" }
  /** A user exists, but holds no membership row. */
  | { ok: false; reason: "pending"; userId: string };

export async function resolveApprovedLinearActor(
  actorEmail: string | undefined,
): Promise<LinearActorResolution> {
  if (!actorEmail) {
    return { ok: false, reason: "no-email" };
  }

  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, actorEmail))
    .limit(1);

  if (!user) {
    return { ok: false, reason: "not-connected" };
  }

  if (!(await isApprovedMember(user.id))) {
    return { ok: false, reason: "pending", userId: user.id };
  }

  return { ok: true, userId: user.id };
}
