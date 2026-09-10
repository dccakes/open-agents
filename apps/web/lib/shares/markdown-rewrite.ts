/**
 * Content-negotiated markdown for public share links.
 *
 * `GET /shared/:id` with an `Accept: text/markdown` (or `text/plain`) header is
 * rewritten to the markdown route, so a share URL pasted into a terminal or an
 * agent returns text rather than an HTML page.
 *
 * Extracted from `proxy.ts` so the proxy file stays an adapter over two
 * independent concerns — this rewrite and the membership gate.
 */

import { type NextRequest, NextResponse } from "next/server";

function wantsSharedMarkdown(acceptHeader: string | null): boolean {
  if (!acceptHeader) {
    return false;
  }

  const accept = acceptHeader.toLowerCase();
  return accept.includes("text/markdown") || accept.includes("text/plain");
}

/** The markdown rewrite for this request, or `undefined` to leave it alone. */
export function rewriteSharedMarkdown(
  request: NextRequest,
): Response | undefined {
  if (request.method !== "GET") {
    return undefined;
  }

  const segments = request.nextUrl.pathname.split("/").filter(Boolean);

  if (
    segments.length === 2 &&
    segments[0] === "shared" &&
    wantsSharedMarkdown(request.headers.get("accept"))
  ) {
    const rewrittenUrl = request.nextUrl.clone();
    rewrittenUrl.pathname = `/api/shared/${segments[1]}/markdown`;
    return NextResponse.rewrite(rewrittenUrl);
  }

  return undefined;
}
