import { z } from "zod";
import { redactPolicyInput } from "./redact";
import type { CommandPolicy, PolicyDecision } from "./types";
import {
  policyActionSchema,
  policyOutcomeSchema,
  postureSchema,
} from "./types";

/**
 * The policy as it travels on the agent's execution context.
 *
 * This is the seam between the agent package (which evaluates policy) and its
 * host (which owns sessions, postures, and storage). The agent package never
 * reads a database: the host assembles this object and puts it on
 * `experimental_context`, and the agent evaluates against it.
 */

/** Where in a tool's lifecycle a decision was taken. */
export const policyEventPhaseSchema = z.enum(["approval", "execute"]);
export type PolicyEventPhase = z.infer<typeof policyEventPhaseSchema>;

/**
 * One append-only audit record. Everything derived from model-supplied text is
 * redacted before it gets here — see `redact.ts`.
 */
export const policyEventSchema = z.object({
  toolName: z.string().min(1),
  phase: policyEventPhaseSchema,
  /** The action after posture was applied. Only `ask` and `deny` are recorded. */
  action: policyActionSchema,
  /** What matching produced, before posture. */
  outcome: policyOutcomeSchema,
  ruleId: z.string().nullable(),
  reason: z.string().min(1),
  posture: postureSchema,
  /** False inside a subagent, where an `ask` cannot be answered. */
  interactive: z.boolean(),
  /** Redacted, length-bounded summary of the tool input. */
  inputSummary: z.string(),
  /** Redacted text the matching rule matched, when there was one. */
  matchedText: z.string().nullable(),
  occurredAt: z.date(),
});
export type PolicyEvent = z.infer<typeof policyEventSchema>;

/**
 * Where policy events go.
 *
 * The agent package ships a no-op. The host injects a writer that inserts into
 * its own append-only store, closing over the session and run it knows about —
 * which is why no identifier for either appears on the event itself.
 *
 * Implementations must be insert-only and must not throw: a failure to record
 * must never change what a tool does.
 */
export interface PolicyEventRecorder {
  record(event: PolicyEvent): void | Promise<void>;
}

/** The default recorder: policy is still enforced, nothing is written down. */
export const noopPolicyEventRecorder: PolicyEventRecorder = {
  record: () => {
    // Intentionally empty: the host injects a real recorder.
  },
};

export interface AgentPolicyContext {
  policy: CommandPolicy;
  posture: z.infer<typeof postureSchema>;
  /**
   * Whether an `ask` decision can actually be answered by a human. Subagents
   * set this to `false`: they have no UI channel, so an `ask` there resolves to
   * a denial instead of a pause that nobody would ever see. Defaults to `true`.
   */
  interactive?: boolean;
  recorder?: PolicyEventRecorder;
}

function isCommandPolicy(value: unknown): value is CommandPolicy {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as {
    deny?: unknown;
    ask?: unknown;
    allow?: unknown;
    defaultAction?: unknown;
  };
  return (
    Array.isArray(candidate.deny) &&
    Array.isArray(candidate.ask) &&
    Array.isArray(candidate.allow) &&
    policyActionSchema.options.includes(
      candidate.defaultAction as CommandPolicy["defaultAction"],
    )
  );
}

/**
 * Structural, not a full schema parse: this runs on every policed tool call,
 * and `commandPolicySchema` exists for the boundaries where a policy is
 * actually constructed.
 */
export function isAgentPolicyContext(
  value: unknown,
): value is AgentPolicyContext {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as { policy?: unknown; posture?: unknown };
  return (
    typeof candidate.posture === "string" &&
    postureSchema.options.includes(
      candidate.posture as AgentPolicyContext["posture"],
    ) &&
    isCommandPolicy(candidate.policy)
  );
}

/** An absent flag means interactive — only subagents opt out. */
export function isInteractivePolicyContext(
  context: AgentPolicyContext,
): boolean {
  return context.interactive !== false;
}

export function buildPolicyEvent(params: {
  toolName: string;
  phase: PolicyEventPhase;
  decision: PolicyDecision;
  input: string;
  interactive: boolean;
}): PolicyEvent {
  return {
    toolName: params.toolName,
    phase: params.phase,
    action: params.decision.action,
    outcome: params.decision.outcome,
    ruleId: params.decision.rule?.id ?? null,
    reason: params.decision.reason,
    posture: params.decision.posture,
    interactive: params.interactive,
    inputSummary: redactPolicyInput(params.input),
    matchedText: params.decision.matchedText
      ? redactPolicyInput(params.decision.matchedText)
      : null,
    occurredAt: new Date(),
  };
}

/**
 * Hand an event to the context's recorder without letting it affect the call.
 *
 * Fire-and-forget on purpose: recording happens only on `ask` and `deny`, never
 * on the allow path, and a recorder that is slow or broken must not delay or
 * fail a tool call.
 */
export function recordPolicyEvent(
  context: AgentPolicyContext,
  event: PolicyEvent,
): void {
  const recorder = context.recorder;
  if (!recorder) {
    return;
  }

  try {
    const result = recorder.record(event);
    if (result && typeof result.then === "function") {
      Promise.resolve(result).catch(() => {
        // Recording is best-effort; enforcement already happened.
      });
    }
  } catch {
    // Recording is best-effort; enforcement already happened.
  }
}
