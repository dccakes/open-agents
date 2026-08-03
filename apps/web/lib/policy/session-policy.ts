/**
 * Assembling the policy a run executes under: which posture, which profile.
 *
 * This is the one place a run asks "what am I allowed to do?", so the
 * non-interactive `dangerous` refusal and the downgrade record both happen here
 * exactly once, whatever started the run.
 *
 * SEAM — the profile is *named* rather than materialized. The `CommandPolicy`
 * objects themselves are `defaultCommandPolicy` and `readOnlyPolicy`, exported
 * from `@open-agents/agent`, and this module deliberately does not import them:
 * that package root pulls the AI SDK runtime in with it, and this module is
 * reachable from workflow code, where such an import is known to break (see the
 * warning in `app/api/chat/_lib/persist-tool-results.ts`). The caller that
 * assembles the agent's call options resolves the name to the policy object.
 */

import { getSessionById } from "@/lib/db/sessions";
import { ApprovalError } from "@/lib/policy/approval-errors";
import type { Posture } from "@/lib/policy/posture";
import {
  type PostureResolution,
  resolvePosture,
  type RunTrigger,
} from "@/lib/policy/posture-resolution";
import { recordPolicyEvent } from "@/lib/policy/policy-events";

/**
 * Which rule set applies.
 *
 * `read-only` is the profile the explorer subagent runs under, in which every
 * write-class and network-class decision becomes a denial.
 */
export type PolicyProfileName = "default" | "read-only";

export interface ResolveSessionPolicyInput {
  sessionId: string;
  /** Defaults to `interactive`, which is what a chat request is. */
  trigger?: RunTrigger;
  /** Defaults to the shipped baseline. */
  profile?: PolicyProfileName;
  /** Recorded on the downgrade event when there is one. */
  workflowRunId?: string | null;
}

export interface SessionPolicyResolution {
  sessionId: string;
  /** The posture the run executes under. */
  posture: Posture;
  /** What the session stored, before any downgrade. */
  requestedPosture: Posture | null;
  postureDowngraded: boolean;
  downgradeReason?: string;
  profile: PolicyProfileName;
}

async function recordDowngrade(
  input: ResolveSessionPolicyInput,
  resolution: PostureResolution,
): Promise<void> {
  await recordPolicyEvent({
    sessionId: input.sessionId,
    workflowRunId: input.workflowRunId ?? null,
    toolName: null,
    input: {
      requestedPosture: resolution.requested,
      effectivePosture: resolution.posture,
      trigger: input.trigger ?? "interactive",
      reason: resolution.reason,
    },
    decision: "downgraded",
    matchedRule: "posture.non-interactive-downgrade",
    // The posture the run actually gets, so the record says what was enforced.
    posture: resolution.posture,
  });
}

/**
 * The posture and profile this run executes under.
 *
 * @throws ApprovalError (`not-found`) when the session does not exist — a
 * missing session must not silently resolve to a default posture.
 */
export async function resolveSessionPolicy(
  input: ResolveSessionPolicyInput,
): Promise<SessionPolicyResolution> {
  const session = await getSessionById(input.sessionId);
  if (!session) {
    throw new ApprovalError(
      "not-found",
      `No session ${input.sessionId} exists, so no policy could be resolved for it.`,
    );
  }

  const resolution = resolvePosture({
    stored: session.posture,
    trigger: input.trigger ?? "interactive",
  });

  if (resolution.downgraded) {
    await recordDowngrade(input, resolution);
  }

  return {
    sessionId: input.sessionId,
    posture: resolution.posture,
    requestedPosture: resolution.requested,
    postureDowngraded: resolution.downgraded,
    downgradeReason: resolution.reason,
    profile: input.profile ?? "default",
  };
}
