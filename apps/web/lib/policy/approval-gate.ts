/**
 * The host half of the agent's approval seam.
 *
 * `packages/agent/policy/approval-gate.ts` declares an `ApprovalGate` and the
 * tools call it; it cannot implement one, because the agent package never
 * touches a database. This is the implementation: `request` writes the row a
 * pause needs, and `verify` *spends* it, so one approval authorizes exactly one
 * execution.
 *
 * The import from `@open-agents/agent` is deliberately type-only, for the same
 * reason `policy-event-recorder.ts` keeps its import type-only: that package
 * root pulls the AI SDK runtime with it, and a type import is erased at build
 * time.
 */

import type {
  ApprovalGate,
  ApprovalGateDecision,
  ApprovalGateRequest,
} from "@open-agents/agent";
import { consumeToolCallApproval } from "@/lib/policy/approval-enforcement";
import { createApproval } from "@/lib/policy/approvals";

export interface ApprovalGateScope {
  sessionId: string;
  /** The chat turn the tool call belongs to. */
  chatId?: string | null;
  workflowRunId?: string | null;
}

const UNAVAILABLE_MESSAGE =
  "The approval record for this operation could not be read, so the call was refused rather than executed unverified.";

/**
 * A gate scoped to one run.
 *
 * `request` deliberately does not swallow its failure: the agent-side wrapper
 * already logs and continues, and a caller that wants the error (a test, a
 * future non-agent caller) should be able to see it.
 */
export function createApprovalGate(scope: ApprovalGateScope): ApprovalGate {
  return {
    async request(request: ApprovalGateRequest): Promise<void> {
      await createApproval({
        sessionId: scope.sessionId,
        chatId: scope.chatId ?? null,
        workflowRunId: scope.workflowRunId ?? null,
        kind: "tool-call",
        toolName: request.toolName,
        toolCallId: request.toolCallId,
        input: request.inputSummary ?? "",
      });
    },

    async verify(request: ApprovalGateRequest): Promise<ApprovalGateDecision> {
      try {
        const verification = await consumeToolCallApproval({
          sessionId: scope.sessionId,
          toolCallId: request.toolCallId,
        });

        if (verification.authorized) {
          return { authorized: true };
        }

        return {
          authorized: false,
          code: verification.code,
          message: verification.message,
        };
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        console.error(
          `[policy] Could not verify the approval for ${request.toolName}:`,
          detail,
        );
        return {
          authorized: false,
          code: "unavailable",
          message: UNAVAILABLE_MESSAGE,
        };
      }
    },
  };
}
