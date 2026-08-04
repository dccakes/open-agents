"use client";

import { CircleCheck, CircleSlash, Loader2, ShieldAlert } from "lucide-react";
import type { WebAgentApprovalRequestData } from "@/app/types";
import { ApprovalButtons } from "@/components/tool-call/approval-buttons";
import type { AppSideEffectApprovalControls } from "./hooks/use-app-side-effect-approval";

/**
 * The approval prompt for an operation the *application* wanted to perform.
 *
 * It reuses `ApprovalButtons` — the same affordance a paused tool call gets —
 * rather than inventing a second approve/deny interaction, because a user
 * should not have to learn two of them. What differs is where the answer goes:
 * a tool approval rides back on the resume request, and this one has no run to
 * ride on (the agent loop finished before the operation was reached), so it is
 * posted to the session's approval routes instead.
 */

export type ApprovalTone = "pending" | "success" | "skipped" | "error";

export interface ApprovalRequestDescription {
  title: string;
  tool: string;
  operation: string;
  rule: string;
  posture: string;
  tone: ApprovalTone;
  /** Whether the approve/deny buttons should be offered. */
  awaitingDecision: boolean;
  /** What happened, once it has. */
  detail?: string;
  /** Says what "resume" means, since the sandbox may not be the same one. */
  resumeNote: string;
}

const RESUME_NOTE =
  "The workspace may be rebuilt before this runs, so anything left only in the sandbox is not guaranteed to survive.";

const TITLES: Record<WebAgentApprovalRequestData["status"], string> = {
  pending: "Approval needed before this runs",
  executed: "Approved and performed",
  skipped: "Skipped by policy",
  expired: "Approval timed out",
  error: "This operation could not be gated",
};

const TONES: Record<WebAgentApprovalRequestData["status"], ApprovalTone> = {
  pending: "pending",
  executed: "success",
  skipped: "skipped",
  expired: "skipped",
  error: "error",
};

/** The copy, separated from the markup so it is testable without a DOM. */
export function describeApprovalRequest(
  data: WebAgentApprovalRequestData,
): ApprovalRequestDescription {
  return {
    title: TITLES[data.status],
    tool: data.tool,
    operation: data.operation,
    rule: data.rule,
    posture: data.posture,
    tone: TONES[data.status],
    awaitingDecision: data.status === "pending" && data.approvalId.length > 0,
    detail: data.detail,
    resumeNote: RESUME_NOTE,
  };
}

const TONE_STYLES: Record<ApprovalTone, string> = {
  pending: "border-amber-500/30 bg-amber-500/5",
  success: "border-emerald-500/30 bg-emerald-500/5",
  skipped: "border-border bg-muted/30",
  error: "border-red-500/30 bg-red-500/5",
};

function ToneIcon({ tone }: { tone: ApprovalTone }) {
  if (tone === "success") {
    return (
      <CircleCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500/80" />
    );
  }
  if (tone === "skipped") {
    return (
      <CircleSlash className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
    );
  }
  return (
    <ShieldAlert
      className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${tone === "error" ? "text-red-500/80" : "text-amber-500/80"}`}
    />
  );
}

export interface ApprovalRequestCardProps {
  data: WebAgentApprovalRequestData;
  approvals: AppSideEffectApprovalControls;
}

export function ApprovalRequestCard({
  data,
  approvals,
}: ApprovalRequestCardProps) {
  const local = approvals.stateFor(data.approvalId);
  // An answer given in this view outranks the status the part was persisted
  // with — the message is only rewritten once the operation has been executed.
  const described = describeApprovalRequest(
    local.status ? { ...data, status: local.status } : data,
  );
  const busy = local.phase === "deciding" || local.phase === "executing";
  const detail = local.detail ?? described.detail;

  return (
    <div
      className={`flex max-w-full items-start gap-2 rounded-md border px-3 py-2 text-xs ${TONE_STYLES[described.tone]}`}
    >
      <ToneIcon tone={described.tone} />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="font-medium text-foreground">{described.title}</div>
        <div className="text-muted-foreground">{described.operation}</div>
        <div className="text-muted-foreground/80">
          <span className="font-mono">{described.tool}</span>
          {" · rule "}
          <span className="font-mono">{described.rule}</span>
          {" · posture "}
          <span className="font-mono">{described.posture}</span>
        </div>
        {detail ? <div className="text-muted-foreground">{detail}</div> : null}
        {described.awaitingDecision ? (
          <>
            <div className="text-muted-foreground/80">
              {described.resumeNote}
            </div>
            {busy ? (
              <div className="mt-2 flex items-center gap-2 pl-5 text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {local.phase === "deciding" ? "Recording…" : "Running…"}
              </div>
            ) : (
              <ApprovalButtons
                approvalId={data.approvalId}
                onApprove={(id) => approvals.approve(id)}
                onDeny={(id) => approvals.deny(id)}
              />
            )}
          </>
        ) : null}
        {local.error ? (
          <div className="text-red-500/80 dark:text-red-400/80">
            {local.error}
          </div>
        ) : null}
      </div>
    </div>
  );
}
