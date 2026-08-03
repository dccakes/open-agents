/**
 * Making removal and ban take effect *now* rather than eventually.
 *
 * Every permission check in this codebase is a per-request database lookup and
 * session cookie caching is prohibited, so a demotion is already effective on
 * the target's next request. Removal and ban go further and kill the sessions
 * outright, so there is no window at all.
 *
 * **In-flight agent runs are explicitly out of scope.** A removed member's
 * running agent keeps executing in a sandbox holding their GitHub token;
 * stopping it needs per-run termination, which is the admin runs dashboard's
 * job (WS-1.5). Callers must not describe removal as if the run stopped.
 */

import { headers as nextHeaders } from "next/headers";
import { recordAuditEvent } from "@/lib/audit/record";
import { auth } from "@/lib/auth/config";
import { revokeSharesForUser } from "@/lib/db/user-shares";

export interface RevokeAccessResult {
  sessionsRevoked: boolean;
  sharesRevoked: number;
}

/**
 * Revoke a user's sessions and share links.
 *
 * Best-effort per step: a failure to revoke sessions must not leave their
 * shares published, and vice versa, so each failure is logged rather than
 * thrown.
 */
export async function revokeUserAccess(
  userId: string,
  options?: { headers?: Headers },
): Promise<RevokeAccessResult> {
  let sessionsRevoked = false;
  try {
    await auth.api.revokeUserSessions({
      body: { userId },
      headers: options?.headers ?? (await nextHeaders()),
    });
    sessionsRevoked = true;
    recordAuditEvent({
      action: "membership.sessions_revoked",
      targetId: userId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      `[membership] Failed to revoke sessions for ${userId}: ${message}`,
    );
  }

  let sharesRevoked = 0;
  try {
    sharesRevoked = await revokeSharesForUser(userId);
    if (sharesRevoked > 0) {
      recordAuditEvent({
        action: "membership.shares_revoked",
        targetId: userId,
        metadata: { count: sharesRevoked },
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      `[membership] Failed to revoke shares for ${userId}: ${message}`,
    );
  }

  return { sessionsRevoked, sharesRevoked };
}
