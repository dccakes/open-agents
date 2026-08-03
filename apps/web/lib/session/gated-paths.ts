/**
 * Which request paths the membership gate lets through.
 *
 * The list is deliberately an *exemption* list rather than a protection list:
 * a path added tomorrow is gated unless someone writes it down here, which is
 * the whole point of enforcing structurally instead of per route.
 */

/**
 * Prefixes a pending — or signed-out — user must still reach.
 *
 * - `/api/auth` is how they sign in and out at all.
 * - `/shared` and `/api/shared` are the public share surface, which serves
 *   unauthenticated viewers by design (see design Decision 13).
 * - `/api/linear/webhook` carries no browser session; it checks the *matched*
 *   user's membership itself.
 * - `/pending` is the approval-request screen a gated user is sent to.
 */
const EXEMPT_PREFIXES = [
  "/api/auth",
  "/api/linear/webhook",
  "/api/shared",
  "/shared",
  "/pending",
  "/deploy-your-own",
  "/get-started",
] as const;

/** Next.js internals and static assets, which carry no authorization meaning. */
const INTERNAL_PREFIXES = ["/_next", "/__nextjs", "/monitoring"] as const;

function hasPrefix(pathname: string, prefixes: readonly string[]): boolean {
  return prefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/** Whether the membership gate should be skipped for this path. */
export function isMembershipExemptPath(pathname: string): boolean {
  if (hasPrefix(pathname, INTERNAL_PREFIXES)) {
    return true;
  }

  if (hasPrefix(pathname, EXEMPT_PREFIXES)) {
    return true;
  }

  // A file extension means a static asset (`/favicon.ico`, `/robots.txt`).
  return /\.[a-z0-9]+$/i.test(pathname);
}

/** Whether a gated refusal should be JSON (an API route) or a redirect. */
export function isApiPath(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}

/** Where the gate sends a pending user's page request. */
export const PENDING_APPROVAL_PATH = "/pending";
