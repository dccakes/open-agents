"use client";

import { useCallback, useMemo, useState } from "react";
import type { WebAgentApprovalStatus } from "@/app/types";

/**
 * Answering an application-level side-effect approval from the chat.
 *
 * Two requests, deliberately, and in this order:
 *
 * 1. `POST …/approvals/{id}` records the decision. It is a one-way write and it
 *    must land the instant the user clicks, whatever happens afterwards.
 * 2. `POST …/approvals/{id}/execute` performs — or records the skipping of —
 *    the operation. It reprovisions a sandbox and pushes, so it can take a
 *    while and can fail on its own terms; folding it into step one would make a
 *    failed push look like a failed approval and leave a retry trying to
 *    re-decide something already terminal.
 *
 * The hook is mounted by the chat view, not by the card, so an answer in flight
 * survives the card re-rendering underneath it.
 */

export type AppSideEffectApprovalPhase =
  | "idle"
  | "deciding"
  | "executing"
  | "resolved";

export interface AppSideEffectApprovalState {
  phase: AppSideEffectApprovalPhase;
  /**
   * What the request became once the answer was acted on, which the card
   * renders through the same status-to-copy map a persisted part uses. The
   * status and not the title, so the wording lives in exactly one place.
   */
  status?: WebAgentApprovalStatus;
  /** Replaces the card's detail with what actually happened. */
  detail?: string;
  error?: string;
}

export interface AppSideEffectApprovalControls {
  stateFor: (approvalId: string) => AppSideEffectApprovalState;
  approve: (approvalId: string) => void;
  deny: (approvalId: string) => void;
}

const IDLE: AppSideEffectApprovalState = { phase: "idle" };

interface ExecuteResponse {
  result?: { status?: string; detail?: string };
  error?: string;
}

async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body.error === "string") {
      return body.error;
    }
  } catch {
    // Fall through to the generic message.
  }
  return `Request failed (${response.status}).`;
}

export function useAppSideEffectApproval(params: {
  sessionId: string;
  /** Called once an operation has actually run, so git views can refresh. */
  onExecuted?: () => void;
}): AppSideEffectApprovalControls {
  const { sessionId, onExecuted } = params;
  const [states, setStates] = useState<
    Record<string, AppSideEffectApprovalState>
  >({});

  const update = useCallback(
    (approvalId: string, next: AppSideEffectApprovalState) => {
      setStates((current) => ({ ...current, [approvalId]: next }));
    },
    [],
  );

  const answer = useCallback(
    async (approvalId: string, decision: "approved" | "denied") => {
      if (!approvalId) {
        return;
      }

      update(approvalId, { phase: "deciding" });

      const base = `/api/sessions/${encodeURIComponent(sessionId)}/approvals/${encodeURIComponent(approvalId)}`;

      try {
        const decided = await fetch(base, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ decision }),
        });

        if (!decided.ok) {
          update(approvalId, {
            phase: "idle",
            error: await readError(decided),
          });
          return;
        }

        update(approvalId, { phase: "executing" });

        const executed = await fetch(`${base}/execute`, { method: "POST" });
        if (!executed.ok) {
          update(approvalId, {
            phase: "idle",
            error: await readError(executed),
          });
          return;
        }

        const body = (await executed.json()) as ExecuteResponse;
        const ran = body.result?.status === "executed";

        update(approvalId, {
          phase: "resolved",
          status: ran ? "executed" : "skipped",
          detail: body.result?.detail,
        });

        if (ran) {
          onExecuted?.();
        }
      } catch (error) {
        update(approvalId, {
          phase: "idle",
          error:
            error instanceof Error
              ? error.message
              : "The decision could not be sent.",
        });
      }
    },
    [onExecuted, sessionId, update],
  );

  const stateFor = useCallback(
    (approvalId: string) => states[approvalId] ?? IDLE,
    [states],
  );

  const approve = useCallback(
    (approvalId: string) => {
      void answer(approvalId, "approved");
    },
    [answer],
  );

  const deny = useCallback(
    (approvalId: string) => {
      void answer(approvalId, "denied");
    },
    [answer],
  );

  return useMemo(
    () => ({ stateFor, approve, deny }),
    [approve, deny, stateFor],
  );
}
