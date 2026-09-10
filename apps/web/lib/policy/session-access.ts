/**
 * "May this caller act on this session?" — the one answer, in one place.
 *
 * Two conditions, both required: the caller is an approved member of the
 * organization (a pending user is refused whatever else is true of them), and
 * the session is theirs. Organization membership alone is not enough — another
 * member has no business approving somebody else's agent's `git push`.
 *
 * A missing session and a session belonging to someone else are answered
 * identically, so an id cannot be probed for existence.
 */

import { AuthorizationError } from "@/lib/auth/authorization-error";
import {
  type PermissionCheckOptions,
  requireApprovedMember,
} from "@/lib/auth/require-permission";
import { getSessionById, type SessionRecord } from "@/lib/db/sessions";

export interface SessionActor {
  userId: string;
  organizationId: string;
  role: string;
  session: SessionRecord;
}

/**
 * Assert the caller may act on this session.
 *
 * @throws AuthorizationError (`unauthenticated` / `forbidden`).
 */
export async function requireSessionActor(
  sessionId: string,
  options?: PermissionCheckOptions,
): Promise<SessionActor> {
  const member = await requireApprovedMember(options);
  const session = await getSessionById(sessionId);

  if (!session || session.userId !== member.userId) {
    throw new AuthorizationError(
      "forbidden",
      "You may not act on this session.",
    );
  }

  return {
    userId: member.userId,
    organizationId: member.organizationId,
    role: member.role,
    session,
  };
}

/**
 * Whether the caller may act on this session, as a boolean.
 *
 * For hiding an affordance only — hiding a control is not authorization, so
 * every hidden control also passes through `requireSessionActor`.
 */
export async function canActOnSession(
  sessionId: string,
  options?: PermissionCheckOptions,
): Promise<boolean> {
  try {
    await requireSessionActor(sessionId, options);
    return true;
  } catch {
    return false;
  }
}
