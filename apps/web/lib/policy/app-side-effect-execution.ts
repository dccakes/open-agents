/**
 * Performing an application-level side effect after its approval was answered.
 *
 * This is the other half of the gate in `app-side-effects.ts`. The workflow
 * refuses to commit or open a pull request under `strict` and records an
 * approval instead; when a user answers it — possibly hours later, from a
 * different process, with the session's sandbox long since hibernated — this is
 * what actually runs.
 *
 * Three properties it must hold, in this order:
 *
 * 1. **Authorize first.** `requireSessionActor` runs before the approval is
 *    even read, so a caller with no business here cannot probe approval ids.
 * 2. **Spend the approval before touching GitHub.** The compare-and-set in
 *    `approval-enforcement.ts` is what makes a grant single use; a replayed
 *    request to this route must not push twice.
 * 3. **Reprovision, do not assume.** The sandbox is fetched through the same
 *    `getReadySessionSandbox` the chat workflow uses, so a hibernated session is
 *    rebuilt rather than failing — and no in-sandbox state is assumed to have
 *    survived.
 *
 * A refusal is not an error here: a denied or expired approval means the run
 * skipped the operation, and the run says so on its own message.
 */

import type { WebAgentCommitData, WebAgentPrData } from "@/app/types";
import type { PermissionCheckOptions } from "@/lib/auth/require-permission";
import {
  applyAppSideEffectOutcome,
  type AppSideEffectOutcome,
} from "@/lib/chat/app-side-effect-parts";
import type { AutoCommitResult } from "@/lib/chat/auto-commit-direct";
import type { AutoCreatePrResult } from "@/lib/chat/auto-pr-direct";
import {
  buildCommitData,
  buildPrData,
  shouldCreatePrAfterCommit,
} from "@/lib/chat/git-data-parts";
import {
  getChatMessageByIdForChat,
  upsertChatMessageScoped,
} from "@/lib/db/sessions";
import {
  type AppSideEffectPlan,
  readAppSideEffectPlan,
} from "@/lib/policy/app-side-effect-approvals";
import { APP_SIDE_EFFECT_SKIP_REASON } from "@/lib/policy/app-side-effects";
import { consumeAppSideEffectApproval } from "@/lib/policy/approval-enforcement";
import { ApprovalError } from "@/lib/policy/approval-errors";
import { effectiveApprovalDecision } from "@/lib/policy/approval-state";
import { getApprovalForSession } from "@/lib/policy/approvals";
import { requireSessionActor } from "@/lib/policy/session-access";

export interface ExecuteAppSideEffectInput {
  sessionId: string;
  approvalId: string;
  /** Injected by tests; defaults to the current instant. */
  now?: Date;
  options?: PermissionCheckOptions;
}

export type AppSideEffectExecution =
  | {
      status: "executed";
      approvalId: string;
      detail: string;
      commit?: WebAgentCommitData;
      pr?: WebAgentPrData;
    }
  | {
      status: "skipped";
      approvalId: string;
      detail: string;
      commit?: WebAgentCommitData;
      pr?: WebAgentPrData;
    };

const NOT_ANSWERED =
  "This approval has not been answered yet, so there is nothing to execute.";

const NOT_A_SIDE_EFFECT =
  "This approval does not gate an application-level side effect.";

const PLAN_INCOMPLETE =
  "This approval no longer records which repository it applied to, so nothing was executed.";

const EXPIRED_DETAIL = `${APP_SIDE_EFFECT_SKIP_REASON} It timed out before it was answered, and an expired approval counts as a denial.`;

interface PerformedSideEffect {
  commit?: WebAgentCommitData;
  pr?: WebAgentPrData;
  detail: string;
}

function describeCommit(result: AutoCommitResult): string {
  if (result.error) {
    return `The commit failed: ${result.error}`;
  }
  if (result.committed && result.pushed) {
    return "Committed and pushed.";
  }
  if (result.committed) {
    return "Committed.";
  }
  return "There was nothing left to commit.";
}

/**
 * Run the plan against a live sandbox.
 *
 * The commit-then-PR ordering and the condition between them are the workflow's
 * own, imported rather than re-stated, so a gated turn produces the same result
 * an ungated one would have.
 */
