import { evaluate } from "./command-policy";
import { LEGACY_APPROVAL_RULES } from "./default-policy";
import type { CommandPolicy } from "./types";

/**
 * A policy containing only the rules absorbed from the pre-policy bash
 * denylist. It exists so `commandNeedsApproval` can keep its exact historical
 * answer while being implemented on top of the policy engine rather than a
 * second, independently drifting copy of the regexes.
 *
 * This is a compatibility shim, not the shipped baseline — use
 * `defaultCommandPolicy` for anything new.
 */
export const legacyApprovalPolicy: CommandPolicy = {
  id: "legacy-approval",
  description:
    "Compatibility policy reproducing the bash denylist that predates the policy module.",
  deny: [],
  ask: LEGACY_APPROVAL_RULES,
  allow: [],
  defaultAction: "allow",
  defaultReason: "No legacy approval pattern matched this command.",
};

/**
 * Whether a bash command required approval under the pre-policy denylist.
 *
 * Kept exported from `packages/agent/tools/index.ts` so existing importers do
 * not break. New code should call `evaluate()` with a real policy and posture:
 * this function cannot express `deny`, has no posture, and knows nothing about
 * the baseline's ask rules for pushes, publishes, and installs.
 */
export function commandNeedsApproval(command: string): boolean {
  return (
    evaluate({ toolName: "bash", command }, legacyApprovalPolicy, "auto")
      .action !== "allow"
  );
}
