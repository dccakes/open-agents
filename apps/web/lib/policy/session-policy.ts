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
 * - `default` — the shipped baseline.
 * - `strict` — the baseline with `defaultAction: "ask"` and the write-class and
 *   network-class families named, which is what gives the `strict` posture
 *   teeth. A posture alone could not: the baseline allows by default, so
 *   "every `ask` pauses" is something `auto` already does.
 * - `read-only` — the profile the explorer subagent runs under, in which every
 *   write-class and network-class decision becomes a denial.
 *
 * The names are what cross the workflow step boundary; the `CommandPolicy`
 * objects behind them are resolved in `app/workflows/chat-run-policy.ts`.
 */
export type PolicyProfileName = "default" | "read-only" | "strict";

/**
 * The profile a posture runs under when the caller did not name one.
 *
 * Applied to the *resolved* posture, so a `dangerous` request downgraded to
 * `auto` for a non-interactive trigger does not pick up a strict profile it
 * never asked for, and — more to the point — a `strict` session that a future
 * trigger cannot downgrade keeps its teeth.
 */
function profileForPosture(posture: Posture): PolicyProfileName {
  return posture === "strict" ? "strict" : "default";
}

export interface ResolveSessionPolicyInput {
  sessionId: string;
  /** Defaults to `interactive`, which is what a chat request is. */
  trigger?: RunTrigger;
  /**
   * Overrides the profile the posture would select. A caller asking for a
   * narrower profile (`read-only`) must win over the posture's.
   */
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
    profile: input.profile ?? profileForPosture(resolution.posture),
  };
}
