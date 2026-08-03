/**
 * The membership gate for page and API requests, evaluated before routing.
 *
 * This is the *second* half of the structural enforcement described in the
 * design: the server session helper refuses to hand a pending user a session
 * at all, and this runs earlier so the refusal is a 403 that names the reason
 * (and a redirect to the approval screen for page navigations) rather than
 * whatever each route happens to do with a missing session.
 *
 * Kept out of `proxy.ts` so it is testable — the Next.js convention file stays
 * a three-line adapter.
 */

import { type NextRequest, NextResponse } from "next/server";
import {
  isApiPath,
  isMembershipExemptPath,
  PENDING_APPROVAL_PATH,
} from "@/lib/session/gated-paths";
import { getSessionWithMembershipFromReq } from "@/lib/session/server";

export const PENDING_APPROVAL_MESSAGE =
  "Your membership is pending approval by an administrator.";

/**
 * Refuse a pending user's request, or return `undefined` to let it through.
 *
 * Signed-out callers are *not* refused here: sign-in has to be reachable, and
 * authentication is each route's own existing concern. This gate answers only
 * "is this signed-in user an approved member?".
 */
export async function gateMembership(
  req: NextRequest,
): Promise<Response | undefined> {
  const { pathname } = req.nextUrl;

  if (isMembershipExemptPath(pathname)) {
    return undefined;
  }

  let approved: boolean;
  let signedIn: boolean;
  try {
    const state = await getSessionWithMembershipFromReq(req);
    signedIn = state.session !== undefined;
    approved = state.approved;
  } catch (error) {
    // Erring open here is deliberate and safe: the server session helper is
    // the authoritative chokepoint and fails closed on the same error, so a
    // transient database blip degrades into "every route refuses" rather than
    // into "the proxy 500s every request, sign-out included".
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[membership] Gate could not resolve membership: ${message}`);
    return undefined;
  }

  if (!signedIn || approved) {
    return undefined;
  }

  if (isApiPath(pathname)) {
    return Response.json({ error: PENDING_APPROVAL_MESSAGE }, { status: 403 });
  }

  return NextResponse.redirect(new URL(PENDING_APPROVAL_PATH, req.url));
}
