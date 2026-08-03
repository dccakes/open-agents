import { z } from "zod";
import {
  type AgentPolicyContext,
  buildPolicyEvent,
  evaluate,
  isInteractivePolicyContext,
  type PolicyDecision,
  type PolicyToolCall,
  postureSchema,
  recordPolicyEvent,
} from "../policy";
import { getPolicy } from "./utils";

/**
 * The enforcement point.
 *
 * Policy lives here — in the tool layer — rather than in a wrapper around any
 * one agent's dispatch, because three of the four `ToolLoopAgent`s in this
 * package build their own tools. A tool that calls these helpers is policed no
 * matter who constructed it.
 *
 * Two hooks, two jobs:
 * - `policyNeedsApproval` feeds the SDK's `needsApproval`, which can pause but
 *   cannot refuse.
 * - `enforcePolicy` runs inside `execute` and is authoritative: it re-evaluates
 *   the policy for the call it is about to perform and refuses a `deny`
 *   regardless of whether an approval pause happened. An approval is never a
 *   substitute for evaluation.
 */

/** Why a call was refused. */
export const policyRefusalKindSchema = z.enum([
  "deny",
  "approval-unavailable",
  "missing-policy",
]);
export type PolicyRefusalKind = z.infer<typeof policyRefusalKindSchema>;

export const policyRefusalDetailSchema = z.object({
  tool: z.string(),
  decision: policyRefusalKindSchema,
  /** Id of the matching rule, or null for a policy default. */
  rule: z.string().nullable(),
  reason: z.string(),
  posture: postureSchema.nullable(),
});

export const policyRefusalSchema = z.object({
  success: z.literal(false),
  /** Discriminator so callers and UIs can tell policy apart from tool failure. */
  refusedByPolicy: z.literal(true),
  error: z.string(),
  policy: policyRefusalDetailSchema,
});
export type PolicyRefusal = z.infer<typeof policyRefusalSchema>;

export function isPolicyRefusal(value: unknown): value is PolicyRefusal {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { refusedByPolicy?: unknown }).refusedByPolicy === true
  );
}

/** The text a rule is matched against, for the audit record. */
function describeCall(call: PolicyToolCall): string {
  return call.command ?? call.target ?? "";
}

export function missingPolicyRefusal(toolName: string): PolicyRefusal {
  const reason =
    "No security policy is present on the agent execution context, so this call cannot be checked. This is a wiring error, not something to work around.";
  return {
    success: false,
    refusedByPolicy: true,
    error: `The ${toolName} tool refused this call: ${reason}`,
    policy: {
      tool: toolName,
      decision: "missing-policy",
      rule: null,
      reason,
      posture: null,
    },
  };
}

function refusal(
  call: PolicyToolCall,
  decision: PolicyDecision,
  kind: PolicyRefusalKind,
): PolicyRefusal {
  const preamble =
    kind === "approval-unavailable"
      ? `The ${call.toolName} tool refused this call: it requires approval, and this agent has no approver available (subagents cannot prompt anyone). Report back so the parent agent can request approval.`
      : `The ${call.toolName} tool refused this call: it is denied by security policy.`;

  return {
    success: false,
    refusedByPolicy: true,
    error: `${preamble} Reason: ${decision.reason}`,
    policy: {
      tool: call.toolName,
      decision: kind,
      rule: decision.rule?.id ?? null,
      reason: decision.reason,
      posture: decision.posture,
    },
  };
}

function record(
  context: AgentPolicyContext,
  call: PolicyToolCall,
  decision: PolicyDecision,
  phase: "approval" | "execute",
): void {
  recordPolicyEvent(
    context,
    buildPolicyEvent({
      toolName: call.toolName,
      phase,
      decision,
      input: describeCall(call),
      interactive: isInteractivePolicyContext(context),
    }),
  );
}

/**
 * Refuse a call against a rule the tool enforces itself, in the same shape and
 * with the same audit trail as a policy denial.
 *
 * For containment rules that are not expressible as a command pattern — the
 * bash `cwd` argument is the one that exists today.
 */
export function refuseWithRule(
  experimental_context: unknown,
  call: PolicyToolCall,
  rule: { id: string; reason: string },
): PolicyRefusal {
  const context = getPolicy(experimental_context);
  const decision: PolicyDecision = {
    action: "deny",
    outcome: "deny",
    rule: {
      id: rule.id,
      action: "deny",
      tool: call.toolName,
      capability: "other",
      reason: rule.reason,
    },
    reason: rule.reason,
    posture: context?.posture ?? "auto",
    matchedText: describeCall(call) || null,
  };

  if (context) {
    record(context, call, decision, "execute");
  }

  return refusal(call, decision, "deny");
}

/**
 * Whether the SDK should pause this call for approval.
 *
 * Returns `null` when no policy is wired, so each tool can decide what its
 * unpoliced fallback is — `execute` refuses either way.
 */
export function policyNeedsApproval(
  experimental_context: unknown,
  call: PolicyToolCall,
): boolean | null {
  const context = getPolicy(experimental_context);
  if (!context) {
    return null;
  }

  const decision = evaluate(call, context.policy, context.posture);
  if (decision.action !== "ask") {
    return false;
  }

  // A non-interactive context has no one to ask: do not pause (that would hang
  // the parent tool call), and let `execute` turn the ask into a refusal.
  if (!isInteractivePolicyContext(context)) {
    return false;
  }

  record(context, call, decision, "approval");
  return true;
}

/**
 * Authoritative gate, called from `execute` before any side effect.
 *
 * Returns a structured refusal to hand back to the model, or `null` when the
 * call may proceed. It never throws: a denial is a tool result the model can
 * read and route around, not an exception that fails the run.
 */
export function enforcePolicy(
  experimental_context: unknown,
  call: PolicyToolCall,
): PolicyRefusal | null {
  const context = getPolicy(experimental_context);
  if (!context) {
    return missingPolicyRefusal(call.toolName);
  }

  const decision = evaluate(call, context.policy, context.posture);

  if (decision.action === "deny") {
    record(context, call, decision, "execute");
    return refusal(call, decision, "deny");
  }

  if (decision.action === "ask" && !isInteractivePolicyContext(context)) {
    record(context, call, decision, "execute");
    return refusal(call, decision, "approval-unavailable");
  }

  return null;
}
