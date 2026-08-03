/**
 * Answer a pending approval.
 *
 * `POST` rather than `PATCH` because a decision is not a partial update of a
 * mutable resource — it is a one-way transition, and a second call is a 409
 * rather than an idempotent overwrite.
 *
 * Authorization, the terminal-state refusal, and the audit record all live in
 * `lib/policy/approval-decisions.ts`; this route only adapts.
 */

import { decideApproval } from "@/lib/policy/approval-decisions";
import { policyErrorResponse } from "@/lib/policy/policy-error-response";

interface DecisionBody {
  decision?: unknown;
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ sessionId: string; approvalId: string }> },
) {
  const { sessionId, approvalId } = await params;

  let body: DecisionBody;
  try {
    body = (await req.json()) as DecisionBody;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const approval = await decideApproval({
      sessionId,
      approvalId,
      // Validated inside `decideApproval`, after authorization, so a caller
      // with no access to the session cannot probe the accepted values.
      decision: body.decision as "approved" | "denied",
    });

    return Response.json({ approval });
  } catch (error) {
    return policyErrorResponse(error);
  }
}