async function performPlan(
  plan: AppSideEffectPlan,
  context: { userId: string; repoOwner: string; repoName: string },
): Promise<PerformedSideEffect> {
  const { getReadySessionSandbox } =
    await import("@/lib/sandbox/ready-sandbox");
  const { session } = await getReadySessionSandbox({
    sessionId: plan.sessionId,
    userId: context.userId,
  });

  if (!session.sandboxState) {
    throw new ApprovalError(
      "unavailable",
      "The session's workspace could not be provisioned, so the approved operation was not performed. Nothing was pushed.",
    );
  }

  const { connectSandbox } = await import("@open-agents/sandbox");
  const sandbox = await connectSandbox(session.sandboxState);

  const shared = {
    sandbox,
    userId: context.userId,
    sessionId: plan.sessionId,
    sessionTitle: session.title,
    repoOwner: context.repoOwner,
    repoName: context.repoName,
  };

  let commitResult: AutoCommitResult = { committed: false, pushed: false };
  let commit: WebAgentCommitData | undefined;

  if (plan.operations.includes("auto-commit")) {
    const { performAutoCommit } = await import("@/lib/chat/auto-commit-direct");
    commitResult = await performAutoCommit(shared);
    commit = buildCommitData(commitResult, context.repoOwner, context.repoName);
  }

  if (!plan.operations.includes("auto-create-pr")) {
    return { commit, detail: describeCommit(commitResult) };
  }

  if (!shouldCreatePrAfterCommit(commitResult)) {
    return {
      commit,
      pr: {
        status: "skipped",
        skipReason:
          commitResult.error ??
          "Auto-commit did not leave origin in sync with HEAD",
      },
      detail: describeCommit(commitResult),
    };
  }

  const { performAutoCreatePr } = await import("@/lib/chat/auto-pr-direct");
  const prResult: AutoCreatePrResult = await performAutoCreatePr(shared);

  return {
    commit,
    pr: buildPrData(prResult),
    detail: `${describeCommit(commitResult)} ${
      prResult.error
        ? `The pull request failed: ${prResult.error}`
        : prResult.skipped
          ? "No pull request was needed."
          : "The pull request is up to date."
    }`.trim(),
  };
}

/**
 * Write the outcome onto the assistant message the run left behind.
 *
 * Best effort: the operation already happened, and losing the report is not a
 * reason to tell the caller the push did not occur.
 */
async function reportOutcome(
  plan: AppSideEffectPlan,
  outcome: AppSideEffectOutcome,
): Promise<void> {
  if (!plan.chatId || !plan.messageId) {
    return;
  }

  try {
    const row = await getChatMessageByIdForChat(plan.messageId, plan.chatId);
    if (!row) {
      return;
    }

    const message = applyAppSideEffectOutcome(
      row.parts as Parameters<typeof applyAppSideEffectOutcome>[0],
      outcome,
    );

    await upsertChatMessageScoped({
      id: message.id,
      chatId: plan.chatId,
      role: "assistant",
      parts: message,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(
      `[policy] Could not report the side-effect outcome for approval ${plan.approvalId}:`,
      detail,
    );
  }
}

function skippedOutcome(
  plan: AppSideEffectPlan,
  detail: string,
): AppSideEffectOutcome {
  return {
    approvalId: plan.approvalId,
    status: "skipped",
    detail,
    ...(plan.operations.includes("auto-commit")
      ? {
          commit: {
            status: "skipped" as const,
            committed: false,
            pushed: false,
            skipReason: detail,
          },
        }
      : {}),
    ...(plan.operations.includes("auto-create-pr")
      ? { pr: { status: "skipped" as const, skipReason: detail } }
      : {}),
  };
}

/**
 * Execute — or record the skipping of — a gated application side effect.
 *
 * @throws AuthorizationError when the caller may not act on the session, or
 * ApprovalError (`not-found` / `invalid` / `already-decided`).
 */
export async function executeAppSideEffect(
  input: ExecuteAppSideEffectInput,
): Promise<AppSideEffectExecution> {
  const now = input.now ?? new Date();
  const actor = await requireSessionActor(input.sessionId, input.options);

  const row = await getApprovalForSession(input.sessionId, input.approvalId);
  if (!row) {
    throw new ApprovalError(
      "not-found",
      "There is no such approval on this session.",
    );
  }
  if (row.kind !== "app-side-effect") {
    throw new ApprovalError("invalid", NOT_A_SIDE_EFFECT);
  }

  const plan = readAppSideEffectPlan(row);
  const decision = effectiveApprovalDecision(row, now);

  if (decision === "pending") {
    throw new ApprovalError("invalid", NOT_ANSWERED);
  }

  if (decision !== "approved") {
    const detail =
      decision === "expired" ? EXPIRED_DETAIL : APP_SIDE_EFFECT_SKIP_REASON;
    const outcome = skippedOutcome(plan, detail);
    await reportOutcome(plan, outcome);

    return {
      status: "skipped",
      approvalId: plan.approvalId,
      detail,
      commit: outcome.commit,
      pr: outcome.pr,
    };
  }

  if (!(plan.repoOwner && plan.repoName)) {
    throw new ApprovalError("invalid", PLAN_INCOMPLETE);
  }

  // Spent before anything reaches GitHub: a replayed request finds the
  // approval already consumed and pushes nothing.
  const spend = await consumeAppSideEffectApproval({
    sessionId: input.sessionId,
    approvalId: input.approvalId,
    now,
  });
  if (!spend.authorized) {
    throw new ApprovalError("already-decided", spend.message);
  }

  const performed = await performPlan(plan, {
    userId: actor.userId,
    repoOwner: plan.repoOwner,
    repoName: plan.repoName,
  });

  await reportOutcome(plan, {
    approvalId: plan.approvalId,
    status: "executed",
    detail: performed.detail,
    commit: performed.commit,
    pr: performed.pr,
  });

  return {
    status: "executed",
    approvalId: plan.approvalId,
    detail: performed.detail,
    commit: performed.commit,
    pr: performed.pr,
  };
}
