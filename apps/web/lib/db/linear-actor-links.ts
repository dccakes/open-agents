import { and, asc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "./client";
import { type LinearActorLink, linearActorLinks } from "./schema";

export async function listLinearActorLinks(
  organizationId: string,
): Promise<LinearActorLink[]> {
  return db
    .select()
    .from(linearActorLinks)
    .where(eq(linearActorLinks.organizationId, organizationId))
    .orderBy(asc(linearActorLinks.linearUserId));
}

/** The user an administrator mapped this Linear identity to, if any. */
export async function getLinearActorLink(
  organizationId: string,
  linearUserId: string,
): Promise<LinearActorLink | undefined> {
  const [link] = await db
    .select()
    .from(linearActorLinks)
    .where(
      and(
        eq(linearActorLinks.organizationId, organizationId),
        eq(linearActorLinks.linearUserId, linearUserId),
      ),
    )
    .limit(1);

  return link;
}

/**
 * Map a Linear identity to a user.
 *
 * Conflict-tolerant on `(organizationId, linearUserId)`, so re-mapping an
 * identity moves it rather than raising — one Linear identity resolves to
 * exactly one QuackOps user, and the unique index is what guarantees it.
 */
export async function upsertLinearActorLink(params: {
  organizationId: string;
  linearUserId: string;
  userId: string;
  createdByUserId: string | null;
}): Promise<LinearActorLink> {
  const now = new Date();

  const [link] = await db
    .insert(linearActorLinks)
    .values({
      id: nanoid(),
      organizationId: params.organizationId,
      linearUserId: params.linearUserId,
      userId: params.userId,
      createdByUserId: params.createdByUserId,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [linearActorLinks.organizationId, linearActorLinks.linearUserId],
      set: {
        userId: params.userId,
        createdByUserId: params.createdByUserId,
        updatedAt: now,
      },
    })
    .returning();

  if (!link) {
    throw new Error("Failed to record Linear actor link");
  }

  return link;
}

export async function deleteLinearActorLink(
  organizationId: string,
  linearUserId: string,
): Promise<boolean> {
  const deleted = await db
    .delete(linearActorLinks)
    .where(
      and(
        eq(linearActorLinks.organizationId, organizationId),
        eq(linearActorLinks.linearUserId, linearUserId),
      ),
    )
    .returning({ id: linearActorLinks.id });

  return deleted.length > 0;
}
