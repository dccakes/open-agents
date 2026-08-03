import { CircleGauge } from "lucide-react";
import type { WebAgentBudgetHaltData, WebAgentBudgetKind } from "@/app/types";
import { UTC_DAY_BOUNDARY_NOTICE } from "@/lib/budget/utc-day";

/**
 * "This run stopped because it hit a ceiling" — shown in the transcript where
 * the run stopped.
 *
 * A budget halt is deliberately not rendered as an error. The run did what it
 * was asked to do and then ran out of allowance, and telling a user their run
 * "failed" when it was stopped on purpose sends them looking for a bug.
 */

const BUDGET_TITLES: Record<WebAgentBudgetKind, string> = {
  "run-tokens": "Stopped: run token budget reached",
  "run-steps": "Stopped: run step budget reached",
  "org-daily-tokens": "Stopped: daily token budget reached",
};

export interface BudgetHaltDescription {
  title: string;
  /** The totals at the moment of the halt. */
  detail: string;
  /** Present only where the UTC day boundary is load-bearing. */
  boundaryNote?: string;
}

/** The copy, separated from the markup so it is testable without a DOM. */
export function describeBudgetHalt(
  data: WebAgentBudgetHaltData,
): BudgetHaltDescription {
  const unit = data.budget === "run-steps" ? "steps" : "tokens";

  return {
    title: BUDGET_TITLES[data.budget],
    detail: `${data.used.toLocaleString()} of ${data.limit.toLocaleString()} ${unit} used.`,
    ...(data.budget === "org-daily-tokens"
      ? { boundaryNote: data.dayBoundary ?? UTC_DAY_BOUNDARY_NOTICE }
      : {}),
  };
}

export function BudgetHaltCard({ data }: { data: WebAgentBudgetHaltData }) {
  const { title, detail, boundaryNote } = describeBudgetHalt(data);

  return (
    <div className="flex max-w-full items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs">
      <CircleGauge className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500/80" />
      <div className="min-w-0 space-y-0.5">
        <div className="font-medium text-foreground">{title}</div>
        <div className="text-muted-foreground">{detail}</div>
        {boundaryNote ? (
          <div className="text-muted-foreground/80">{boundaryNote}</div>
        ) : null}
      </div>
    </div>
  );
}
