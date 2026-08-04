/**
 * Execute the application-level side effect an approval gates.
 *
 * Separate from the decision route on purpose. Deciding is a one-way write that
 * must succeed the instant a user clicks; executing reprovisions a sandbox,
 * mints an installation token, and pushes — work that can take a minute and can
 * fail on its own terms. Folding it into the decision would mean a failed push
 * looked like a failed approval, and a retry would try to re-decide a decision
 * that is already terminal.
 *
 * Authorization, single-use enforcement, and the skipped-by-policy report all
 * live in `lib/policy/app-side-effect-execution.ts`; this route only adapts.
 * A denied or expired approval is a 200 with a `skipped` result: the request
 * succeeded, and what it reports is that nothing was pushed.
 */

import { executeAppSideEffect } from "@/lib/policy/app-side-effect-execution";
import { policyErrorResponse } from "@/lib/policy/policy-error-response";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ sessionId: string; approvalId: string }> },
) {
  const { sessionId, approvalId } = await params;

  try {
    const result = await executeAppSideEffect({ sessionId, approvalId });
    return Response.json({ result });
  } catch (error) {
    return policyErrorResponse(error);
  }
}
