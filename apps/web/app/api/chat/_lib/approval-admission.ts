/**
 * Turning the approval claims in a resume request into server-side decisions,
 * and refusing the ones no record backs.
 *
 * An approval decision reaches the server inside the client-supplied
 * `messages[].parts` of a brand-new `POST /api/chat`, so every claim in it is
 * an assertion. This is where an assertion becomes a decision: for each claim
 * the request is about to act on, the matching `approval` row is moved off
 * `pending` and attributed to the authenticated caller, and then the claim is
 * verified against the record exactly as before.
 *
 * **Recording is not granting.** A decision can only ever be written onto a row
 * that already exists because a policy `ask` created it, and only while it is
 * still pending. A claim about a tool call nobody gated finds no row and is
 * refused; a denied, expired or already-spent row is left alone and still
 * refuses. Single use stays with the compare-and-set in
 * `consumeToolCallApproval`, and expiry stays authoritative on read.
 *
 * **A denial is recorded too.** Claiming "denied" grants nothing, but the row
 * has to learn about it: an unanswered row would sit pending until it expired,
 * and the tool would report "still waiting" for an operation the user refused.
 *
 * **Only unexecuted claims are acted on.** A part in `approval-responded` is a
 * decision waiting to authorize an execution. A part that already carries
 * output was executed in an earlier run and will not run again, so re-checking
 * it would refuse every session whose history predates approval records
 * without protecting anything. Only the latest message can carry a decision
 * that is about to be acted on — that is the same message
 * `persistAssistantMessagesWithToolResults` persists from.
 *
 * **Two tools are exempt, explicitly.** `web_fetch` pauses unconditionally via
 * `needsApproval: true` and `ask_user_question` is a client-side tool; both
 * predate this system and neither produces a policy `ask`, so neither has an
 * approval row to find. Exempting them by name is visible and testable;
 * silently admitting anything without a row would not be.
 *
 * This is admission control, not the authorization. `consumeToolCallApproval`
 * at execute time is the authority, and it applies to every tool.
 */

import {
  type AssertedApproval,
  extractApprovalAssertions,
  verifyAssertedApprovals,
} from "@/lib/policy/approval-assertions";
import { recordAssertedApprovalDecision } from "@/lib/policy/approval-decisions";

/** Approval flows that predate approval records and have no row to verify. */
export const LEGACY_UNRECORDED_APPROVAL_TOOLS: ReadonlySet<string> = new Set([
  "web_fetch",
  "ask_user_question",
]);

/** The part state of a decision that has not authorized an execution yet. */
const UNEXECUTED_STATE = "approval-responded";

export type ApprovalAdmission =
  | { ok: true }
  | { ok: false; response: Response };

export interface ApprovalAdmissionInput {
  sessionId: string;
  /**
   * The authenticated caller. The route establishes that they own this session
   * before calling; this is that user, not anything the body says.
   */
  actorUserId: string;
  /** The session's posture, for the audit record on each decision. */
  posture: string;
  /** The untrusted `messages` array from the request body. */
  messages: unknown;
  now?: Date;
}

/** The last message alone, since only it can carry a decision about to run. */
function latestMessageOnly(messages: unknown): unknown[] {
  if (!Array.isArray(messages)) {
    return [];
  }

  const latest = messages.at(-1);
  return latest === undefined ? [] : [latest];
}

function isActionableClaim(claim: AssertedApproval): boolean {
  return (
    claim.state === UNEXECUTED_STATE &&
    claim.toolName !== null &&
    !LEGACY_UNRECORDED_APPROVAL_TOOLS.has(claim.toolName)
  );
}

/** The claims this request is about to act on. */
function actionableClaims(messages: unknown): AssertedApproval[] {
  return extractApprovalAssertions(latestMessageOnly(messages)).filter(
    isActionableClaim,
  );
}

/** Whether this request's approval claims may be acted on. */
export async function checkApprovalAdmission(
  input: ApprovalAdmissionInput,
): Promise<ApprovalAdmission> {
  const claims = actionableClaims(input.messages);
  if (claims.length === 0) {
    return { ok: true };
  }

  for (const claim of claims) {
    await recordAssertedApprovalDecision({
      sessionId: input.sessionId,
      toolCallId: claim.toolCallId,
      decision: claim.approved ? "approved" : "denied",
      actorUserId: input.actorUserId,
      posture: input.posture,
      now: input.now,
    });
  }

  const refusals = await verifyAssertedApprovals({
    sessionId: input.sessionId,
    assertions: claims,
    now: input.now,
  });

  if (refusals.length === 0) {
    return { ok: true };
  }

  return {
    ok: false,
    response: Response.json(
      {
        error:
          "This request claimed an approval that the server has no record of granting, so nothing was run.",
        code: "approval_not_verified",
        refusedApprovals: refusals,
      },
      { status: 403 },
    ),
  };
}
