/**
 * Turning a Better Auth session into the app's `Session` shape.
 *
 * Shared by the two entry points (`get-server-session.ts` for server
 * components and actions, `server.ts` for route handlers holding a request) so
 * the membership gate below cannot be satisfied on one path and skipped on the
 * other.
 */

import { isApprovedMember } from "@/lib/org/membership";
import type { Session } from "./types";

interface BetterAuthSessionLike {
  session: { createdAt: Date };
  user: {
    id: string;
    email?: string | null;
    image?: string | null;
    name?: string | null;
    [key: string]: unknown;
  };
}

/**
 * An authenticated request's state, membership included.
 *
 * `approved` is a *positive* membership check: a user with no `org_members`
 * row is pending, whatever else is true of them.
 */
export interface SessionMembershipState {
  /** The session, present whenever the caller is signed in — pending or not. */
  session: Session | undefined;
  /** Whether the signed-in user is an approved member of the organization. */
  approved: boolean;
}

export const UNAUTHENTICATED_STATE: SessionMembershipState = {
  session: undefined,
  approved: false,
};

function extractUsername(user: {
  name?: string | null;
  [key: string]: unknown;
}): string {
  if (typeof user.username === "string" && user.username) {
    return user.username;
  }
  return user.name ?? "";
}

function toSession(baSession: BetterAuthSessionLike): Session {
  return {
    created: baSession.session.createdAt.getTime(),
    authProvider: "vercel",
    user: {
      id: baSession.user.id,
      username: extractUsername(baSession.user),
      email: baSession.user.email ?? undefined,
      avatar: baSession.user.image ?? "",
      name: baSession.user.name ?? undefined,
    },
  };
}

/** Map a Better Auth session and resolve the user's membership alongside it. */
export async function toSessionMembershipState(
  baSession: BetterAuthSessionLike | null | undefined,
): Promise<SessionMembershipState> {
  if (!baSession?.user) {
    return UNAUTHENTICATED_STATE;
  }

  return {
    session: toSession(baSession),
    approved: await isApprovedMember(baSession.user.id),
  };
}
