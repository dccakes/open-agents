import { type AgentPolicyContext, createReadOnlyPolicy } from "../policy";

/**
 * Narrowing the session's policy context for a subagent.
 *
 * Two things are always true of a subagent, and both are decided here rather
 * than in each subagent file:
 *
 * - It is **non-interactive**. It runs inside `taskTool.execute`, whose stream
 *   handler forwards only `tool-call` and `finish-step` parts, so a pause would
 *   hang the parent tool call rather than prompt anyone. An `ask` decision
 *   therefore resolves to a structured denial, and the parent — which does have
 *   an approver — can attempt the operation itself.
 * - It can only be **narrowed**, never widened: the posture and the recorder
 *   come from the session, and a read-only subagent's profile is derived from
 *   the session's own policy, so it is at least as restrictive as the session.
 */
export function toSubagentPolicyContext(
  policy: AgentPolicyContext | undefined,
  options?: { readOnly?: boolean },
): AgentPolicyContext | undefined {
  if (!policy) {
    // Nothing to inherit: the subagent's side-effecting tools refuse rather
    // than run unpoliced.
    return undefined;
  }

  return {
    ...policy,
    policy: options?.readOnly
      ? createReadOnlyPolicy(policy.policy)
      : policy.policy,
    interactive: false,
  };
}
