/**
 * Turning a policy-layer failure into an HTTP response.
 *
 * Every policy route answers the same way, so a 403 from `requireSessionActor`
 * and a 409 from a re-decided approval do not become two different response
 * shapes depending on which route caught them. Unrecognized errors are logged
 * and answered as 500 without leaking their message.
 */

import { isAuthorizationError } from "@/lib/auth/authorization-error";
import { isApprovalError } from "@/lib/policy/approval-errors";

export function policyErrorResponse(error: unknown): Response {
  if (isAuthorizationError(error)) {
    return Response.json({ error: error.message }, { status: error.status });
  }

  if (isApprovalError(error)) {
    return Response.json(
      { error: error.message, code: error.kind },
      { status: error.status },
    );
  }

  const detail = error instanceof Error ? error.message : String(error);
  console.error(`[policy] Request failed: ${detail}`);
  return Response.json(
    { error: "The request could not be completed." },
    { status: 500 },
  );
}
