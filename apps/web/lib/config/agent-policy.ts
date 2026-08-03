/**
 * Bounds on an agent run: how long an approval stays answerable, and how much
 * a single run may spend before it is halted.
 *
 * All three are `optional` on purpose. Every one has a working default, and a
 * deployment that sets none of them behaves exactly as it did before they
 * existed — which is what makes this group safe to add without a coordinated
 * environment change.
 *
 * The token budget is deliberately *unset* by default rather than guessed. A
 * ceiling that is too low turns a working product into a broken one, and there
 * is no data to pick one from until runs have been attributable for a while.
 */

import { defineEnvGroup } from "@/lib/config/env-group";
import { optionalPositiveInteger } from "@/lib/config/schemas";

/** Applied when `AGENT_APPROVAL_TIMEOUT_HOURS` is unset. */
export const DEFAULT_APPROVAL_TIMEOUT_HOURS = 24;

/**
 * Applied when `AGENT_RUN_STEP_BUDGET` is unset — the ceiling the chat route
 * hard-coded before it became configurable, so the default changes nothing.
 */
export const DEFAULT_RUN_STEP_BUDGET = 500;

const MILLISECONDS_PER_HOUR = 60 * 60 * 1000;

export const agentPolicyEnv = defineEnvGroup({
  name: "agent-policy",
  specs: {
    AGENT_APPROVAL_TIMEOUT_HOURS: {
      axis: "optional",
      description: `Hours a pending approval stays answerable before it is treated as denied (default ${DEFAULT_APPROVAL_TIMEOUT_HOURS}).`,
      example: String(DEFAULT_APPROVAL_TIMEOUT_HOURS),
      schema: optionalPositiveInteger,
    },
    AGENT_RUN_STEP_BUDGET: {
      axis: "optional",
      description: `Maximum agent steps a single run may take before it halts (default ${DEFAULT_RUN_STEP_BUDGET}).`,
      example: String(DEFAULT_RUN_STEP_BUDGET),
      schema: optionalPositiveInteger,
    },
    AGENT_RUN_TOKEN_BUDGET: {
      axis: "optional",
      description:
        "Maximum tokens a single run may consume before it halts. Unset means unlimited; the step budget still bounds the run.",
      example: "250000",
      schema: optionalPositiveInteger,
    },
  },
});

/**
 * A run's token ceiling as a consumer should see it: "unlimited" is a value,
 * not the absence of one, so nothing can mistake an unset ceiling for zero.
 */
export type RunTokenBudget =
  | { limit: "unlimited" }
  | { limit: "limited"; tokens: number };

export interface AgentPolicyConfig {
  /** Hours a pending approval stays answerable. */
  approvalTimeoutHours: number;
  /** Maximum agent steps in one run. */
  stepBudget: number;
  /** Maximum tokens in one run. */
  tokenBudget: RunTokenBudget;
}

export function getAgentPolicyConfig(): AgentPolicyConfig {
  const env = agentPolicyEnv.read();
  const tokens = env.AGENT_RUN_TOKEN_BUDGET;

  return {
    approvalTimeoutHours:
      env.AGENT_APPROVAL_TIMEOUT_HOURS ?? DEFAULT_APPROVAL_TIMEOUT_HOURS,
    stepBudget: env.AGENT_RUN_STEP_BUDGET ?? DEFAULT_RUN_STEP_BUDGET,
    tokenBudget:
      tokens === undefined
        ? { limit: "unlimited" }
        : { limit: "limited", tokens },
  };
}

/** The approval timeout in milliseconds, for computing an `expiresAt`. */
export function getApprovalTimeoutMs(): number {
  return getAgentPolicyConfig().approvalTimeoutHours * MILLISECONDS_PER_HOUR;
}

/** The per-run step ceiling. Consumed by the run-budget enforcement. */
export function getRunStepBudget(): number {
  return getAgentPolicyConfig().stepBudget;
}

/** The per-run token ceiling. Consumed by the run-budget enforcement. */
export function getRunTokenBudget(): RunTokenBudget {
  return getAgentPolicyConfig().tokenBudget;
}
