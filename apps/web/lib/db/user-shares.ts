/**
 * Revoking every share link a user published.
 *
 * Removing or banning a member has to take their share links with it, because
 * a share URL is readable by anyone holding it — no session, no membership
 * check. Deleting the `shares` row is what makes the URL stop resolving.
 *
 * Scope, stated honestly (design Decision 13): this covers links that still
 * resolve. A link someone already fetched and copied elsewhere is gone from
 * our reach, which is what the `shares` feature is. The membership gate's
 * guarantee is over *authenticated* access paths.
 */

import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { chats, sessions, shares } from "@/lib/db/schema";

/** Delete every share belonging to a chat in one of the user's sessions. */
export async function revokeSharesForUser(userId: string): Promise<number> {
  const ownedChats = await db
    .select({ id: chats.id })
    .from(chats)
    .innerJoin(sessions, eq(sessions.id, chats.sessionId))
    .where(eq(sessions.userId, userId));

  if (ownedChats.length === 0) {
    return 0;
  }

  const revoked = await db
    .delete(shares)
    .where(
      inArray(
        shares.chatId,
        ownedChats.map((chat) => chat.id),
      ),
    )
    .returning({ id: shares.id });

  return revoked.length;
}
