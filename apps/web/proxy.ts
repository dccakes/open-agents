/**
 * Next.js request proxy (the `middleware.ts` successor).
 *
 * An adapter over two independent concerns, each of which lives — and is
 * unit-tested — in its own module:
 *
 * 1. the membership gate, which refuses a signed-in but unapproved user before
 *    routing, so a route added tomorrow is gated without anyone remembering to
 *    gate it;
 * 2. content-negotiated markdown for public share links.
 *
 * `proxy.ts` runs on the Node.js runtime, which is what lets the gate reach the
 * database. Membership is a positive row lookup, not something readable off a
 * cookie.
 */

import { type NextRequest, NextResponse } from "next/server";
import { gateMembership } from "@/lib/session/membership-proxy";
import { rewriteSharedMarkdown } from "@/lib/shares/markdown-rewrite";

export async function proxy(request: NextRequest): Promise<Response> {
  const gated = await gateMembership(request);
  if (gated) {
    return gated;
  }

  return rewriteSharedMarkdown(request) ?? NextResponse.next();
}

export const config = {
  // Static assets are excluded here as well as in `isMembershipExemptPath`, so
  // they never reach the runtime at all.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
