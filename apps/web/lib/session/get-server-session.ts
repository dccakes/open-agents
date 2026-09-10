/**
 * The structural chokepoint for approved membership.
 *
 * Every authenticated server path already crosses this helper, so the gate
 * lives here rather than in a per-route checklist: a route added tomorrow that
 * asks for a session and performs no membership check of its own still refuses
 * a pending user, because `getServerSession()` does not hand one out.
 *
 * `getSessionWithMembership()` is the deliberate escape hatch for the handful
 * of surfaces that must *distinguish* pending from signed-out — the approval
 * screen, `/api/auth/info`, and the request proxy. Everything else uses
 * `getServerSession()` and gets the fail-closed answer for free.
 */

import { headers } from "next/headers";
import { cache } from "react";
import { auth } from "@/lib/auth/config";
import {
  type SessionMembershipState,
  toSessionMembershipState,
} from "./map-session";
import type { Session } from "./types";

/** The session plus its membership state, including for pending users. */
export const getSessionWithMembership = cache(
  async (): Promise<SessionMembershipState> => {
    const baSession = await auth.api.getSession({ headers: await headers() });
    return await toSessionMembershipState(baSession);
  },
);

/**
 * The signed-in, **approved** user's session.
 *
 * Returns `undefined` both for a signed-out caller and for a pending one, so
 * every existing caller's "no session" branch already denies pending users.
 */
export const getServerSession = cache(
  async (): Promise<Session | undefined> => {
    const { session, approved } = await getSessionWithMembership();
    return approved ? session : undefined;
  },
);
