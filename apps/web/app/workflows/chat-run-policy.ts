/**
 * The run's security policy, assembled in two halves either side of the
 * workflow boundary.
 *
 * Why two halves. A workflow step's arguments and return value cross a
 * serialization boundary, and a `CommandPolicy` cannot: its rules carry
 * `RegExp` objects. Worse, `@open-agents/agent`'s package root pulls the AI SDK
 * runtime — and its transitive CJS dependencies — with it, and importing that
 * from workflow code breaks the workflow VM, where `require` does not exist
 * (see the warning in `app/api/chat/_lib/persist-tool-results.ts`). Group 3
 * dealt with this by having `session-policy.ts` return a profile *name*.
 *
 * So:
 * - {@link resolveRunPolicy} runs as a step. It reads the session, resolves the
 *   posture, and returns two strings — the posture and the profile name — which
 *   serialize fine and carry no imports with them.
 * - {@link buildRunPolicyOptions} runs *inside* the agent step, where a dynamic
 *   `import()` of the agent package is already how the rest of this workflow
 *   reaches it. It turns those two strings into the policy object, the event
 *   recorder, and the approval gate, none of which ever cross a step boundary.
 *
 * Every value import in this module is dynamic, and that is load-bearing rather
 * than stylistic. What decides where an import lands is *where its value is
 * referenced*: a reference from inside a `"use step"` body is extracted into the
 * step bundle, where Node modules are fine, while a reference from a plain
 * function in a workflow module stays in the workflow bundle, where they are
 * not. `buildRunPolicyOptions` is a plain function — its only caller is a step,
 * but that does not move it — so a static import of `policy-event-recorder` or
 * `approval-gate` reaches `lib/db/client` and fails the build with "postgres
 * depends on Node.js modules". That is how this was found: at deploy, not in CI,
 * because `bun run ci` does not run `next build`. `resolveRunPolicy` is a step
 * and could import statically; it uses a dynamic import anyway so the rule for
 * this file is uniform and there is nothing to get wrong when editing it.
 * `workflow-import-boundary.test.ts` now covers all three paths.
 */

import type { CommandPolicy, OpenAgentCallOptions } from "@open-agents/agent";
import type { Posture } from "@/lib/policy/posture";
import type { PolicyProfileName } from "@/lib/policy/session-policy";

/** Everything about the run's policy that survives a step boundary. */
export interface RunPolicySelection {
  posture: Posture;
  profile: PolicyProfileName;
}

/** The policy fields of the agent's call options. */
export type RunPolicyOptions = Pick<
  OpenAgentCallOptions,
  "policy" | "posture" | "policyEventRecorder" | "approvalGate"
>;

/** The posture the shipped default corresponds to, used when nothing is known. */
const FALLBACK_SELECTION: RunPolicySelection = {
  posture: "auto",
  profile: "default",
};

/**
 * The posture and profile this run executes under.
 *
 * A failure here resolves to the baseline under `auto` rather than aborting the
 * run: that is the behaviour the product had before postures existed, and it is
 * still policed. It is the *tool* layer that fails closed, and it does so on an
 * absent policy, which this function never produces.
 */
export async function resolveRunPolicy(params: {
  sessionId: string;
  workflowRunId: string;
}): Promise<RunPolicySelection> {
  "use step";

  try {
    const { resolveSessionPolicy } =
      await import("@/lib/policy/session-policy");
    const resolution = await resolveSessionPolicy({
      sessionId: params.sessionId,
      trigger: "interactive",
      workflowRunId: params.workflowRunId,
    });

    return { posture: resolution.posture, profile: resolution.profile };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(
      `[policy] Falling back to the baseline policy for session ${params.sessionId}:`,
      detail,
    );
    return FALLBACK_SELECTION;
  }
}

/**
 * Materialize the selection into the agent's policy call options.
 *
 * Must be called from inside a step — it dynamically imports the agent package.
 */
export async function buildRunPolicyOptions(params: {
  selection: RunPolicySelection;
  sessionId: string;
  chatId: string;
  workflowRunId: string;
}): Promise<RunPolicyOptions> {
  const [
    { defaultCommandPolicy, readOnlyPolicy, strictPolicy },
    { createPolicyEventRecorder },
    { createApprovalGate },
  ] = await Promise.all([
    import("@open-agents/agent"),
    import("@/lib/policy/policy-event-recorder"),
    import("@/lib/policy/approval-gate"),
  ]);

  const policies: Record<RunPolicySelection["profile"], CommandPolicy> = {
    default: defaultCommandPolicy,
    "read-only": readOnlyPolicy,
    strict: strictPolicy,
  };

  return {
    policy: policies[params.selection.profile] ?? defaultCommandPolicy,
    posture: params.selection.posture,
    policyEventRecorder: createPolicyEventRecorder({
      sessionId: params.sessionId,
      workflowRunId: params.workflowRunId,
    }),
    approvalGate: createApprovalGate({
      sessionId: params.sessionId,
      chatId: params.chatId,
      workflowRunId: params.workflowRunId,
    }),
  };
}
