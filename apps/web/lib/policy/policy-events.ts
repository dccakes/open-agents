/**
 * Recording what the policy decided.
 *
 * `policy_event` is append-only: this module only ever calls `insert`, and
 * nothing anywhere else in the app writes to the table at all. That is the
 * whole value of it — a record of a denial that can be edited afterwards is not
 * a record of anything.
 *
 * Writes are best-effort. A policy event describes a decision that has already
 * been made and enforced elsewhere (the `deny` was already refused, the `ask`
 * is already backed by an `approval` row), so failing the decision because its
 * log write failed would turn an observability outage into an availability one.
 * The failure is logged loudly instead.
 */

import { nanoid } from "nanoid";
import { db } from "@/lib/db/client";
import { type NewPolicyEvent, policyEvents } from "@/lib/db/schema";
import type { Posture } from "@/lib/policy/posture";
import { redactInputSummary } from "@/lib/policy/redaction";

/**
 * What the event records.
 *
 * `expired` is the sweeper materializing an approval timeout; `downgraded` is
 * posture resolution refusing `dangerous` for a non-interactive trigger.
 */
export type PolicyEventDecision =
  | "allow"
  | "ask"
  | "deny"
  | "expired"
  | "downgraded";

export interface PolicyEventInput {
  sessionId: string;
  workflowRunId?: string | null;
  toolName?: string | null;
  /** Redacted here, so no caller can forget to. */
  input: unknown;
  decision: PolicyEventDecision;
  /** The id of the rule that matched, or null for a policy default. */
  matchedRule?: string | null;
  posture: Posture;
}

function toRow(input: PolicyEventInput): NewPolicyEvent {
  return {
    id: nanoid(),
    sessionId: input.sessionId,
    workflowRunId: input.workflowRunId ?? null,
    toolName: input.toolName ?? null,
    inputSummary: redactInputSummary(input.input),
    decision: input.decision,
    matchedRule: input.matchedRule ?? null,
    posture: input.posture,
  };
}

function logFailure(count: number, error: unknown): void {
  const detail = error instanceof Error ? error.message : String(error);
  console.error(
    `[policy] Failed to record ${count} policy event(s): ${detail}`,
  );
}

/** Record one decision. Never throws. */
export async function recordPolicyEvent(
  input: PolicyEventInput,
): Promise<void> {
  try {
    await db.insert(policyEvents).values(toRow(input));
  } catch (error) {
    logFailure(1, error);
  }
}

/** Record a batch in a single insert. Never throws. */
export async function recordPolicyEvents(
  inputs: PolicyEventInput[],
): Promise<void> {
  if (inputs.length === 0) {
    return;
  }

  try {
    await db.insert(policyEvents).values(inputs.map(toRow));
  } catch (error) {
    logFailure(inputs.length, error);
  }
}
