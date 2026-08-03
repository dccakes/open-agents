/**
 * The request-handler half of the membership chokepoint.
 *
 * Mirrors `get-server-session.ts` for route handlers that hold a
 * `NextRequest`: `getSessionFromReq()` hands out a session only for an
 * approved member, so a route's existing "no session" branch already refuses
 * pending users.
 */

import type { NextRequest } from "next/server";
import { auth } from "@/lib/auth/config";
import {
  type SessionMembershipState,
  toSessionMembershipState,
} from "./map-session";
import type { Session } from "./types";

/** The session plus its membership state, including for pending users. */
export async function getSessionWithMembershipFromReq(
  req: NextRequest,
): Promise<SessionMembershipState> {
  const baSession = await auth.api.getSession({ headers: req.headers });
  return await toSessionMembershipState(baSession);
}

/** The signed-in, **approved** user's session. */
export async function getSessionFromReq(
  req: NextRequest,
): Promise<Session | undefined> {
  const { session, approved } = await getSessionWithMembershipFromReq(req);
  return approved ? session : undefined;
}
