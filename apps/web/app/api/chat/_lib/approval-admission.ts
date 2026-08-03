/**
 * Refusing a resume request whose approval claims are not backed by a record.
 *
 * An approval decision reaches the server inside the client-supplied
 * `messages[].parts` of a brand-new `POST /api/chat`, so every claim in it is
 * an assertion. `lib/policy/approval-assertions.ts` is the check; this is where
 * it is applied, and it applies it narrowly on purpose.
 *
 * **Only unexecuted claims are checked.** A part in `approval-responded` is a
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

import { verifyAssertedApprovals } from "@/lib/policy/approval-assertions";

/** Approval flows that predate approval records and have no row to verify. */
export const LEGACY_UNRECORDED_APPROVAL_TOOLS: ReadonlySet<string> = new Set([
  "web_fetch",
  "ask_user_question",
]);

const TOOL_PART_PREFIX = "tool-";

export type ApprovalAdmission =
  | { ok: true }
  | { ok: false; response: Response };

export interface ApprovalAdmissionInput {
  sessionId: string;
  /** The untrusted `messages` array from the request body. */
  messages: unknown;
  now?: Date;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toolNameOf(part: Record<string, unknown>): string | null {
  const type = part.type;
  if (typeof type !== "string" || !type.startsWith(TOOL_PART_PREFIX)) {
    return null;
  }
  const name = type.slice(TOOL_PART_PREFIX.length);
  return name.length > 0 ? name : null;
}

function isUncheckedApprovalClaim(part: unknown): boolean {
  if (!isRecord(part)) {
    return false;
  }
  if (part.state !== "approval-responded") {
    return false;
  }

  const approval = part.approval;
  if (!isRecord(approval) || approval.approved !== true) {
    return false;
  }

  const toolName = toolNameOf(part);
  return toolName !== null && !LEGACY_UNRECORDED_APPROVAL_TOOLS.has(toolName);
}

/**
 * The claims this request is about to act on, in the shape
 * `verifyAssertedApprovals` reads.
 */
function pendingClaims(messages: unknown): Array<{ parts: unknown[] }> {
  if (!Array.isArray(messages)) {
    return [];
  }

  const latest = messages.at(-1);
  if (!isRecord(latest) || !Array.isArray(latest.parts)) {
    return [];
  }

  const parts = latest.parts.filter(isUncheckedApprovalClaim);
  return parts.length > 0 ? [{ parts }] : [];
}

/** Whether this request's approval claims may be acted on. */
export async function checkApprovalAdmission(
  input: ApprovalAdmissionInput,
): Promise<ApprovalAdmission> {
  const claims = pendingClaims(input.messages);
  if (claims.length === 0) {
    return { ok: true };
  }

  const refusals = await verifyAssertedApprovals({
    sessionId: input.sessionId,
    messages: claims,
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
