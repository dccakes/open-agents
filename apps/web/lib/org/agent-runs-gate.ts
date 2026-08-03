/**
 * The kill switch, checked at every run-start path in this deployment.
 *
 * Two properties this module exists to guarantee:
 *
 * - **Fail closed.** If the settings row cannot be read, the run is refused.
 *   A run-start path that treats an unreadable switch as "not paused" defeats
 *   the switch precisely when the database is the thing going wrong.
 * - **No caching.** The state is read per call, so clearing the flag restores
 *   service on the next run-start request with no deployment or restart.
 *
 * Scope, stated where the code is rather than only in the UI: this stops *new*
 * runs, and only in the deployment whose row was flipped. In-flight runs keep
 * executing (WS-1.5 owns per-run stop), and preview deployments read their own
 * Neon branch, so they are unaffected.
 */

import { readOrgSettings } from "@/lib/org/settings";

export const AGENT_RUNS_PAUSED_MESSAGE =
  "Agent runs are paused for this deployment. New runs cannot start until an administrator resumes them; runs already in progress are unaffected.";

export const AGENT_RUNS_UNVERIFIABLE_MESSAGE =
  "Agent runs cannot start right now: the organization settings could not be read, so the run was refused rather than started unchecked.";

export type AgentRunBlockedCode =
  | "agent_runs_paused"
  | "org_settings_unavailable";

export interface AgentRunBlocked {
  allowed: false;
  code: AgentRunBlockedCode;
  message: string;
}

export type AgentRunStartDecision = { allowed: true } | AgentRunBlocked;

/** Whether a new agent run may start in this deployment right now. */
export async function checkAgentRunStartAllowed(): Promise<AgentRunStartDecision> {
  try {
    const { agentRunsPaused } = await readOrgSettings();
    if (agentRunsPaused) {
      return {
        allowed: false,
        code: "agent_runs_paused",
        message: AGENT_RUNS_PAUSED_MESSAGE,
      };
    }
    return { allowed: true };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(
      `[org-settings] Refusing a run start: the kill switch could not be read (${detail}).`,
    );
    return {
      allowed: false,
      code: "org_settings_unavailable",
      message: AGENT_RUNS_UNVERIFIABLE_MESSAGE,
    };
  }
}

/** The structured refusal an HTTP run-start path answers with. */
export function agentRunBlockedResponse(decision: AgentRunBlocked): Response {
  return Response.json(
    {
      error: decision.message,
      code: decision.code,
      agentRunsPaused: decision.code === "agent_runs_paused",
    },
    { status: 503 },
  );
}
