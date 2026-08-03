/**
 * The writer the agent package expects a host to inject.
 *
 * `packages/agent/policy/execution-context.ts` defines a `PolicyEventRecorder`
 * and ships a no-op, because the agent package never touches a database. This
 * is the real one: it closes over the session and run — which is why no
 * identifier for either appears on the agent's event — and inserts into
 * `policy_event`.
 *
 * The import from `@open-agents/agent` is deliberately type-only. That package
 * root pulls the AI SDK runtime in with it, and this module is reachable from
 * workflow code where such an import is known to break; a type import is erased
 * at build time and costs nothing.
 */

import type { PolicyEvent, PolicyEventRecorder } from "@open-agents/agent";
import {
  type PolicyEventDecision,
  recordPolicyEvent,
} from "@/lib/policy/policy-events";

export interface PolicyEventRecorderScope {
  sessionId: string;
  /** Absent when the decision was not taken inside a workflow run. */
  workflowRunId?: string | null;
}

/**
 * The agent's summary fields, kept together so the stored row explains *why*
 * the decision came out the way it did and not only what it was.
 */
function toInputSummary(event: PolicyEvent): Record<string, unknown> {
  return {
    summary: event.inputSummary,
    matchedText: event.matchedText,
    reason: event.reason,
    outcome: event.outcome,
    phase: event.phase,
    interactive: event.interactive,
    occurredAt: event.occurredAt.toISOString(),
  };
}

/** A recorder scoped to one session and, when there is one, one run. */
export function createPolicyEventRecorder(
  scope: PolicyEventRecorderScope,
): PolicyEventRecorder {
  return {
    async record(event: PolicyEvent): Promise<void> {
      try {
        await recordPolicyEvent({
          sessionId: scope.sessionId,
          workflowRunId: scope.workflowRunId ?? null,
          toolName: event.toolName,
          input: toInputSummary(event),
          decision: event.action as PolicyEventDecision,
          matchedRule: event.ruleId,
          posture: event.posture,
        });
      } catch (error) {
        // `recordPolicyEvent` already swallows its own failures; this is the
        // belt to its braces, because the agent package's contract is that a
        // recorder never throws.
        const detail = error instanceof Error ? error.message : String(error);
        console.error(
          `[policy] Recorder failed for ${event.toolName}:`,
          detail,
        );
      }
    },
  };
}
