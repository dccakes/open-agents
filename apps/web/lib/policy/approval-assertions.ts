/**
 * Reading — and refusing to trust — the approval claims in a request body.
 *
 * When a run pauses for approval, the workflow *ends*. The user answers in the
 * chat, and the client sends a brand-new `POST /api/chat` whose body carries
 * the decision inside `messages[].parts[].approval`. That body is written by
 * the browser, so every claim in it is an assertion, not an authorization.
 *
 * This module turns those claims into a list, and checks each *positive* claim
 * against the `approval` table. A claim with no matching approved record is
 * refused. A denial is never checked: claiming "denied" grants nothing, so
 * there is no incentive to forge one.
 *
 * Verification here is read-only. Spending the approval is
 * `consumeToolCallApproval`, called once at execution, so a request that is
 * admitted but never reaches execution does not burn the approval.
 */

import {
  type ApprovalRefusalCode,
  verifyToolCallApproval,
} from "@/lib/policy/approval-enforcement";

/** A claim the request body makes about one tool call. */
export interface AssertedApproval {
  toolCallId: string;
  /** Derived from the `tool-<name>` part type, when it has one. */
  toolName: string | null;
  approved: boolean;
}

export interface AssertionRefusal {
  toolCallId: string;
  toolName: string | null;
  code: ApprovalRefusalCode;
  message: string;
}

const TOOL_PART_PREFIX = "tool-";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readToolName(type: unknown): string | null {
  if (typeof type !== "string" || !type.startsWith(TOOL_PART_PREFIX)) {
    return null;
  }
  const name = type.slice(TOOL_PART_PREFIX.length);
  return name.length > 0 ? name : null;
}

function readAssertion(part: unknown): AssertedApproval | null {
  if (!isRecord(part)) {
    return null;
  }

  const toolCallId = part.toolCallId;
  if (typeof toolCallId !== "string" || toolCallId.length === 0) {
    return null;
  }

  const approval = part.approval;
  if (!isRecord(approval) || typeof approval.approved !== "boolean") {
    return null;
  }

  return {
    toolCallId,
    toolName: readToolName(part.type),
    approved: approval.approved,
  };
}

/**
 * Every approval claim in a request body, deduplicated by tool call.
 *
 * Deliberately tolerant of shape: the input is untrusted, so malformed parts
 * are skipped rather than raising. A body that cannot be understood asserts
 * nothing, which is the safe reading.
 */
export function extractApprovalAssertions(
  messages: unknown,
): AssertedApproval[] {
  if (!Array.isArray(messages)) {
    return [];
  }

  const byToolCall = new Map<string, AssertedApproval>();

  for (const message of messages) {
    if (!isRecord(message) || !Array.isArray(message.parts)) {
      continue;
    }

    for (const part of message.parts) {
      const assertion = readAssertion(part);
      if (!assertion) {
        continue;
      }
      // A denial recorded later must not be overwritten by an earlier grant.
      const existing = byToolCall.get(assertion.toolCallId);
      if (!existing || existing.approved) {
        byToolCall.set(assertion.toolCallId, assertion);
      }
    }
  }

  return [...byToolCall.values()];
}

export interface VerifyAssertedApprovalsInput {
  sessionId: string;
  /** The untrusted `messages` array from the request body. */
  messages: unknown;
  now?: Date;
}

/**
 * Check every claimed approval against the server-side record.
 *
 * Returns the claims that are not backed. An empty array means every positive
 * claim in the body is genuine.
 */
export async function verifyAssertedApprovals(
  input: VerifyAssertedApprovalsInput,
): Promise<AssertionRefusal[]> {
  const claimed = extractApprovalAssertions(input.messages).filter(
    (assertion) => assertion.approved,
  );

  const refusals: AssertionRefusal[] = [];

  for (const assertion of claimed) {
    const verification = await verifyToolCallApproval({
      sessionId: input.sessionId,
      toolCallId: assertion.toolCallId,
      now: input.now,
    });

    if (!verification.authorized) {
      refusals.push({
        toolCallId: assertion.toolCallId,
        toolName: assertion.toolName,
        code: verification.code,
        message: verification.message,
      });
    }
  }

  return refusals;
}
