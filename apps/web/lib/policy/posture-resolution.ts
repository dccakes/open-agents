/**
 * Turning a *stored* posture into the posture a run actually executes under.
 *
 * The rule that matters here: `dangerous` collapses every `ask` into `allow`,
 * so it is only ever safe when there is a human who *could* have been asked. A
 * run with no interactive approver — a webhook, a schedule, anything the
 * platform starts on its own — may never resolve to `dangerous`, whatever the
 * session or a mapping has stored.
 *
 * That refusal lives here, in the resolution helper, rather than in any one
 * trigger's handler. A trigger added later inherits it by construction instead
 * of by somebody remembering to copy the check.
 *
 * Pure by design: recording the downgrade is the caller's job (see
 * `session-policy.ts`), so this stays testable without a database.
 */

import { z } from "zod";
import { DEFAULT_POSTURE, isPosture, type Posture } from "@/lib/policy/posture";

/** How a run was started. */
export const runTriggerSchema = z.enum([
  /** A person is present in the chat and can answer an approval. */
  "interactive",
  /** An inbound webhook (Linear, GitHub). Nobody is waiting. */
  "webhook",
  /** A scheduled or cron-initiated run. */
  "schedule",
  /** The platform starting work on its own behalf. */
  "system",
]);
export type RunTrigger = z.infer<typeof runTriggerSchema>;

export const NON_INTERACTIVE_DANGEROUS_REASON =
  "The dangerous posture turns every approval into an automatic allow, so it requires a person who could have been asked. This run has no interactive approver, so it runs under auto.";

const INVALID_STORED_POSTURE_REASON =
  "The stored posture is not one of strict, auto, or dangerous, so the run falls back to auto.";

/** Whether this trigger has a human who could answer an approval. */
export function isInteractiveTrigger(trigger: RunTrigger): boolean {
  return trigger === "interactive";
}

export interface PostureResolutionInput {
  /** Whatever is stored for the session. Unvalidated on purpose. */
  stored: string | null | undefined;
  trigger: RunTrigger;
}

export interface PostureResolution {
  /** The posture the run executes under. */
  posture: Posture;
  /** What was asked for, before any downgrade. */
  requested: Posture | null;
  /** True when the effective posture is stricter than the stored one. */
  downgraded: boolean;
  /** Why, when it was downgraded. */
  reason?: string;
}

export function resolvePosture(
  input: PostureResolutionInput,
): PostureResolution {
  const { stored, trigger } = input;

  if (!isPosture(stored)) {
    return {
      posture: DEFAULT_POSTURE,
      requested: null,
      downgraded: true,
      reason: INVALID_STORED_POSTURE_REASON,
    };
  }

  if (stored === "dangerous" && !isInteractiveTrigger(trigger)) {
    return {
      posture: DEFAULT_POSTURE,
      requested: stored,
      downgraded: true,
      reason: NON_INTERACTIVE_DANGEROUS_REASON,
    };
  }

  return { posture: stored, requested: stored, downgraded: false };
}
