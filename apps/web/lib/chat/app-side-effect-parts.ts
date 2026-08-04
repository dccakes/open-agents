/**
 * Writing the outcome of a gated side effect back onto the run's message.
 *
 * The workflow ends when it pauses for an application-level approval — it does
 * not park — so the answer arrives long after the stream closed. The only place
 * left to report it is the persisted assistant message, which is also the only
 * report that survives a reload. This module produces the updated message; the
 * caller persists it.
 *
 * Pure: no database, no clock, no network.
 */

import type {
  WebAgentApprovalStatus,
  WebAgentCommitData,
  WebAgentPrData,
  WebAgentUIMessage,
  WebAgentUIMessagePart,
} from "@/app/types";

/** The part ids the workflow uses, so an update lands on the same part. */
export function approvalPartId(messageId: string): string {
  return `${messageId}:approval`;
}

export function commitPartId(messageId: string): string {
  return `${messageId}:commit`;
}

export function prPartId(messageId: string): string {
  return `${messageId}:pr`;
}

export interface AppSideEffectOutcome {
  /** Which approval this outcome answers. */
  approvalId: string;
  status: WebAgentApprovalStatus;
  /** One line saying what happened, including a policy refusal. */
  detail?: string;
  commit?: WebAgentCommitData;
  pr?: WebAgentPrData;
}

function upsertPart(
  parts: WebAgentUIMessagePart[],
  part: WebAgentUIMessagePart,
): WebAgentUIMessagePart[] {
  const id = "id" in part ? part.id : undefined;
  const index = parts.findIndex(
    (candidate) =>
      candidate.type === part.type &&
      ("id" in candidate ? candidate.id : undefined) === id,
  );

  if (index < 0) {
    return [...parts, part];
  }

  const next = [...parts];
  next[index] = part;
  return next;
}

/**
 * The message as it reads once the approval has been answered.
 *
 * The approval part is matched on the approval id rather than the part id: a
 * message could in principle carry more than one, and answering one must not
 * silently resolve another.
 */
export function applyAppSideEffectOutcome(
  message: WebAgentUIMessage,
  outcome: AppSideEffectOutcome,
): WebAgentUIMessage {
  let parts: WebAgentUIMessagePart[] = message.parts.map((part) => {
    if (
      part.type !== "data-approval-request" ||
      part.data.approvalId !== outcome.approvalId
    ) {
      return part;
    }

    return {
      ...part,
      data: {
        ...part.data,
        status: outcome.status,
        ...(outcome.detail === undefined ? {} : { detail: outcome.detail }),
      },
    };
  });

  if (outcome.commit) {
    parts = upsertPart(parts, {
      type: "data-commit",
      id: commitPartId(message.id),
      data: outcome.commit,
    });
  }

  if (outcome.pr) {
    parts = upsertPart(parts, {
      type: "data-pr",
      id: prPartId(message.id),
      data: outcome.pr,
    });
  }

  return { ...message, parts };
}
