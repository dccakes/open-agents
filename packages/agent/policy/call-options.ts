import { z } from "zod";
import type { ApprovalGate } from "./approval-gate";
import { defaultCommandPolicy } from "./default-policy";
import type {
  AgentPolicyContext,
  PolicyEventRecorder,
} from "./execution-context";
import { noopPolicyEventRecorder } from "./execution-context";
import type { CommandPolicy } from "./types";
import { postureSchema } from "./types";

/**
 * The policy fields an agent accepts in its call options.
 *
 * Shared so that every agent takes the same three inputs and assembles them the
 * same way — the host supplies the session's policy, posture, and event
 * recorder, and the agent turns them into the context its tools read.
 */
export const policyCallOptionsSchema = z.object({
  policy: z.custom<CommandPolicy>().optional(),
  posture: postureSchema.optional(),
  policyEventRecorder: z.custom<PolicyEventRecorder>().optional(),
  approvalGate: z.custom<ApprovalGate>().optional(),
});
export type PolicyCallOptions = z.infer<typeof policyCallOptionsSchema>;

/**
 * Assemble the policy context an agent puts on `experimental_context`.
 *
 * The fallback is the shipped baseline under `auto`, which is exactly today's
 * behaviour: a host that has not yet assembled a session policy keeps working
 * and keeps being policed. Fail-closed applies to the *execution context* —
 * a tool that finds no policy there refuses — and this is the one place that
 * guarantees an agent always puts one there.
 */
export function resolvePolicyContext(
  options: PolicyCallOptions,
  overrides?: { interactive?: boolean },
): AgentPolicyContext {
  return {
    policy: options.policy ?? defaultCommandPolicy,
    posture: options.posture ?? "auto",
    interactive: overrides?.interactive ?? true,
    recorder: options.policyEventRecorder ?? noopPolicyEventRecorder,
    // Absent by default: without a host-supplied gate the SDK's own approval
    // pause stays the only gate, which is the pre-record behaviour.
    approvalGate: options.approvalGate,
  };
}
